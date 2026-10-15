import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RAW_BASE, ROOT, loadEntries, sha256 } from "../lib.mjs";
import { integrationProblems, serving, servesProblems } from "./checks.mjs";
import { canonicalSvg, fromCanonical, simpleIcons } from "./icons.mjs";

const ICONS = "integrations/icons";

function iconFor(entry, icons) {
  if (entry.icon.simple_icons) {
    const slug = entry.icon.simple_icons;
    const { d, hex } = icons.resolve(slug);
    return { source: `simple-icons@${icons.version}`, path: `${ICONS}/${slug}.svg`, svg: canonicalSvg(d), hex };
  }
  const path = `${ICONS}/${entry.id}.svg`;
  if (!existsSync(join(ROOT, path))) throw new Error(`a local icon needs ${path}`);
  const svg = canonicalSvg(fromCanonical(readFileSync(join(ROOT, path), "utf8")));
  return { source: "local", path, svg, hex: entry.icon.hex };
}

function trackIntegration(entry, mcpEntries, icons, written) {
  const icon = iconFor(entry, icons);
  if (written.has(icon.path) && written.get(icon.path) !== icon.svg) {
    throw new Error(`${icon.path} is claimed by two different icons`);
  }
  written.set(icon.path, icon.svg);
  const bytes = Buffer.from(icon.svg);
  mkdirSync(join(ROOT, ICONS), { recursive: true });
  writeFileSync(join(ROOT, icon.path), bytes);
  const servers = serving(entry.id, mcpEntries)
    .map((server) => ({ id: server.id, default: server.id === entry.default_mcp }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    ...(entry.provider ? { provider: entry.provider } : {}),
    advised: entry.advised,
    ...(entry.default_on ? { default_on: true } : {}),
    ...(entry.tags?.length ? { tags: entry.tags } : {}),
    category: entry.category,
    ...(entry.hosts?.length ? { hosts: entry.hosts } : {}),
    ...(entry.native ? { native: entry.native } : {}),
    auth: entry.auth,
    ...(entry.default_mcp ? { default_mcp: entry.default_mcp } : {}),
    mcp: servers,
    permissions: entry.permissions ?? [],
    icon: {
      source: icon.source,
      path: icon.path,
      url: `${RAW_BASE}/main/${icon.path}`,
      sha256: sha256(bytes),
      size: bytes.length,
      hex: icon.hex,
    },
  };
}

function removeOrphanIcons(kept) {
  if (!existsSync(join(ROOT, ICONS))) return;
  for (const name of readdirSync(join(ROOT, ICONS))) {
    if (!kept.has(`${ICONS}/${name}`)) rmSync(join(ROOT, ICONS, name), { recursive: true });
  }
}

export function trackIntegrations({ check, problems, mcpEntries }) {
  const entries = loadEntries("integrations");
  problems.push(...servesProblems(mcpEntries, new Set(entries.map(({ entry }) => entry.id))));
  const icons = simpleIcons();
  const written = new Map();
  const integrations = [];
  for (const { path, entry } of entries) {
    problems.push(...check("integrations", "integrationEntry")(entry, path));
    if (problems.length) continue;
    problems.push(...integrationProblems(entry, path, mcpEntries));
    if (problems.length) continue;
    try {
      integrations.push(trackIntegration(entry, mcpEntries, icons, written));
    } catch (error) {
      problems.push(`${path}: ${error.message}`);
    }
  }
  if (!problems.length) removeOrphanIcons(written);
  return integrations;
}
