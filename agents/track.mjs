import { loadEntries } from "../lib.mjs";

export function trackAgents({ check, problems }) {
  const skillIds = new Set(loadEntries("skills").map(({ entry }) => entry.id));
  const agents = [];
  for (const { path, entry } of loadEntries("agents")) {
    const found = check("agents", "agentEntry")(entry, path);
    problems.push(...found);
    if (found.length) continue;
    for (const skill of entry.skills ?? []) {
      if (!skillIds.has(skill)) problems.push(`${path}: skill ${skill} is not in skills/`);
    }
    agents.push({
      id: entry.id,
      name: entry.name,
      summary: entry.summary,
      prompt: entry.prompt,
      trigger: entry.trigger,
      ...(entry.skills?.length ? { skills: entry.skills } : {}),
      ...(entry.provider ? { provider: entry.provider } : {}),
      advised: entry.advised,
      ...(entry.tags?.length ? { tags: entry.tags } : {}),
    });
  }
  return agents;
}
