import { gunzipSync } from "fflate";
import { dump, getBytes, getJson, readYaml, writeText } from "../lib.mjs";
import { rawText, untar } from "../tools/sources/fetch.mjs";

export const BATCH_DEFAULT = 6;

export function batchLimit(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : BATCH_DEFAULT;
}

export const SOURCES_FILE = "grammars/sources.yaml";
const PARSERS_FILE = "lua/nvim-treesitter/parsers.lua";
const CRATES_PAUSE_MS = 1100;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const repositoryKey = (url) => url.replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();

export function parseParsers(lua) {
  const parsers = new Map();
  const parts = lua.split(/\n {2}([A-Za-z0-9_]+) = \{\n/).slice(1);
  for (let index = 0; index < parts.length; index += 2) {
    const url = /url = '([^']+)'/.exec(parts[index + 1])?.[1];
    if (!url) continue;
    parsers.set(parts[index], { url, location: /location = '([^']+)'/.exec(parts[index + 1])?.[1] });
  }
  return parsers;
}

export function wantedParsers(parsers, filetypes, skip = new Set()) {
  const names = new Set();
  for (const filetype of filetypes.filetypes) {
    names.add(filetype.id);
    for (const related of filetype.related ?? []) names.add(related);
  }
  return [...parsers].filter(([name, parser]) => names.has(name) && !skip.has(name) && parser.location === undefined);
}

export function crateNames(name, parser) {
  const last = parser.url.replace(/\/$/, "").split("/").at(-1).replace(/\.git$/, "");
  return [...new Set([last, `tree-sitter-${name.replace(/_/g, "-")}`])];
}

export function withDiscovered(sources, added) {
  return { ...sources, grammars: [...sources.grammars, ...added].sort(byId) };
}

async function release(crate, parser) {
  let found;
  try {
    found = await getJson(`https://crates.io/api/v1/crates/${crate}`);
  } catch (error) {
    if (String(error).includes("answered 404")) return null;
    throw error;
  }
  const repository = found.crate.repository ?? "";
  if (repositoryKey(repository) !== repositoryKey(parser.url)) return null;
  return found.crate.max_stable_version ?? null;
}

async function buildsFromTheRoot(crate, version) {
  const archive = await getBytes(`https://static.crates.io/crates/${crate}/${crate}-${version}.crate`);
  return untar(gunzipSync(archive)).has("src/parser.c");
}

export async function resolveCrates(wanted, { known, limit, log }) {
  const added = [];
  const skipped = [];
  let deferred = 0;
  for (const [name, parser] of wanted) {
    if (known.has(name)) continue;
    if (added.length >= limit) {
      deferred += 1;
      continue;
    }
    let chosen = null;
    for (const crate of crateNames(name, parser)) {
      await pause(CRATES_PAUSE_MS);
      const version = await release(crate, parser);
      if (version) {
        chosen = { crate, version };
        break;
      }
    }
    if (!chosen) {
      skipped.push(`${name}: no crates.io release published from ${parser.url}`);
      continue;
    }
    if (!(await buildsFromTheRoot(chosen.crate, chosen.version))) {
      skipped.push(`${name}: ${chosen.crate} ${chosen.version} has no grammar at its root`);
      continue;
    }
    added.push({ id: name, ...chosen });
  }
  log(`resolved ${added.length} grammars, left ${skipped.length} out, ${deferred} more wait for the next run`);
  return { added, skipped, deferred };
}

export const skippedIds = (sources) => new Set((sources.skip ?? []).map((entry) => entry.id));

export async function loadCandidates(sources, only) {
  const lua = await rawText(sources.upstream.repo, sources.upstream.sha, PARSERS_FILE);
  const parsers = parseParsers(lua);
  if (only) {
    const parser = parsers.get(only);
    if (!parser) throw new Error(`${only} is not a parser of ${sources.upstream.repo}`);
    if (parser.location !== undefined) throw new Error(`${only} is built from a subfolder and cannot be seeded`);
    return [[only, parser]];
  }
  return wantedParsers(parsers, readYaml("tools/filetypes.yaml"), skippedIds(sources));
}

export async function discoverGrammars({ log = console.log, limit = batchLimit(process.env.DISCOVER_BATCH) } = {}) {
  const sources = readYaml(SOURCES_FILE);
  const wanted = await loadCandidates(sources);
  const known = new Set(sources.grammars.map((grammar) => grammar.id));
  const { added, skipped } = await resolveCrates(wanted, { known, limit, log });
  if (added.length) writeText(SOURCES_FILE, dump(withDiscovered(sources, added)));
  for (const line of skipped) log(`  skipped ${line}`);
  return { added, skipped };
}
