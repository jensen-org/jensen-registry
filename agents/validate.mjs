import { loadEntries } from "../lib.mjs";

export function validateAgents({ check, index, problems, same }) {
  const fail = (message) => problems.push(message);
  const entries = loadEntries("agents");
  const skillIds = new Set(loadEntries("skills").map(({ entry }) => entry.id));
  for (const { path, entry } of entries) {
    problems.push(...check("agents", "agentEntry")(entry, path));
    if (path !== `agents/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
    for (const skill of entry.skills ?? []) {
      if (!skillIds.has(skill)) fail(`${path}: skill ${skill} is not in skills/`);
    }
  }
  for (const item of index.agents ?? []) {
    problems.push(...check("agents", "indexAgent")(item, `index.yaml agents/${item.id}`));
    const source = entries.find(({ entry }) => entry.id === item.id)?.entry;
    if (!source) {
      fail(`index.yaml: agent ${item.id} has no entry file`);
      continue;
    }
    for (const key of ["name", "summary", "prompt", "trigger", "skills", "provider", "advised", "tags"]) {
      same(`index.yaml agent ${item.id} ${key}`, item[key], source[key]);
    }
  }
  for (const { entry } of entries) {
    if (!(index.agents ?? []).some((item) => item.id === entry.id)) fail(`index.yaml: missing agent ${entry.id}, run npm run track`);
  }
}
