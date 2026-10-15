import { contentHash, getBytes, loadEntries, sha256 } from "../lib.mjs";

export async function validateSkills({ check, index, problems, same, online }) {
  const fail = (message) => problems.push(message);
  const entries = loadEntries("skills");
  for (const { path, entry } of entries) {
    problems.push(...check("skills", "skillEntry")(entry, path));
    if (path !== `skills/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
  }
  for (const skill of index.skills ?? []) {
    problems.push(...check("skills", "indexSkill")(skill, `index.yaml skills/${skill.id}`));
    const source = entries.find(({ entry }) => entry.id === skill.id)?.entry;
    if (!source) {
      fail(`index.yaml: skill ${skill.id} has no entry file`);
      continue;
    }
    for (const key of ["repo", "path", "ref", "advised", "provider"]) same(`index.yaml skill ${skill.id} ${key}`, skill[key], source[key]);
    if (contentHash(skill.files) !== skill.content_hash) fail(`index.yaml: skill ${skill.id} content_hash does not match its files`);
    if (!skill.files.some((file) => file.path === "SKILL.md")) fail(`index.yaml: skill ${skill.id} has no SKILL.md`);
    for (const file of skill.files) {
      if (file.path.startsWith("/") || file.path.split("/").some((part) => part === "" || part === "." || part === "..")) {
        fail(`index.yaml: skill ${skill.id} lists an unusable file path ${file.path}`);
      }
      const expected = `https://raw.githubusercontent.com/${skill.repo}/${skill.commit}/${skill.path}/${file.path}`;
      if (file.url !== expected) fail(`index.yaml: skill ${skill.id} file ${file.path} must be fetched from ${expected}`);
    }
  }
  for (const { entry } of entries) {
    if (!(index.skills ?? []).some((skill) => skill.id === entry.id)) fail(`index.yaml: missing skill ${entry.id}, run npm run track`);
  }
  if (!online) return;
  for (const skill of index.skills ?? []) {
    for (const file of skill.files) {
      try {
        if (sha256(await getBytes(file.url)) !== file.sha256) fail(`${file.url} does not match its sha256`);
      } catch (error) {
        fail(error.message);
      }
    }
  }
}
