import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RAW_BASE, ROOT, SCHEMA_VERSION, dump, getBytes, getJson, readYaml, sha256, writeText } from "../lib.mjs";

export const GRAMMARS_FILE = "grammars/grammars.yaml";
export const WASM_DIR = "grammars/wasm";

export const wasmFile = (grammar) => `${grammar.id}-${grammar.version}.wasm`;
export const wasmUrl = (grammar) => `${RAW_BASE}/main/${WASM_DIR}/${wasmFile(grammar)}`;
export const wasmPath = (grammar) => `${WASM_DIR}/${wasmFile(grammar)}`;

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

async function build(grammar, wanted) {
  const found = cliVersion();
  if (found !== wanted) {
    throw new Error(`${wasmFile(grammar)} is not built and needs tree-sitter ${wanted}, found ${found ?? "none"}`);
  }
  const published = await getJson(`https://crates.io/api/v1/crates/${grammar.crate}/${grammar.version}`);
  const archive = await getBytes(`https://static.crates.io/crates/${grammar.crate}/${grammar.crate}-${grammar.version}.crate`);
  if (sha256(archive) !== published.version.checksum) {
    throw new Error(`${grammar.crate} ${grammar.version} does not match the checksum crates.io publishes`);
  }
  const work = mkdtempSync(join(tmpdir(), "grammar-"));
  try {
    writeFileSync(join(work, "crate.tar.gz"), archive);
    execFileSync("tar", ["-xzf", "crate.tar.gz"], { cwd: work });
    const source = join(work, `${grammar.crate}-${grammar.version}`);
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
  for (const { grammar, file } of expectedEntries()) {
    if (!existsSync(file)) await build(grammar, sources.tree_sitter_cli);
  }
  const entries = expectedEntries().map(({ entry }) => entry);
  writeText(GRAMMARS_FILE, dump({ schema_version: SCHEMA_VERSION, grammars: entries }));
  return entries;
}
