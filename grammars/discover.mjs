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

export function wantedParsers(parsers, filetypes) {
  const names = new Set();
  for (const filetype of filetypes.filetypes) {
    names.add(filetype.id);
    for (const related of filetype.related ?? []) names.add(related);
  }
  return [...parsers].filter(([name, parser]) => names.has(name) && parser.location === undefined);
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

export async function discoverGrammars({ log = console.log } = {}) {
  const sources = readYaml(SOURCES_FILE);
  const lua = await rawText(sources.upstream.repo, sources.upstream.sha, PARSERS_FILE);
  const wanted = wantedParsers(parseParsers(lua), readYaml("tools/filetypes.yaml"));
  const known = new Set(sources.grammars.map((grammar) => grammar.id));
  const added = [];
  const skipped = [];
  for (const [name, parser] of wanted) {
    if (known.has(name)) continue;
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
  if (added.length) writeText(SOURCES_FILE, dump(withDiscovered(sources, added)));
  log(`discovered ${added.length} grammars, left ${skipped.length} out`);
  for (const line of skipped) log(`  skipped ${line}`);
  return { added, skipped };
}
