import { parse } from "yaml";
import { contentHash, getBytes, github, loadEntries, sha256 } from "../lib.mjs";

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
      const url = `https://raw.githubusercontent.com/${entry.repo}/${commit}/${blob.path}`;
      const bytes = await getBytes(url);
      const rel = blob.path.slice(prefix.length);
      files.push({ path: rel, url, sha256: sha256(bytes), size: bytes.length });
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

export async function trackSkills({ check, previous, problems }) {
  const skills = [];
  for (const { path, entry } of loadEntries("skills")) {
    problems.push(...check("skills", "skillEntry")(entry, path));
    if (problems.length) continue;
    skills.push(await trackSkill(entry, previous.skills?.find((skill) => skill.id === entry.id)));
  }
  return skills;
}
