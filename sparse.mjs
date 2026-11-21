import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT, readYaml, sha256 } from "./lib.mjs";

export const SPARSE_DIR = "sparse";
export const PAGE_SIZE = 50;
export const MAX_PAGE_BYTES = 256 * 1024;
const SEARCH_TEXT = 80;

const KINDS = [
  ["servers", "tools/servers.yaml", "servers"],
  ["formatters", "tools/formatters.yaml", "formatters"],
  ["linters", "tools/linters.yaml", "linters"],
  ["debuggers", "tools/debuggers.yaml", "debuggers"],
  ["packages", "tools/packages.yaml", "packages"],
  ["grammars", "grammars/grammars.yaml", "grammars"],
];

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const json = (value) => `${JSON.stringify(value)}\n`;

export const filetypeShard = (filetype) => {
  const first = filetype.charAt(0).toLowerCase();
  return /[a-z]/.test(first) ? first : "_";
};

export function buildSparse(catalogs) {
  const files = new Map();
  const kinds = {};
  const byFiletype = new Map();
  for (const [kind, entries] of Object.entries(catalogs)) {
    const sorted = [...entries].sort(byId);
    const pages = [];
    for (let index = 0; index < sorted.length; index += PAGE_SIZE) pages.push(sorted.slice(index, index + PAGE_SIZE));
    pages.forEach((page, number) => files.set(`pages/${kind}/${number}.json`, json(page)));
    files.set(
      `search/${kind}.json`,
      json(sorted.map((entry) => [entry.id, (entry.description ?? "").slice(0, SEARCH_TEXT), entry.filetypes ?? [], Math.floor(sorted.indexOf(entry) / PAGE_SIZE)])),
    );
    kinds[kind] = { count: sorted.length, pages: pages.length };
    for (const entry of sorted) {
      for (const filetype of entry.filetypes ?? []) {
        const slot = byFiletype.get(filetype) ?? {};
        slot[kind] = [...(slot[kind] ?? []), entry.id];
        byFiletype.set(filetype, slot);
      }
    }
  }
  const shards = new Map();
  for (const [filetype, slot] of [...byFiletype].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const shard = filetypeShard(filetype);
    shards.set(shard, { ...(shards.get(shard) ?? {}), [filetype]: slot });
  }
  for (const [shard, table] of shards) files.set(`by-filetype/${shard}.json`, json(table));
  const listed = {};
  for (const [path, text] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) listed[path] = { sha256: sha256(Buffer.from(text)), size: Buffer.byteLength(text) };
  files.set("manifest.json", json({ schema_version: 1, page_size: PAGE_SIZE, kinds, files: listed }));
  return files;
}

export function loadCatalogs() {
  return Object.fromEntries(KINDS.map(([kind, file, key]) => [kind, readYaml(file)[key] ?? []]));
}

const walk = (folder) =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)]));

export function writeSparse(files) {
  rmSync(join(ROOT, SPARSE_DIR), { recursive: true, force: true });
  for (const [path, text] of files) {
    const target = join(ROOT, SPARSE_DIR, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

export function sparseProblems(files) {
  const problems = [];
  const base = join(ROOT, SPARSE_DIR);
  const present = existsSync(base) ? new Set(walk(base).map((file) => file.slice(base.length + 1))) : new Set();
  for (const [path, text] of files) {
    if (!present.has(path)) problems.push(`${SPARSE_DIR}/${path} is missing, run npm run track`);
    else if (readFileSync(join(base, path), "utf8") !== text) problems.push(`${SPARSE_DIR}/${path} differs from the catalog, run npm run track`);
    if (path.startsWith("pages/") && Buffer.byteLength(text) > MAX_PAGE_BYTES) problems.push(`${SPARSE_DIR}/${path} is larger than ${MAX_PAGE_BYTES} bytes`);
  }
  for (const path of present) if (!files.has(path)) problems.push(`${SPARSE_DIR}/${path} is stale, run npm run track`);
  return problems;
}

export const sparseSize = () => (existsSync(join(ROOT, SPARSE_DIR)) ? walk(join(ROOT, SPARSE_DIR)).reduce((sum, file) => sum + statSync(file).size, 0) : 0);
