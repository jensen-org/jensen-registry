import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Language, Parser, Query } from "web-tree-sitter";
import { ROOT, dump, readYaml, writeText } from "../lib.mjs";
import { OWN_QUERIES_DIR, fetchCrate, queryPath, regularFileWithin, wasmPath } from "./track.mjs";

const MAX_NODE_TYPES_BYTES = 8 * 1024 * 1024;

const KINDS = [
  ["function", /(^|_)(function|func|fn|procedure|subroutine|def)(_|$)/],
  ["method", /(^|_)method(_|$)/],
  ["class", /(^|_)(class|object)(_|$)/],
  ["interface", /(^|_)(interface|protocol|trait)(_|$)/],
  ["module", /(^|_)(module|namespace|package)(_|$)/],
  ["type", /(^|_)(struct|enum|union|record|type|typedef)(_|$)/],
  ["constant", /(^|_)(const|constant)(_|$)/],
  ["macro", /(^|_)macro(_|$)/],
];
const DEFINITION = /(definition|declaration|item|statement|def|specifier|spec)$/;
const IMPORT_TYPE = /^(import|include|use|require|using|load|source|extern_crate)(_(statement|declaration|directive|clause|item|spec|specifier|command|stmt))?$/;
const IMPORT_FIELDS = ["source", "path", "module_name", "module", "name", "argument", "library", "file"];

const named = (nodeTypes) => nodeTypes.filter((node) => node.named && typeof node.type === "string" && !node.type.startsWith("_"));
const hasField = (node, field) => Object.hasOwn(node.fields ?? {}, field);

export function generateTags(nodeTypes) {
  const rules = [];
  for (const node of named(nodeTypes)) {
    if (!hasField(node, "name") || !DEFINITION.test(node.type)) continue;
    const kind = KINDS.find(([, pattern]) => pattern.test(node.type))?.[0];
    if (kind) rules.push(`(${node.type} name: (_) @name) @definition.${kind}`);
  }
  return rules.length ? `${[...new Set(rules)].sort().join("\n")}\n` : null;
}

export function generateImports(nodeTypes) {
  const rules = [];
  for (const node of named(nodeTypes)) {
    if (!IMPORT_TYPE.test(node.type)) continue;
    const field = IMPORT_FIELDS.find((candidate) => hasField(node, candidate));
    if (field) rules.push(`(${node.type} ${field}: (_) @import)`);
  }
  return rules.length ? `${[...new Set(rules)].sort().join("\n")}\n` : null;
}

export async function compiles(language, text) {
  try {
    new Query(language, text).delete();
    return true;
  } catch {
    return false;
  }
}

const GENERATED = { tags: generateTags, imports: generateImports };

export async function generateQueries({ log = console.log } = {}) {
  await Parser.init();
  const sources = readYaml("grammars/sources.yaml");
  let written = 0;
  for (const grammar of sources.grammars) {
    const have = new Set(grammar.own_queries ?? []);
    const missing = Object.keys(GENERATED).filter((name) => !have.has(name) && !existsSync(join(ROOT, queryPath(grammar, name))));
    if (!missing.length) continue;
    const { work, source } = await fetchCrate(grammar);
    try {
      const file = join(source, grammar.path ?? ".", "src/node-types.json");
      if (!existsSync(file)) continue;
      regularFileWithin(file, source, MAX_NODE_TYPES_BYTES);
      const nodeTypes = JSON.parse(readFileSync(file, "utf8"));
      const language = await Language.load(readFileSync(join(ROOT, wasmPath(grammar))));
      for (const name of missing) {
        const text = GENERATED[name](nodeTypes);
        if (!text || !(await compiles(language, text))) continue;
        mkdirSync(join(ROOT, OWN_QUERIES_DIR, grammar.id), { recursive: true });
        writeFileSync(join(ROOT, OWN_QUERIES_DIR, grammar.id, `${name}.scm`), text);
        grammar.own_queries = [...(grammar.own_queries ?? []), name];
        written += 1;
        log(`  generated ${name} for ${grammar.id}`);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  writeText("grammars/sources.yaml", dump(sources));
  log(`generated ${written} queries`);
  return written;
}
