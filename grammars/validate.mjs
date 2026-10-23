import { readFileSync } from "node:fs";
import { SCHEMA_VERSION, readYaml } from "../lib.mjs";
import { GRAMMARS_FILE, expectedEntries, wasmFile } from "./track.mjs";

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

export function validateGrammars({ problems }) {
  const sources = readYaml("grammars/sources.yaml");
  if (sources.schema_version !== SCHEMA_VERSION) problems.push("grammars/sources.yaml: wrong schema_version");
  const ids = new Set();
  for (const { grammar, file, entry } of expectedEntries()) {
    if (ids.has(grammar.id)) problems.push(`grammars/sources.yaml: ${grammar.id} is listed twice`);
    ids.add(grammar.id);
    if (entry.sha256 === null) {
      problems.push(`grammars/wasm/${wasmFile(grammar)} is missing, run npm run track`);
      continue;
    }
    if (!readFileSync(file).subarray(0, 4).equals(WASM_MAGIC)) problems.push(`grammars/wasm/${wasmFile(grammar)} is not a wasm module`);
  }
  const published = readYaml(GRAMMARS_FILE);
  if (published.schema_version !== SCHEMA_VERSION) problems.push(`${GRAMMARS_FILE}: wrong schema_version`);
  const expected = JSON.stringify(expectedEntries().map(({ entry }) => entry));
  if (JSON.stringify(published.grammars ?? []) !== expected) problems.push(`${GRAMMARS_FILE}: differs from grammars/sources.yaml and grammars/wasm, run npm run track`);
}
