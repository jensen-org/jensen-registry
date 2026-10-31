import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SCHEMA_VERSION, readYaml } from "../lib.mjs";
import { Language, Parser, Query } from "web-tree-sitter";
import { GRAMMARS_FILE, expectedEntries, queryPath, wasmFile } from "./track.mjs";

const METRIC_CAPTURES = new Set(["function", "parameter", "branch", "loop", "boolean", "nesting"]);

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

export function metricsProblems(text, language, label) {
  const problems = [];
  for (const [, capture] of text.matchAll(/@([A-Za-z_][\w.-]*)/g)) {
    if (!METRIC_CAPTURES.has(capture) && !capture.startsWith("_")) problems.push(`${label} captures @${capture}, which is not a metrics capture`);
  }
  try {
    new Query(language, text).delete();
  } catch (error) {
    problems.push(`${label} does not compile: ${String(error.message ?? error).split("\n")[0]}`);
  }
  return problems;
}

export async function validateGrammars({ problems }) {
  await Parser.init();
  const uncovered = [];
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
    for (const query of entry.queries) {
      const text = readFileSync(join(ROOT, queryPath(grammar, query.name)), "utf8");
      if (text.trim() === "") problems.push(`${queryPath(grammar, query.name)} is empty`);
      if (query.name !== "metrics") continue;
      if (!(grammar.own_queries ?? []).includes("metrics")) problems.push(`${queryPath(grammar, query.name)} has no source in grammars/own/${grammar.id}, a version bump would drop it`);
      const language = await Language.load(readFileSync(file));
      problems.push(...metricsProblems(text, language, queryPath(grammar, query.name)));
    }
    if (!entry.queries.some((query) => query.name === "metrics")) uncovered.push(grammar.id);
  }
  console.log(`metrics queries: ${ids.size - uncovered.length} of ${ids.size} grammars covered${uncovered.length ? `, missing ${uncovered.join(", ")}` : ""}`);
  const published = readYaml(GRAMMARS_FILE);
  if (published.schema_version !== SCHEMA_VERSION) problems.push(`${GRAMMARS_FILE}: wrong schema_version`);
  const expected = JSON.stringify(expectedEntries().map(({ entry }) => entry));
  if (JSON.stringify(published.grammars ?? []) !== expected) problems.push(`${GRAMMARS_FILE}: differs from grammars/sources.yaml and grammars/wasm, run npm run track`);
}
