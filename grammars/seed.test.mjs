import assert from "node:assert/strict";
import test from "node:test";
import { seedFrom } from "./seed.mjs";

const sources = { grammars: [{ id: "go", crate: "tree-sitter-go", version: "0.25.0" }], skip: [{ id: "gitcommit", reason: "needs 12 GB to compile" }] };
const added = [
  { id: "ada", crate: "tree-sitter-ada", version: "1.0.0" },
  { id: "huge", crate: "tree-sitter-huge", version: "1.0.0" },
];

test("everything that builds joins the sources and what cannot build is skipped with its reason", async () => {
  const attempt = async (grammar) => (grammar.id === "huge" ? { ok: false, reason: "timed out after 300s" } : { ok: true });
  const { next, built, skipped } = await seedFrom({ sources, added, attempt, log: () => {} });
  assert.deepEqual(built.map((grammar) => grammar.id), ["ada"]);
  assert.deepEqual(next.grammars.map((grammar) => grammar.id), ["ada", "go"]);
  assert.deepEqual(next.skip.map((entry) => entry.id), ["gitcommit", "huge"]);
  assert.match(skipped[0], /huge: timed out/);
});

test("a run where only skipped entries remain still succeeds", async () => {
  const { built } = await seedFrom({ sources, added: [], attempt: async () => ({ ok: true }), log: () => {} });
  assert.deepEqual(built, []);
});
