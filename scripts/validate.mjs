import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CHECKSUMMED,
  ROOT,
  SCHEMA_VERSION,
  checksumsText,
  contentHash,
  integrationProblems,
  loadEntries,
  mcpProblems,
  readYaml,
  sha256,
  validator,
} from "./lib.mjs";
import { canonicalSvg, checkCanonicalBytes, simpleIcons } from "./icons.mjs";

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
  const found = check.mcpEntry(entry, path);
  problems.push(...found);
  if (!found.length) problems.push(...mcpProblems(entry, path));
  if (path !== `mcp/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
}
const integrationEntries = existsSync(join(ROOT, "integrations")) ? loadEntries("integrations") : [];
const mcpIds = new Map(mcpEntries.map(({ entry }) => [entry.id, entry]));
for (const { path, entry } of integrationEntries) {
  const found = check.integrationEntry(entry, path);
  problems.push(...found);
  if (!found.length) problems.push(...integrationProblems(entry, path, mcpIds));
  if (path !== `integrations/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
}
for (const name of existsSync(join(ROOT, "integrations")) ? readdirSync(join(ROOT, "integrations")) : []) {
  if (!name.endsWith(".yaml")) fail(`integrations/${name}: only .yaml entries belong here`);
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
  for (const key of ["transport", "advised", "description", "url", "env", "headers", "oauth"]) {
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

const icons = simpleIcons();
const usedIcons = new Set();
for (const item of index.integrations ?? []) {
  problems.push(...check.indexIntegration(item, `index.yaml integrations/${item.id}`));
  const source = integrationEntries.find(({ entry }) => entry.id === item.id)?.entry;
  if (!source) {
    fail(`index.yaml: integration ${item.id} has no entry file`);
    continue;
  }
  for (const key of ["name", "description", "category", "advised", "default_on", "provider", "hosts", "native", "auth"]) {
    same(`index.yaml integration ${item.id} ${key}`, item[key], source[key]);
  }
  same(`index.yaml integration ${item.id} mcp`, item.mcp, source.mcp ?? []);
  same(`index.yaml integration ${item.id} permissions`, item.permissions, source.permissions ?? []);
  const icon = item.icon;
  const expectedPath = source.icon.simple_icons ? `icons/${source.icon.simple_icons}.svg` : `icons/local/${source.id}.svg`;
  if (icon.path !== expectedPath) fail(`index.yaml: integration ${item.id} icon path must be ${expectedPath}`);
  usedIcons.add(icon.path);
  if (!existsSync(join(ROOT, icon.path))) {
    fail(`index.yaml: integration ${item.id} icon ${icon.path} is missing`);
    continue;
  }
  const bytes = readFileSync(join(ROOT, icon.path));
  try {
    checkCanonicalBytes(bytes);
    if (source.icon.simple_icons) {
      const upstream = icons.resolve(source.icon.simple_icons);
      if (bytes.toString("utf8") !== canonicalSvg(upstream.d)) fail(`${icon.path} does not match simple-icons ${icons.version}`);
      if (icon.hex !== upstream.hex) fail(`index.yaml: integration ${item.id} icon color does not match simple-icons`);
      if (icon.source !== `simple-icons@${icons.version}`) fail(`index.yaml: integration ${item.id} icon source is stale, run scripts/track.mjs`);
    } else if (icon.hex !== source.icon.hex) {
      fail(`index.yaml: integration ${item.id} icon color differs from its entry`);
    }
  } catch (error) {
    fail(`${icon.path}: ${error.message}`);
  }
  if (sha256(bytes) !== icon.sha256 || bytes.length !== icon.size) fail(`index.yaml: integration ${item.id} icon hash or size does not match`);
  if (icon.url !== `https://raw.githubusercontent.com/jensen-org/jensen-registry/main/${icon.path}`) fail(`index.yaml: integration ${item.id} icon url is not the registry's own`);
}
for (const { entry } of integrationEntries) {
  if (!(index.integrations ?? []).some((item) => item.id === entry.id)) fail(`index.yaml: missing integration ${entry.id}, run scripts/track.mjs`);
}
if (existsSync(join(ROOT, "icons"))) {
  const walk = (dir) =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((item) =>
      item.isDirectory() ? walk(`${dir}/${item.name}`) : [`${dir}/${item.name}`],
    );
  for (const path of walk("icons")) if (!usedIcons.has(path)) fail(`${path}: no integration uses this icon`);
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
console.log(`ok: ${index.skills?.length ?? 0} skills, ${index.mcp?.length ?? 0} mcp servers, ${index.integrations?.length ?? 0} integrations`);
