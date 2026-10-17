import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SCHEMA_VERSION, readYaml } from "../lib.mjs";
import { GENERATED_MARKER, expectedEntries, wasmFile } from "./track.mjs";

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
  const tools = readYaml("tools/tools.yaml");
  const published = JSON.stringify(tools.grammars ?? []);
  const expected = JSON.stringify(expectedEntries().map(({ entry }) => entry));
  if (published !== expected) problems.push("tools/tools.yaml: its grammars differ from grammars/sources.yaml and grammars/wasm, run npm run track");
  if (!readFileSync(join(ROOT, "tools/tools.yaml"), "utf8").includes(GENERATED_MARKER)) {
    problems.push("tools/tools.yaml: the generated grammars section is missing, run npm run track");
  }
}
