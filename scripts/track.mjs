import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  CHECKSUMMED,
  RAW_BASE,
  ROOT,
  SCHEMA_VERSION,
  checksumsText,
  contentHash,
  dump,
  integrationProblems,
  loadEntries,
  mcpProblems,
  purl,
  readYaml,
  sha256,
  validator,
  writeText,
} from "./lib.mjs";
import { canonicalSvg, fromCanonical, simpleIcons } from "./icons.mjs";

const warnings = [];
const warn = (message) => {
  warnings.push(message);
  console.warn(`warning: ${message}`);
};

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { "user-agent": "jensen-registry", ...headers } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

const githubHeaders = process.env.GITHUB_TOKEN
  ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" }
  : { accept: "application/vnd.github+json" };

const github = (path) => getJson(`https://api.github.com${path}`, githubHeaders);

async function getBytes(url) {
  const response = await fetch(url, { headers: { "user-agent": "jensen-registry" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) throw new Error("SKILL.md has no frontmatter");
  return parse(match[1]);
}

const licenseCache = new Map();
async function repoLicense(repo) {
  if (!licenseCache.has(repo)) {
    const info = await github(`/repos/${repo}`);
    licenseCache.set(repo, info.license?.spdx_id ?? null);
  }
  return licenseCache.get(repo);
}

async function trackSkill(entry, previous) {
  const { sha: commit } = await github(`/repos/${entry.repo}/commits/${encodeURIComponent(entry.ref)}`);
  let files;
  let name;
  let description;
  if (previous?.commit === commit) {
    ({ files, name, description } = previous);
  } else {
    const tree = await github(`/repos/${entry.repo}/git/trees/${commit}?recursive=1`);
    if (tree.truncated) throw new Error(`${entry.repo} tree is truncated`);
    const prefix = `${entry.path}/`;
    const blobs = tree.tree.filter((node) => node.type === "blob" && node.path.startsWith(prefix));
    if (!blobs.some((node) => node.path === `${prefix}SKILL.md`)) {
      throw new Error(`${entry.repo}/${entry.path} has no SKILL.md at ${commit}`);
    }
    files = [];
    let skillText = "";
    for (const blob of blobs) {
      const bytes = await getBytes(`https://raw.githubusercontent.com/${entry.repo}/${commit}/${blob.path}`);
      const rel = blob.path.slice(prefix.length);
      files.push({
        path: rel,
        url: `https://raw.githubusercontent.com/${entry.repo}/${commit}/${blob.path}`,
        sha256: sha256(bytes),
        size: bytes.length,
      });
      if (rel === "SKILL.md") skillText = bytes.toString("utf8");
    }
    files.sort((a, b) => (a.path < b.path ? -1 : 1));
    const meta = frontmatter(skillText);
    name = String(meta.name ?? entry.id);
    description = String(meta.description ?? "");
  }
  const license = entry.license ?? (await repoLicense(entry.repo)) ?? undefined;
  return {
    id: entry.id,
    name,
    description,
    ...(entry.provider ? { provider: entry.provider } : {}),
    ...(license ? { license } : {}),
    advised: entry.advised,
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
    repo: entry.repo,
    path: entry.path,
    ref: entry.ref,
    commit,
    content_hash: contentHash(files),
    files,
  };
}

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

async function trackMcp(entry, previous) {
  const base = {
    id: entry.id,
    description: entry.description,
    ...(entry.provider ? { provider: entry.provider } : {}),
    ...(entry.license ? { license: entry.license } : {}),
    advised: entry.advised,
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
    transport: entry.transport,
  };
  const env = entry.env ?? [];
  if (entry.transport === "http") {
    let tools = previous?.tools ?? [];
    if (!needsSecret(entry)) {
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
  const lockPath = `locks/mcp/${entry.id}/${lockName}`;
  const same = previous?.package?.version === version && existsSync(join(ROOT, lockPath));
  let lockSha;
  let tools = same ? previous.tools : [];
  if (same) {
    lockSha = sha256(readFileSync(join(ROOT, lockPath)));
  } else {
    const dir = mkdtempSync(join(tmpdir(), `registry-${entry.id}-`));
    try {
      const produced = pkg.ecosystem === "npm" ? lockNpm(pkg, version, dir) : lockPypi(pkg, version, dir);
      mkdirSync(join(ROOT, "locks/mcp", entry.id), { recursive: true });
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

function iconFor(entry, icons) {
  if (entry.icon.simple_icons) {
    const slug = entry.icon.simple_icons;
    const { d, hex } = icons.resolve(slug);
    return { source: `simple-icons@${icons.version}`, path: `icons/${slug}.svg`, svg: canonicalSvg(d), hex };
  }
  const path = `icons/local/${entry.id}.svg`;
  const svg = canonicalSvg(fromCanonical(readFileSync(join(ROOT, path), "utf8")));
  return { source: "local", path, svg, hex: entry.icon.hex };
}

function trackIntegration(entry, icons, written) {
  const icon = iconFor(entry, icons);
  const bytes = Buffer.from(icon.svg);
  if (!written.has(icon.path)) {
    mkdirSync(join(ROOT, icon.path, ".."), { recursive: true });
    writeFileSync(join(ROOT, icon.path), bytes);
    written.add(icon.path);
  }
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    ...(entry.provider ? { provider: entry.provider } : {}),
    advised: entry.advised,
    ...(entry.default_on ? { default_on: true } : {}),
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
    category: entry.category,
    ...(entry.hosts?.length ? { hosts: entry.hosts } : {}),
    ...(entry.native ? { native: entry.native } : {}),
    auth: entry.auth,
    mcp: entry.mcp ?? [],
    permissions: entry.permissions ?? [],
    icon: {
      source: icon.source,
      path: icon.path,
      url: `${RAW_BASE}/main/${icon.path}`,
      sha256: sha256(bytes),
      size: bytes.length,
      hex: icon.hex,
    },
  };
}

function removeOrphanIcons(kept) {
  const walk = (dir) =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((item) =>
      item.isDirectory() ? walk(`${dir}/${item.name}`) : [`${dir}/${item.name}`],
    );
  if (!existsSync(join(ROOT, "icons"))) return;
  for (const path of walk("icons")) if (!kept.has(path)) rmSync(join(ROOT, path));
}

async function main() {
  const check = validator();
  const previous = existsSync(join(ROOT, "index.yaml")) ? readYaml("index.yaml") : { skills: [], mcp: [] };
  const problems = [];
  const skills = [];
  for (const { path, entry } of loadEntries("skills")) {
    problems.push(...check.skillEntry(entry, path));
    if (problems.length) continue;
    skills.push(await trackSkill(entry, previous.skills?.find((s) => s.id === entry.id)));
  }
  const mcp = [];
  const mcpEntries = loadEntries("mcp");
  for (const { path, entry } of mcpEntries) {
    problems.push(...check.mcpEntry(entry, path));
    if (problems.length) continue;
    problems.push(...mcpProblems(entry, path));
    if (problems.length) continue;
    mcp.push(await trackMcp(entry, previous.mcp?.find((m) => m.id === entry.id)));
  }
  const mcpIds = new Map(mcpEntries.map(({ entry }) => [entry.id, entry]));
  const integrations = [];
  const icons = simpleIcons();
  const written = new Set();
  for (const { path, entry } of loadEntries("integrations")) {
    problems.push(...check.integrationEntry(entry, path));
    if (problems.length) continue;
    problems.push(...integrationProblems(entry, path, mcpIds));
    if (problems.length) continue;
    try {
      integrations.push(trackIntegration(entry, icons, written));
    } catch (error) {
      problems.push(`${path}: ${error.message}`);
    }
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  removeOrphanIcons(written);
  writeText("index.yaml", dump({ schema_version: SCHEMA_VERSION, skills, mcp, integrations }));
  writeText("checksums.txt", checksumsText(CHECKSUMMED));
  console.log(
    `tracked ${skills.length} skills, ${mcp.length} mcp servers and ${integrations.length} integrations, ${warnings.length} warnings`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
