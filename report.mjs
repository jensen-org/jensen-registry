import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readYaml } from "./lib.mjs";

const QUERY_KINDS = ["tags", "locals", "injections", "imports", "metrics"];

export function coverage({ filetypes, grammars, sources, servers, formatters, linters }) {
  const grammarIds = new Set(grammars.map((grammar) => grammar.id));
  const covered = (type, lists) => lists.some((list) => list.some((entry) => (entry.filetypes ?? []).includes(type.id)));
  const grammarOf = (type) => [type.id, type.grammar, ...(type.related ?? [])].some((name) => name && grammarIds.has(name));
  const missing = (test) => filetypes.filter((type) => !test(type)).map((type) => type.id);
  const queries = Object.fromEntries(QUERY_KINDS.map((kind) => [kind, grammars.filter((grammar) => (grammar.queries ?? []).some((query) => query.name === kind)).length]));
  const ledger = sources.skip ?? [];
  const totalBytes = grammars.length;
  return {
    filetypes: filetypes.length,
    grammars: totalBytes,
    ledger: ledger.length,
    queries,
    withGrammar: filetypes.length - missing(grammarOf).length,
    withServer: filetypes.length - missing((type) => covered(type, [servers])).length,
    withFormatter: filetypes.length - missing((type) => covered(type, [formatters])).length,
    withLinter: filetypes.length - missing((type) => covered(type, [linters])).length,
    withoutGrammar: missing(grammarOf),
    withoutServer: missing((type) => covered(type, [servers])),
    grammarsWithoutImports: grammars.filter((grammar) => !(grammar.queries ?? []).some((query) => query.name === "imports")).map((grammar) => grammar.id),
  };
}

export function loadCoverage() {
  return coverage({
    filetypes: readYaml("tools/filetypes.yaml").filetypes,
    grammars: readYaml("grammars/grammars.yaml").grammars,
    sources: readYaml("grammars/sources.yaml"),
    servers: readYaml("tools/servers.yaml").servers,
    formatters: readYaml("tools/formatters.yaml").formatters,
    linters: readYaml("tools/linters.yaml").linters,
  });
}

export function formatReport(result) {
  const lines = [
    `filetypes ${result.filetypes}, grammars ${result.grammars}, ledger ${result.ledger}`,
    `filetypes with a grammar ${result.withGrammar}, a server ${result.withServer}, a formatter ${result.withFormatter}, a linter ${result.withLinter}`,
    `grammars with queries: ${Object.entries(result.queries).map(([kind, count]) => `${kind} ${count}`).join(", ")}`,
    `grammars without an imports query: ${result.grammarsWithoutImports.length}`,
  ];
  return lines.join("\n");
}

export const BASELINE_FILE = "coverage.baseline.json";

const floorOf = (result) => ({
  grammars: result.grammars,
  withGrammar: result.withGrammar,
  withServer: result.withServer,
  withFormatter: result.withFormatter,
  withLinter: result.withLinter,
  queries: result.queries,
});

export function regressions(result, baseline) {
  const now = floorOf(result);
  const found = [];
  for (const [key, floor] of Object.entries(baseline)) {
    if (key === "queries") {
      for (const [kind, count] of Object.entries(floor)) if ((now.queries[kind] ?? 0) < count) found.push(`${kind} queries dropped from ${count} to ${now.queries[kind] ?? 0}`);
    } else if (now[key] < floor) found.push(`${key} dropped from ${floor} to ${now[key]}`);
  }
  return found;
}

export function writeBaseline(result) {
  writeFileSync(join(ROOT, BASELINE_FILE), `${JSON.stringify(floorOf(result), null, 2)}\n`);
}

export function baselineProblems(result) {
  const file = join(ROOT, BASELINE_FILE);
  if (!existsSync(file)) return [`${BASELINE_FILE} is missing, run node registry.mjs report --update`];
  return regressions(result, JSON.parse(readFileSync(file, "utf8"))).map((line) => `coverage regressed: ${line}`);
}
