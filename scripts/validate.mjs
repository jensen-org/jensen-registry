import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKSUMMED, ROOT, SCHEMA_VERSION, checksumsText, contentHash, loadEntries, readYaml, sha256, validator } from "./lib.mjs";

const online = process.argv.includes("--online");
const problems = [];
const fail = (message) => problems.push(message);
const check = validator();

const skillEntries = loadEntries("skills");
const mcpEntries = loadEntries("mcp");
for (const { path, entry } of skillEntries) {
  problems.push(...check.skillEntry(entry, path));
  if (path !== `skills/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
}
for (const { path, entry } of mcpEntries) {
  problems.push(...check.mcpEntry(entry, path));
  if (path !== `mcp/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
}

const index = readYaml("index.yaml");
if (index.schema_version !== SCHEMA_VERSION) fail(`index.yaml: schema_version must be ${SCHEMA_VERSION}`);
if (readYaml("upstreams.yaml").schema_version !== SCHEMA_VERSION) fail("upstreams.yaml: wrong schema_version");

const same = (label, left, right) => {
  if (JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)) fail(`${label} differs from its entry file`);
};

for (const skill of index.skills ?? []) {
  problems.push(...check.indexSkill(skill, `index.yaml skills/${skill.id}`));
  const source = skillEntries.find(({ entry }) => entry.id === skill.id)?.entry;
  if (!source) {
    fail(`index.yaml: skill ${skill.id} has no entry file`);
    continue;
  }
  for (const key of ["repo", "path", "ref", "advised", "provider"]) same(`index.yaml skill ${skill.id} ${key}`, skill[key], source[key]);
  if (contentHash(skill.files) !== skill.content_hash) fail(`index.yaml: skill ${skill.id} content_hash does not match its files`);
  if (!skill.files.some((file) => file.path === "SKILL.md")) fail(`index.yaml: skill ${skill.id} has no SKILL.md`);
  for (const file of skill.files) {
    if (!file.url.includes(`/${skill.commit}/`)) fail(`index.yaml: skill ${skill.id} file ${file.path} is not pinned to ${skill.commit}`);
  }
}
for (const { entry } of skillEntries) {
  if (!(index.skills ?? []).some((skill) => skill.id === entry.id)) fail(`index.yaml: missing skill ${entry.id}, run scripts/track.mjs`);
}

for (const server of index.mcp ?? []) {
  problems.push(...check.indexMcp(server, `index.yaml mcp/${server.id}`));
  const source = mcpEntries.find(({ entry }) => entry.id === server.id)?.entry;
  if (!source) {
    fail(`index.yaml: mcp server ${server.id} has no entry file`);
    continue;
  }
  for (const key of ["transport", "advised", "description", "url", "env"]) {
    same(`index.yaml mcp ${server.id} ${key}`, server[key] ?? (key === "env" ? [] : undefined), source[key] ?? (key === "env" ? [] : undefined));
  }
  if (server.package) {
    if (server.package.ecosystem !== source.package?.ecosystem || server.package.name !== source.package?.name) {
      fail(`index.yaml: mcp ${server.id} package differs from its entry file`);
    }
    const lockPath = join(ROOT, server.package.lockfile.path);
    if (!existsSync(lockPath)) fail(`index.yaml: mcp ${server.id} lockfile ${server.package.lockfile.path} is missing`);
    else if (sha256(readFileSync(lockPath)) !== server.package.lockfile.sha256) fail(`index.yaml: mcp ${server.id} lockfile hash does not match`);
  }
}
for (const { entry } of mcpEntries) {
  if (!(index.mcp ?? []).some((server) => server.id === entry.id)) fail(`index.yaml: missing mcp server ${entry.id}, run scripts/track.mjs`);
}

const expected = checksumsText(CHECKSUMMED);
if (readFileSync(join(ROOT, "checksums.txt"), "utf8") !== expected) fail("checksums.txt does not match the published files");

if (online) {
  for (const skill of index.skills ?? []) {
    for (const file of skill.files) {
      const response = await fetch(file.url);
      if (!response.ok) {
        fail(`${file.url} answered ${response.status}`);
        continue;
      }
      if (sha256(Buffer.from(await response.arrayBuffer())) !== file.sha256) fail(`${file.url} does not match its sha256`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${index.skills?.length ?? 0} skills, ${index.mcp?.length ?? 0} mcp servers`);
