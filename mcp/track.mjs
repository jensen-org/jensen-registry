import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RAW_BASE, ROOT, getJson, loadEntries, purl, sha256 } from "../lib.mjs";
import { mcpProblems } from "./checks.mjs";

async function latestVersion(pkg) {
  if (pkg.version) return pkg.version;
  if (pkg.ecosystem === "npm") {
    const encoded = pkg.name.replace("/", "%2f");
    return (await getJson(`https://registry.npmjs.org/${encoded}/latest`)).version;
  }
  return (await getJson(`https://pypi.org/pypi/${pkg.name}/json`)).info.version;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.error}`);
  }
  return result.stdout;
}

export const npmManifest = (name, version) =>
  `${JSON.stringify({ name: "jensen-mcp", private: true, dependencies: { [name]: version } }, null, 2)}\n`;

function lockNpm(pkg, version, dir) {
  writeFileSync(join(dir, "package.json"), npmManifest(pkg.name, version));
  run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir });
  return "package-lock.json";
}

function lockPypi(pkg, version, dir) {
  writeFileSync(join(dir, "requirements.in"), `${pkg.name}==${version}\n`);
  run(
    "uv",
    ["pip", "compile", "--generate-hashes", "--no-header", "--python-version", "3.12", "-o", "requirements.txt", "requirements.in"],
    { cwd: dir },
  );
  return "requirements.txt";
}

function installForCapture(pkg, version, lockName, dir) {
  if (pkg.ecosystem === "npm") {
    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir });
    return join(dir, "node_modules", ".bin", pkg.bin);
  }
  run("uv", ["venv", "--python", "3.12", "venv"], { cwd: dir });
  run("uv", ["pip", "install", "--python", join(dir, "venv", "bin", "python"), "--require-hashes", "--no-deps", "-r", lockName], { cwd: dir });
  return join(dir, "venv", "bin", pkg.bin);
}

function rpcSession(child) {
  let buffer = "";
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        waiting.get(message.id)?.(message);
      } catch {
        continue;
      }
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const call = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30000);
      waiting.set(id, (message) => {
        clearTimeout(timer);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });
  return { send, call };
}

const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "jensen-registry", version: "1" },
};

const toolRows = (tools) =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    ...(tool.inputSchema ? { input_schema: tool.inputSchema } : {}),
  }));

async function captureStdio(binary, args) {
  const child = spawn(binary, args ?? [], { stdio: ["pipe", "pipe", "ignore"], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  try {
    const session = rpcSession(child);
    await session.call(1, "initialize", INIT);
    session.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const listed = await session.call(2, "tools/list", {});
    return toolRows(listed.tools);
  } finally {
    child.kill("SIGKILL");
  }
}

async function postRpc(url, id, method, params, sessionId) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const text = await response.text();
  const payload = text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")
    ? text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).pop()
    : text;
  const message = JSON.parse(payload);
  if (message.error) throw new Error(JSON.stringify(message.error));
  return { result: message.result, sessionId: response.headers.get("mcp-session-id") ?? sessionId };
}

async function captureHttp(url) {
  const init = await postRpc(url, 1, "initialize", INIT);
  const listed = await postRpc(url, 2, "tools/list", {}, init.sessionId);
  return toolRows(listed.result.tools);
}

const httpAuth = (entry) => ({
  ...(entry.headers?.length ? { headers: entry.headers } : {}),
  ...(entry.oauth ? { oauth: true } : {}),
});

const needsSecret = (entry) => (entry.env ?? []).some((variable) => variable.secret && !variable.optional);

export const needsSignIn = (entry) => Boolean(entry.oauth) || (entry.headers ?? []).length > 0 || needsSecret(entry);

async function trackMcp(entry, previous, warn) {
  const base = {
    id: entry.id,
    description: entry.description,
    ...(entry.provider ? { provider: entry.provider } : {}),
    ...(entry.license ? { license: entry.license } : {}),
    advised: entry.advised,
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
    ...(entry.serves?.length ? { serves: entry.serves } : {}),
    transport: entry.transport,
  };
  const env = entry.env ?? [];
  if (entry.transport === "http") {
    let tools = previous?.tools ?? [];
    if (!needsSignIn(entry)) {
      try {
        tools = await captureHttp(entry.url);
      } catch (error) {
        warn(`${entry.id}: could not capture tools: ${error.message}`);
      }
    }
    return { ...base, url: entry.url, env, ...httpAuth(entry), tools };
  }
  const pkg = entry.package;
  const version = await latestVersion(pkg);
  const lockName = pkg.ecosystem === "npm" ? "package-lock.json" : "requirements.txt";
  const lockPath = `mcp/locks/${entry.id}/${lockName}`;
  const same = previous?.package?.version === version && existsSync(join(ROOT, lockPath));
  let lockSha;
  let tools = same ? previous.tools : [];
  if (same) {
    lockSha = sha256(readFileSync(join(ROOT, lockPath)));
  } else {
    const dir = mkdtempSync(join(tmpdir(), `registry-${entry.id}-`));
    try {
      const produced = pkg.ecosystem === "npm" ? lockNpm(pkg, version, dir) : lockPypi(pkg, version, dir);
      mkdirSync(join(ROOT, "mcp/locks", entry.id), { recursive: true });
      copyFileSync(join(dir, produced), join(ROOT, lockPath));
      lockSha = sha256(readFileSync(join(ROOT, lockPath)));
      if (!needsSecret(entry)) {
        try {
          const binary = installForCapture(pkg, version, produced, dir);
          tools = await captureStdio(binary, pkg.args);
        } catch (error) {
          warn(`${entry.id}: could not capture tools: ${error.message}`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return {
    ...base,
    package: {
      ecosystem: pkg.ecosystem,
      name: pkg.name,
      version,
      purl: purl(pkg.ecosystem, pkg.name, version),
      bin: pkg.bin,
      ...(pkg.args?.length ? { args: pkg.args } : {}),
      lockfile: { path: lockPath, url: `${RAW_BASE}/main/${lockPath}`, sha256: lockSha },
    },
    env,
    tools,
  };
}

export async function trackMcpServers({ check, previous, problems, warn }) {
  const entries = loadEntries("mcp");
  const mcp = [];
  for (const { path, entry } of entries) {
    problems.push(...check("mcp", "mcpEntry")(entry, path));
    if (problems.length) continue;
    problems.push(...mcpProblems(entry, path));
    if (problems.length) continue;
    mcp.push(await trackMcp(entry, previous.mcp?.find((server) => server.id === entry.id), warn));
  }
  return { mcp, entries };
}
