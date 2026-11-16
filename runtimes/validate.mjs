import { loadEntries } from "../lib.mjs";

export function validateRuntimes({ check, index, problems, same }) {
  const fail = (message) => problems.push(message);
  const entries = loadEntries("runtimes");
  const programs = new Map();
  for (const { path, entry } of entries) {
    problems.push(...check("runtimes", "runtimeEntry")(entry, path));
    if (path !== `runtimes/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
    for (const name of [entry.program, ...(entry.aliases ?? [])]) {
      if (programs.has(name)) fail(`${path}: ${name} is already claimed by ${programs.get(name)}`);
      programs.set(name, entry.id);
    }
    const { mcp } = entry;
    if (mcp.via === "session" && (mcp.add?.length || mcp.config)) fail(`${path}: session MCP names no command or file`);
    if (mcp.via === "command" && !mcp.add?.includes("{bin}")) fail(`${path}: the MCP add command must name {bin}`);
    if (mcp.via === "file" && !mcp.config) fail(`${path}: file MCP must name its config`);
    if (entry.skills.mode === "folder" && !entry.skills.path) fail(`${path}: folder skills must name a path`);
    if (entry.launch?.positional_prompt && entry.launch?.prompt_flag) fail(`${path}: one interactive prompt style only`);
    const document = entry.launch?.document?.document;
    if (document !== undefined) {
      try {
        JSON.parse(document);
      } catch {
        fail(`${path}: the launch document is not JSON`);
      }
    }
  }
  const items = index.runtimes ?? [];
  for (const item of items) {
    problems.push(...check("runtimes", "indexRuntime")(item, `index.yaml runtimes/${item.id}`));
    const source = entries.find(({ entry }) => entry.id === item.id)?.entry;
    if (!source) {
      fail(`index.yaml: runtime ${item.id} has no entry file`);
      continue;
    }
    same(`index.yaml runtime ${item.id}`, item, source);
  }
  for (const { entry } of entries) {
    if (!items.some((item) => item.id === entry.id)) fail(`index.yaml: missing runtime ${entry.id}, run npm run track`);
  }
}
