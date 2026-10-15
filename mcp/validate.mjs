import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RAW_BASE, ROOT, loadEntries, sha256 } from "../lib.mjs";
import { mcpProblems } from "./checks.mjs";

export function validateMcp({ check, index, problems, same }) {
  const fail = (message) => problems.push(message);
  const entries = loadEntries("mcp");
  for (const { path, entry } of entries) {
    const found = check("mcp", "mcpEntry")(entry, path);
    problems.push(...found);
    if (!found.length) problems.push(...mcpProblems(entry, path));
    if (path !== `mcp/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
  }
  for (const server of index.mcp ?? []) {
    problems.push(...check("mcp", "indexMcp")(server, `index.yaml mcp/${server.id}`));
    const source = entries.find(({ entry }) => entry.id === server.id)?.entry;
    if (!source) {
      fail(`index.yaml: mcp server ${server.id} has no entry file`);
      continue;
    }
    for (const key of ["transport", "advised", "description", "url", "env", "headers", "oauth", "serves"]) {
      const empty = key === "env" ? [] : undefined;
      same(`index.yaml mcp ${server.id} ${key}`, server[key] ?? empty, source[key] ?? empty);
    }
    if (server.package) {
      if (server.package.ecosystem !== source.package?.ecosystem || server.package.name !== source.package?.name) {
        fail(`index.yaml: mcp ${server.id} package differs from its entry file`);
      }
      const lockfile = server.package.lockfile;
      const expectedPath = `mcp/locks/${server.id}/${server.package.ecosystem === "npm" ? "package-lock.json" : "requirements.txt"}`;
      if (lockfile.path !== expectedPath) fail(`index.yaml: mcp ${server.id} lockfile path must be ${expectedPath}`);
      if (lockfile.url !== `${RAW_BASE}/main/${expectedPath}`) fail(`index.yaml: mcp ${server.id} lockfile url must be the registry's own ${expectedPath}`);
      const lockPath = join(ROOT, expectedPath);
      if (!existsSync(lockPath)) fail(`index.yaml: mcp ${server.id} lockfile ${expectedPath} is missing`);
      else if (sha256(readFileSync(lockPath)) !== lockfile.sha256) fail(`index.yaml: mcp ${server.id} lockfile hash does not match`);
    }
  }
  for (const { entry } of entries) {
    if (!(index.mcp ?? []).some((server) => server.id === entry.id)) fail(`index.yaml: missing mcp server ${entry.id}, run npm run track`);
  }
}
