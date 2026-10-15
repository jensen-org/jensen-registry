import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RAW_BASE, ROOT, loadEntries, sha256 } from "../lib.mjs";
import { integrationProblems, serving, servesProblems } from "./checks.mjs";
import { canonicalSvg, checkCanonicalBytes, simpleIcons } from "./icons.mjs";

const ICONS = "integrations/icons";

export function validateIntegrations({ check, index, problems, same, mcpEntries }) {
  const fail = (message) => problems.push(message);
  const entries = loadEntries("integrations");
  problems.push(...servesProblems(mcpEntries, new Set(entries.map(({ entry }) => entry.id))));
  for (const { path, entry } of entries) {
    const found = check("integrations", "integrationEntry")(entry, path);
    problems.push(...found);
    if (!found.length) problems.push(...integrationProblems(entry, path, mcpEntries));
    if (path !== `integrations/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
  }
  for (const name of readdirSync(join(ROOT, "integrations"))) {
    if (name !== "icons" && !name.endsWith(".yaml") && !name.endsWith(".mjs") && name !== "schema.json") {
      fail(`integrations/${name}: not an entry, an asset or code of this folder`);
    }
  }

  const icons = simpleIcons();
  const used = new Set();
  for (const item of index.integrations ?? []) {
    problems.push(...check("integrations", "indexIntegration")(item, `index.yaml integrations/${item.id}`));
    const source = entries.find(({ entry }) => entry.id === item.id)?.entry;
    if (!source) {
      fail(`index.yaml: integration ${item.id} has no entry file`);
      continue;
    }
    for (const key of ["name", "description", "category", "advised", "default_on", "default_mcp", "provider", "hosts", "native", "auth"]) {
      same(`index.yaml integration ${item.id} ${key}`, item[key], source[key]);
    }
    same(
      `index.yaml integration ${item.id} mcp`,
      item.mcp,
      serving(source.id, mcpEntries)
        .map((server) => ({ id: server.id, default: server.id === source.default_mcp }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    same(`index.yaml integration ${item.id} permissions`, item.permissions, source.permissions ?? []);

    const icon = item.icon;
    const expectedPath = `${ICONS}/${source.icon.simple_icons ?? source.id}.svg`;
    if (icon.path !== expectedPath) fail(`index.yaml: integration ${item.id} icon path must be ${expectedPath}`);
    used.add(icon.path);
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
        if (icon.source !== `simple-icons@${icons.version}`) fail(`index.yaml: integration ${item.id} icon source is stale, run npm run track`);
      } else if (icon.hex !== source.icon.hex) {
        fail(`index.yaml: integration ${item.id} icon color differs from its entry`);
      }
    } catch (error) {
      fail(`${icon.path}: ${error.message}`);
    }
    if (sha256(bytes) !== icon.sha256 || bytes.length !== icon.size) fail(`index.yaml: integration ${item.id} icon hash or size does not match`);
    if (icon.url !== `${RAW_BASE}/main/${icon.path}`) fail(`index.yaml: integration ${item.id} icon url is not the registry's own`);
  }
  for (const { entry } of entries) {
    if (!(index.integrations ?? []).some((item) => item.id === entry.id)) fail(`index.yaml: missing integration ${entry.id}, run npm run track`);
  }
  if (existsSync(join(ROOT, ICONS))) {
    for (const name of readdirSync(join(ROOT, ICONS))) {
      if (!used.has(`${ICONS}/${name}`)) fail(`${ICONS}/${name}: no integration uses this icon`);
    }
  }
}
