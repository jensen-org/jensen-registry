import assert from "node:assert/strict";
import test from "node:test";
import { applyFailures, parseShard, seedFrom, shardOf } from "./seed.mjs";

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

test("every grammar belongs to exactly one shard whatever the shard count", () => {
  const grammars = Array.from({ length: 23 }, (_, index) => ({ id: `g${String(index).padStart(2, "0")}` }));
  for (const total of [1, 3, 8]) {
    const seen = Array.from({ length: total }, (_, shard) => shardOf(grammars, shard, total).map((grammar) => grammar.id)).flat();
    assert.deepEqual(seen.sort(), grammars.map((grammar) => grammar.id));
  }
});

test("a shard is written index over total and refuses nonsense", () => {
  assert.deepEqual(parseShard("2/8"), { shard: 2, total: 8 });
  assert.throws(() => parseShard("8/8"));
  assert.throws(() => parseShard("x"));
});

test("a grammar that could not build leaves the sources for the ledger with its reason", () => {
  const next = applyFailures({ grammars: [{ id: "ada" }, { id: "huge" }], skip: [{ id: "vim", reason: "exited with 1" }] }, [{ id: "huge", reason: "timed out after 300s" }]);
  assert.deepEqual(next.grammars.map((grammar) => grammar.id), ["ada"]);
  assert.deepEqual(next.skip.map((entry) => entry.id), ["huge", "vim"]);
});
