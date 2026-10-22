import assert from "node:assert/strict";
import { test } from "node:test";
import { readModule } from "./lua.mjs";

test("literal tables, concatenation and locals are read", () => {
  const { value, misses } = readModule(`
    local name = "ruff"
    return { cmd = { name .. "-lsp", "--stdio" }, filetypes = { "python" }, flag = true, n = 3 }
  `);
  assert.deepEqual(value, { cmd: ["ruff-lsp", "--stdio"], filetypes: ["python"], flag: true, n: 3 });
  assert.deepEqual(misses, []);
});

test("functions are counted with their field path and left out", () => {
  const { value, misses } = readModule(`return { command = "x", args = function() return {} end, nested = { a = 1, b = function() end } }`);
  assert.deepEqual(value, { command: "x", nested: { a: 1 } });
  assert.deepEqual(misses.sort(), ["args", "nested.b"]);
});

test("known helpers are recognised by name", () => {
  const { value } = readModule(`
    local util = require("conform.util")
    return { command = util.from_node_modules("prettier"), cwd = util.root_file({ "a.toml", ".b" }) }
  `);
  assert.deepEqual(value, { command: "prettier", cwd: { root_markers: ["a.toml", ".b"] } });
});

test("severity constants and parser helpers resolve", () => {
  const { value } = readModule(`
    local severities = { error = vim.diagnostic.severity.ERROR, warning = vim.diagnostic.severity.WARN }
    return { parser = require('lint.parser').from_pattern('(%d+): (.*)', { 'lnum', 'message' }, severities, { source = 'x' }) }
  `);
  assert.deepEqual(value.parser.severity, { error: 1, warning: 2 });
  assert.equal(value.parser.pattern, "(%d+): (.*)");
});

test("module tables built by assignment are read", () => {
  const { value } = readModule(`local M = {}\nM.python = { "py" }\nM["go"] = { "go" }\nreturn M`);
  assert.deepEqual(value, { python: ["py"], go: ["go"] });
});

test("or falls back to the literal side", () => {
  assert.deepEqual(readModule(`return { a = vim.fn.foo() or "b" }`).value, { a: "b" });
});

test("buffer path functions read as the file placeholder", () => {
  const { value } = readModule(`return { args = { "--stdin", function() return vim.api.nvim_buf_get_name(0) end } }`);
  assert.deepEqual(value.args, ["--stdin", "{file}"]);
});

test("exepath resolves to a bin name and shifted arrays are dropped", async () => {
  const { dropShiftedArrays } = await import("./lua.mjs");
  const { value, misses } = readModule(`return { command = vim.fn.exepath("debugpy-adapter"), args = { "a", function() return 1 end, "c" } }`);
  assert.deepEqual(value.command, { bin: "debugpy-adapter" });
  assert.deepEqual(dropShiftedArrays(value, misses).args, undefined);
});

test("long bracket strings keep their content", () => {
  assert.equal(readModule("return { a = [[(%d+):(.*)]], b = [=[x[1]y]=] }").value.a, "(%d+):(.*)");
  assert.equal(readModule("return { b = [=[x[1]y]=] }").value.b, "x[1]y");
});
