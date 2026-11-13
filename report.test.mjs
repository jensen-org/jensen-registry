import assert from "node:assert/strict";
import test from "node:test";
import { coverage, formatReport, regressions } from "./report.mjs";

const input = {
  filetypes: [{ id: "rust" }, { id: "cs", grammar: "c_sharp" }, { id: "odd" }],
  grammars: [{ id: "rust", queries: [{ name: "tags" }, { name: "imports" }] }, { id: "c_sharp", queries: [{ name: "tags" }] }],
  sources: { skip: [{ id: "vim", reason: "x" }] },
  servers: [{ id: "ra", filetypes: ["rust"] }],
  formatters: [{ id: "rustfmt", filetypes: ["rust"] }],
  linters: [],
};

test("coverage counts what each filetype has and names what is missing", () => {
  const result = coverage(input);
  assert.equal(result.withGrammar, 2);
  assert.equal(result.withServer, 1);
  assert.equal(result.withLinter, 0);
  assert.deepEqual(result.withoutGrammar, ["odd"]);
  assert.deepEqual(result.queries, { tags: 2, locals: 0, injections: 0, imports: 1, metrics: 0 });
  assert.deepEqual(result.grammarsWithoutImports, ["c_sharp"]);
  assert.equal(result.ledger, 1);
});

test("the report is readable at a glance", () => {
  assert.match(formatReport(coverage(input)), /filetypes 3, grammars 2, ledger 1/);
});

test("a count that drops below the committed baseline is a regression and a rise is not", () => {
  const result = coverage(input);
  assert.deepEqual(regressions(result, { withServer: 1, queries: { tags: 2 } }), []);
  assert.deepEqual(regressions(result, { withServer: 2, queries: { tags: 3 } }), ["withServer dropped from 2 to 1", "tags queries dropped from 3 to 2"]);
});
