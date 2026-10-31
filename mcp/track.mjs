import { spawnSync } from "node:child_process";
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

const httpAuth = (entry) => ({
  ...(entry.headers?.length ? { headers: entry.headers } : {}),
  ...(entry.oauth ? { oauth: true } : {}),
});

async function trackMcp(entry, previous) {
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
    return { ...base, url: entry.url, env, ...httpAuth(entry) };
  }
  const pkg = entry.package;
  const version = await latestVersion(pkg);
  const lockName = pkg.ecosystem === "npm" ? "package-lock.json" : "requirements.txt";
  const lockPath = `mcp/locks/${entry.id}/${lockName}`;
  const same = previous?.package?.version === version && existsSync(join(ROOT, lockPath));
  let lockSha;
  if (same) {
    lockSha = sha256(readFileSync(join(ROOT, lockPath)));
  } else {
    const dir = mkdtempSync(join(tmpdir(), `registry-${entry.id}-`));
    try {
      const produced = pkg.ecosystem === "npm" ? lockNpm(pkg, version, dir) : lockPypi(pkg, version, dir);
      mkdirSync(join(ROOT, "mcp/locks", entry.id), { recursive: true });
      copyFileSync(join(dir, produced), join(ROOT, lockPath));
      lockSha = sha256(readFileSync(join(ROOT, lockPath)));
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
  };
}

export async function trackMcpServers({ check, previous, problems }) {
  const entries = loadEntries("mcp");
  const mcp = [];
  for (const { path, entry } of entries) {
    problems.push(...check("mcp", "mcpEntry")(entry, path));
    if (problems.length) continue;
    problems.push(...mcpProblems(entry, path));
    if (problems.length) continue;
    mcp.push(await trackMcp(entry, previous.mcp?.find((server) => server.id === entry.id)));
  }
  return { mcp, entries };
}
