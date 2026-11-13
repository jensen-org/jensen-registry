import { gunzipSync } from "fflate";
import { dump, getBytes, getJson, readYaml, writeText } from "../lib.mjs";
import { rawText, untar } from "../tools/sources/fetch.mjs";

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

const detectable = (filetypes) => {
  const names = new Set();
  for (const filetype of filetypes.filetypes) {
    names.add(filetype.id);
    for (const related of filetype.related ?? []) names.add(related);
  }
  return names;
};

export function wantedParsers(parsers, filetypes, skip = new Set()) {
  const names = detectable(filetypes);
  return [...parsers].filter(([name]) => names.has(name) && !skip.has(name));
}

export function undetectableParsers(parsers, filetypes, known = new Set(), skip = new Set()) {
  const names = detectable(filetypes);
  return [...parsers.keys()].filter((name) => !names.has(name) && !known.has(name) && !skip.has(name)).sort();
}

export const UNDETECTABLE = "no filetype of the catalog names this language, so nothing would select its grammar";

const CRATE_ALIASES = { markdown: ["tree-sitter-md"], markdown_inline: ["tree-sitter-md"] };

export function crateNames(name, parser) {
  const last = parser.url.replace(/\/$/, "").split("/").at(-1).replace(/\.git$/, "");
  return [...new Set([last, `tree-sitter-${name.replace(/_/g, "-")}`, ...(CRATE_ALIASES[name] ?? [])])];
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

async function buildsFromTheRoot(crate, version, location) {
  const archive = await getBytes(`https://static.crates.io/crates/${crate}/${crate}-${version}.crate`);
  return untar(gunzipSync(archive)).has(location ? `${location}/src/parser.c` : "src/parser.c");
}

export async function resolveCrates(wanted, { known, log, lookup = release, builds = buildsFromTheRoot, pauseMs = CRATES_PAUSE_MS }) {
  const added = [];
  const skipped = [];
  for (const [name, parser] of wanted) {
    if (known.has(name)) continue;
    let chosen = null;
    for (const crate of crateNames(name, parser)) {
      await pause(pauseMs);
      const version = await lookup(crate, parser);
      if (version) {
        chosen = { crate, version };
        break;
      }
    }
    if (!chosen) {
      skipped.push({ id: name, reason: `no crates.io release published from ${parser.url}` });
      continue;
    }
    if (!(await builds(chosen.crate, chosen.version, parser.location))) {
      skipped.push({ id: name, reason: `${chosen.crate} ${chosen.version} has no grammar at ${parser.location ?? "its root"}` });
      continue;
    }
    added.push({ id: name, ...chosen, ...(parser.location ? { path: parser.location } : {}) });
  }
  log(`resolved ${added.length} grammars and left ${skipped.length} out`);
  return { added, skipped };
}

export const skippedIds = (sources) => new Set((sources.skip ?? []).map((entry) => entry.id));

export async function loadCandidates(sources, only) {
  const lua = await rawText(sources.upstream.repo, sources.upstream.sha, PARSERS_FILE);
  const parsers = parseParsers(lua);
  if (only) {
    const parser = parsers.get(only);
    if (!parser) throw new Error(`${only} is not a parser of ${sources.upstream.repo}`);
    return { wanted: [[only, parser]], undetectable: [] };
  }
  const filetypes = readYaml("tools/filetypes.yaml");
  const skip = skippedIds(sources);
  const known = new Set(sources.grammars.map((grammar) => grammar.id));
  return {
    wanted: wantedParsers(parsers, filetypes, skip),
    undetectable: undetectableParsers(parsers, filetypes, known, skip).map((id) => ({ id, reason: UNDETECTABLE })),
  };
}
