import assert from "node:assert/strict";
import { test } from "node:test";
import { Untranslatable, errorformatToPatterns, luaPatternToRegex, translateParser } from "./patterns.mjs";

const groups = (regex, text) => new RegExp(regex).exec(text)?.groups;

test("flake8 style pattern", () => {
  const regex = luaPatternToRegex("[^:]+:(%d+):(%d+):(%w+):(.+)", ["line", "column", "code", "message"]);
  assert.deepEqual({ ...groups(regex, "a.py:12:5:E501:line too long") }, { line: "12", column: "5", code: "E501", message: "line too long" });
});

test("lazy quantifier and anchors", () => {
  const regex = luaPatternToRegex("^(.-):(%d+): (.*)$", ["path", "line", "message"]);
  assert.deepEqual({ ...groups(regex, "src/a.lua:3: unexpected") }, { path: "src/a.lua", line: "3", message: "unexpected" });
});

test("escaped punctuation and sets", () => {
  const regex = luaPatternToRegex("%[([%a_]+)%] (.*)", ["code", "message"]);
  assert.deepEqual({ ...groups(regex, "[no_unused] x") }, { code: "no_unused", message: "x" });
});

test("patterns that cannot be translated are refused", () => {
  assert.throws(() => luaPatternToRegex("%b()", []), Untranslatable);
  assert.throws(() => luaPatternToRegex("%f[%w]x", []), Untranslatable);
  assert.throws(() => luaPatternToRegex("()x", []), Untranslatable);
});

test("capture count must match the group names", () => {
  assert.throws(() => luaPatternToRegex("(a)(b)", ["x"]), Untranslatable);
});

test("errorformat becomes named regexes", () => {
  const [regex] = errorformatToPatterns("%f:%l:%c: %m");
  assert.deepEqual({ ...groups(regex, "a.sh:4:9: bad thing") }, { path: "a.sh", line: "4", column: "9", message: "bad thing" });
  assert.equal(errorformatToPatterns("%f:%l: %m,%f: %m").length, 2);
  assert.throws(() => errorformatToPatterns("%A%f:%l"), Untranslatable);
});

test("from_pattern parsers carry severity and defaults", () => {
  const parsed = translateParser({ parser: "pattern", pattern: "(%d+): (%a+): (.*)", groups: ["lnum", "severity", "message"], severity: { error: 1 }, defaults: { source: "x" } });
  assert.equal(parsed.kind, "regex");
  assert.deepEqual(parsed.severity, { error: 1 });
  assert.deepEqual({ ...groups(parsed.patterns[0], "7: error: boom") }, { line: "7", severity: "error", message: "boom" });
});
