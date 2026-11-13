import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpProblems } from "./checks.mjs";
import { loadEntries, validator } from "../lib.mjs";

const stdio = {
  id: "bridge",
  transport: "stdio",
  env: [],
  design_bridge: { script: { tool: "run", code: "code" } },
};

test("a stdio design bridge passes", () => {
  assert.deepEqual(mcpProblems(stdio, "mcp/bridge.yaml"), []);
});

test("a design bridge must run on this machine", () => {
  const problems = mcpProblems({ ...stdio, transport: "http" }, "mcp/bridge.yaml");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /must be a stdio server/);
});

test("the enabling variable is a fixed value, not a user setting", () => {
  const entry = {
    ...stdio,
    env: [{ name: "ENABLE", secret: false }],
    design_bridge: { script: { tool: "run", code: "code", enable: { env: "ENABLE", value: "1" } } },
  };
  assert.match(mcpProblems(entry, "mcp/bridge.yaml")[0], /cannot also be an env variable/);
});

test("the shipped design bridges satisfy the schema and the checks", () => {
  const check = validator()("mcp", "mcpEntry");
  const bridges = loadEntries("mcp").filter(({ entry }) => entry.design_bridge);
  assert.ok(bridges.length >= 2);
  for (const { path, entry } of bridges) {
    assert.deepEqual(check(entry, path), []);
    assert.deepEqual(mcpProblems(entry, path), []);
  }
});

test("a profile without a script tool is refused by the schema", () => {
  const check = validator()("mcp", "mcpEntry");
  const entry = { ...stdio, description: "x", advised: false, package: { ecosystem: "npm", name: "x", bin: "x" }, design_bridge: { status: { tool: "s" } } };
  assert.ok(check(entry, "mcp/bridge.yaml").length > 0);
});
