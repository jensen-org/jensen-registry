import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { Language, Parser } from "web-tree-sitter";
import { metricsProblems } from "./validate.mjs";

let python;

before(async () => {
  await Parser.init();
  python = await Language.load(readFileSync(new URL("./wasm/python-0.25.0.wasm", import.meta.url)));
});

test("a metrics query with known captures and node types has no problems", () => {
  assert.deepEqual(metricsProblems("(function_definition) @function\n(if_statement) @branch", python, "q"), []);
});

test("a node type the grammar does not have is reported", () => {
  const found = metricsProblems("(function_definishun) @function", python, "q");
  assert.equal(found.length, 1);
  assert.match(found[0], /does not compile/);
});

test("a capture outside the metrics set is reported, a leading underscore is a helper", () => {
  const found = metricsProblems('(boolean_operator operator: _ @_op (#any-of? @_op "and")) @boolean\n(function_definition) @other', python, "q");
  assert.deepEqual(found, ["q captures @other, which is not a metrics capture"]);
});
