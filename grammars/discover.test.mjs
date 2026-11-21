import assert from "node:assert/strict";
import test from "node:test";
import { UNDETECTABLE, crateNames, parseParsers, resolveCrates, undetectableParsers, wantedParsers, withDiscovered } from "./discover.mjs";

const LUA = `---@type nvim-ts.parsers
return {
  ada = {
    install_info = {
      revision = 'a45fd9c65a791cbe7d146e85a53fbe43a6d52a61',
      url = 'https://github.com/briot/tree-sitter-ada',
    },
    tier = 2,
  },
  apex = {
    install_info = {
      location = 'apex',
      revision = 'da568eee10ce4724a40f368b2b7e795dacb4f1ba',
      url = 'https://github.com/aheber/tree-sitter-sfapex',
    },
  },
  c_sharp = {
    install_info = {
      revision = 'abc',
      url = 'https://github.com/tree-sitter/tree-sitter-c-sharp.git',
    },
  },
}
`;

test("every parser with a repository is read, with its subfolder when it has one", () => {
  const parsers = parseParsers(LUA);
  assert.deepEqual([...parsers.keys()], ["ada", "apex", "c_sharp"]);
  assert.equal(parsers.get("apex").location, "apex");
  assert.equal(parsers.get("ada").url, "https://github.com/briot/tree-sitter-ada");
});

test("every parser of a language the catalog knows is wanted, subfolder grammars included", () => {
  const filetypes = { filetypes: [{ id: "ada" }, { id: "csharp", related: ["c_sharp"] }, { id: "apex" }] };
  const wanted = wantedParsers(parseParsers(LUA), filetypes).map(([name]) => name);
  assert.deepEqual(wanted, ["ada", "apex", "c_sharp"]);
});

test("the crate is looked up under the repository name first, then under the parser name", () => {
  assert.deepEqual(crateNames("c_sharp", { url: "https://github.com/tree-sitter/tree-sitter-c-sharp.git" }), ["tree-sitter-c-sharp"]);
  assert.deepEqual(crateNames("ada", { url: "https://github.com/briot/ada-grammar" }), ["ada-grammar", "tree-sitter-ada"]);
});

test("a language whose crate carries another name is looked up under it too", () => {
  assert.ok(crateNames("markdown", { url: "https://github.com/tree-sitter-grammars/tree-sitter-markdown" }).includes("tree-sitter-md"));
});

test("discovered grammars join the existing ones in id order and never replace one", () => {
  const sources = { grammars: [{ id: "go", crate: "tree-sitter-go", version: "0.25.0" }, { id: "rust", crate: "tree-sitter-rust", version: "0.24.2" }] };
  const merged = withDiscovered(sources, [{ id: "ada", crate: "tree-sitter-ada", version: "1.0.0" }]);
  assert.deepEqual(merged.grammars.map((grammar) => grammar.id), ["ada", "go", "rust"]);
  assert.equal(merged.grammars.find((grammar) => grammar.id === "go").version, "0.25.0");
});

test("a parser no filetype can detect is named so it can be recorded instead of dropped", () => {
  const filetypes = { filetypes: [{ id: "ada" }] };
  assert.deepEqual(undetectableParsers(parseParsers(LUA), filetypes), ["apex", "c_sharp"]);
  assert.deepEqual(undetectableParsers(parseParsers(LUA), filetypes, new Set(["apex"]), new Set(["c_sharp"])), []);
  assert.match(UNDETECTABLE, /no filetype/);
});

test("one run resolves every candidate, however many there are, and records why each other one is left out", async () => {
  const wanted = Array.from({ length: 40 }, (_, index) => [`lang${index}`, { url: `https://github.com/o/tree-sitter-lang${index}`, location: index % 10 === 0 ? "sub" : undefined }]);
  const lookup = async (crate) => (crate.endsWith("7") ? null : "1.0.0");
  const builds = async (crate, version, location) => !(location && crate.endsWith("20"));
  const { added, skipped } = await resolveCrates(wanted, { known: new Set(["lang1"]), log: () => {}, lookup, builds, pauseMs: 0 });
  assert.equal(added.length + skipped.length, 39);
  assert.ok(added.length > 6);
  assert.equal(added.find((entry) => entry.id === "lang10").path, "sub");
  assert.equal(added.find((entry) => entry.id === "lang2").path, undefined);
  assert.match(skipped.find((entry) => entry.id === "lang7").reason, /no crates.io release/);
  assert.match(skipped.find((entry) => entry.id === "lang20").reason, /no grammar at sub/);
  assert.ok(!added.some((entry) => entry.id === "lang1"));
});
