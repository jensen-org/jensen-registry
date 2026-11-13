import assert from "node:assert/strict";
import test from "node:test";
import { PAGE_SIZE, buildSparse, filetypeShard } from "./sparse.mjs";

const servers = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, index) => ({ id: `s${String(index).padStart(3, "0")}`, description: `server ${index}`, filetypes: index % 2 ? ["rust"] : ["Go", "c"] }));

test("a catalog is cut into pages of a fixed size in id order", () => {
  const files = buildSparse({ servers, formatters: [] });
  assert.equal(JSON.parse(files.get("pages/servers/0.json")).length, PAGE_SIZE);
  assert.equal(JSON.parse(files.get("pages/servers/2.json")).length, 3);
  assert.equal(JSON.parse(files.get("pages/servers/0.json"))[0].id, "s000");
  assert.equal(JSON.parse(files.get("manifest.json")).kinds.servers.pages, 3);
});

test("the search index lets a client filter without opening a page, and points at the page that holds each entry", () => {
  const index = JSON.parse(buildSparse({ servers }).get("search/servers.json"));
  const row = index.find(([id]) => id === "s051");
  assert.deepEqual(row, ["s051", "server 51", ["rust"], 1]);
});

test("a filetype lookup lists the entries of every kind that serve it, sharded by first letter", () => {
  const files = buildSparse({ servers, formatters: [{ id: "gofmt", filetypes: ["Go"] }] });
  const shard = JSON.parse(files.get("by-filetype/g.json"));
  assert.deepEqual(shard.Go.formatters, ["gofmt"]);
  assert.equal(shard.Go.servers.length, 52);
  assert.equal(filetypeShard("8th"), "_");
});

test("the manifest holds the sha256 and size of every other file and the output is deterministic", () => {
  const first = buildSparse({ servers });
  const manifest = JSON.parse(first.get("manifest.json"));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...first.keys()].filter((path) => path !== "manifest.json").sort());
  assert.equal(buildSparse({ servers }).get("manifest.json"), first.get("manifest.json"));
});
