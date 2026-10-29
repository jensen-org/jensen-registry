import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { RAW_BASE, ROOT, SCHEMA_VERSION, dump, getBytes, getJson, readYaml, sha256, writeText } from "../lib.mjs";

export const GRAMMARS_FILE = "grammars/grammars.yaml";
export const WASM_DIR = "grammars/wasm";
export const QUERIES_DIR = "grammars/queries";
export const QUERY_NAMES = ["tags", "locals"];
const MAX_QUERY_BYTES = 256 * 1024;

export const wasmFile = (grammar) => `${grammar.id}-${grammar.version}.wasm`;
export const wasmUrl = (grammar) => `${RAW_BASE}/main/${WASM_DIR}/${wasmFile(grammar)}`;
export const wasmPath = (grammar) => `${WASM_DIR}/${wasmFile(grammar)}`;

export const queryPath = (grammar, name) => `${QUERIES_DIR}/${grammar.id}-${grammar.version}/${name}.scm`;
export const queryUrl = (grammar, name) => `${RAW_BASE}/main/${queryPath(grammar, name)}`;

function queryEntries(grammar) {
  return QUERY_NAMES.filter((name) => existsSync(join(ROOT, queryPath(grammar, name)))).map((name) => ({
    name,
    url: queryUrl(grammar, name),
    path: queryPath(grammar, name),
    sha256: sha256(readFileSync(join(ROOT, queryPath(grammar, name)))),
  }));
}

export function expectedEntries() {
  const sources = readYaml("grammars/sources.yaml");
  return sources.grammars.map((grammar) => {
    const file = join(ROOT, WASM_DIR, wasmFile(grammar));
    return {
      grammar,
      file,
      entry: {
        id: grammar.id,
        version: grammar.version,
        url: wasmUrl(grammar),
        path: wasmPath(grammar),
        sha256: existsSync(file) ? sha256(readFileSync(file)) : null,
        queries: queryEntries(grammar),
      },
    };
  });
}

function cliVersion() {
  try {
    return execFileSync("tree-sitter", ["--version"], { encoding: "utf8" }).trim().split(" ").at(-1);
  } catch {
    return null;
  }
}

async function fetchCrate(grammar) {
  const published = await getJson(`https://crates.io/api/v1/crates/${grammar.crate}/${grammar.version}`);
  const archive = await getBytes(`https://static.crates.io/crates/${grammar.crate}/${grammar.crate}-${grammar.version}.crate`);
  if (sha256(archive) !== published.version.checksum) {
    throw new Error(`${grammar.crate} ${grammar.version} does not match the checksum crates.io publishes`);
  }
  const work = mkdtempSync(join(tmpdir(), "grammar-"));
  writeFileSync(join(work, "crate.tar.gz"), archive);
  execFileSync("tar", ["-xzf", "crate.tar.gz"], { cwd: work });
  return { work, source: join(work, `${grammar.crate}-${grammar.version}`) };
}

function regularFileWithin(file, crateRoot) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${file} is not a regular file, refusing to publish it`);
  if (stat.size > MAX_QUERY_BYTES) throw new Error(`${file} is larger than ${MAX_QUERY_BYTES} bytes`);
  if (!realpathSync(file).startsWith(realpathSync(crateRoot) + sep)) throw new Error(`${file} resolves outside the crate`);
}

function inheritedQueries(grammar, name) {
  const sources = readYaml("grammars/sources.yaml");
  return (grammar.inherit_queries ?? [])
    .map((id) => sources.grammars.find((candidate) => candidate.id === id))
    .map((parent) => (parent && existsSync(join(ROOT, queryPath(parent, name))) ? readFileSync(join(ROOT, queryPath(parent, name)), "utf8") : ""))
    .filter((text) => text !== "");
}

async function extractQueries(grammar) {
  const { work, source } = await fetchCrate(grammar);
  try {
    const folders = grammar.path ? [join(source, grammar.path, "queries"), join(source, "queries")] : [join(source, "queries")];
    const folder = folders.find((candidate) => existsSync(candidate));
    if (!folder) return;
    if (lstatSync(folder).isSymbolicLink() || !realpathSync(folder).startsWith(realpathSync(source) + sep)) {
      throw new Error(`${folder} is not a folder inside the crate, refusing to publish it`);
    }
    for (const name of QUERY_NAMES) {
      const from = join(folder, `${name}.scm`);
      if (!existsSync(from)) continue;
      regularFileWithin(from, source);
      mkdirSync(dirname(join(ROOT, queryPath(grammar, name))), { recursive: true });
      const inherited = inheritedQueries(grammar, name);
      if (inherited.length === 0) copyFileSync(from, join(ROOT, queryPath(grammar, name)));
      else writeFileSync(join(ROOT, queryPath(grammar, name)), `${inherited.join("\n")}\n${readFileSync(from, "utf8")}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function build(grammar, wanted) {
  const found = cliVersion();
  if (found !== wanted) {
    throw new Error(`${wasmFile(grammar)} is not built and needs tree-sitter ${wanted}, found ${found ?? "none"}`);
  }
  const { work, source } = await fetchCrate(grammar);
  try {
    mkdirSync(join(ROOT, WASM_DIR), { recursive: true });
    execFileSync("tree-sitter", ["build", "--wasm", "-o", join(ROOT, WASM_DIR, wasmFile(grammar)), grammar.path ?? "."], {
      cwd: source,
      stdio: "inherit",
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function trackGrammars() {
  const sources = readYaml("grammars/sources.yaml");
  const ordered = expectedEntries().sort((a, b) => (a.grammar.inherit_queries ? 1 : 0) - (b.grammar.inherit_queries ? 1 : 0));
  for (const { grammar, file } of ordered) {
    if (!existsSync(file)) await build(grammar, sources.tree_sitter_cli);
    if (queryEntries(grammar).length === 0) await extractQueries(grammar);
  }
  const entries = expectedEntries().map(({ entry }) => entry);
  writeText(GRAMMARS_FILE, dump({ schema_version: SCHEMA_VERSION, grammars: entries }));
  return entries;
}
