import assert from "node:assert/strict";
import test from "node:test";
import { BATCH_DEFAULT, batchLimit, crateNames, parseParsers, wantedParsers, withDiscovered } from "./discover.mjs";

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

test("only parsers of a language the catalog knows, built from the repository root, are wanted", () => {
  const filetypes = { filetypes: [{ id: "ada" }, { id: "csharp", related: ["c_sharp"] }, { id: "apex" }] };
  const wanted = wantedParsers(parseParsers(LUA), filetypes).map(([name]) => name);
  assert.deepEqual(wanted, ["ada", "c_sharp"]);
});

test("the crate is looked up under the repository name first, then under the parser name", () => {
  assert.deepEqual(crateNames("c_sharp", { url: "https://github.com/tree-sitter/tree-sitter-c-sharp.git" }), ["tree-sitter-c-sharp"]);
  assert.deepEqual(crateNames("ada", { url: "https://github.com/briot/ada-grammar" }), ["ada-grammar", "tree-sitter-ada"]);
});

test("discovered grammars join the existing ones in id order and never replace one", () => {
  const sources = { grammars: [{ id: "go", crate: "tree-sitter-go", version: "0.25.0" }, { id: "rust", crate: "tree-sitter-rust", version: "0.24.2" }] };
  const merged = withDiscovered(sources, [{ id: "ada", crate: "tree-sitter-ada", version: "1.0.0" }]);
  assert.deepEqual(merged.grammars.map((grammar) => grammar.id), ["ada", "go", "rust"]);
  assert.equal(merged.grammars.find((grammar) => grammar.id === "go").version, "0.25.0");
});

test("a run takes a bounded batch of new grammars so the job can finish building them", () => {
  assert.equal(batchLimit(undefined), BATCH_DEFAULT);
  assert.equal(batchLimit("3"), 3);
  assert.equal(batchLimit("0"), BATCH_DEFAULT);
  assert.equal(batchLimit("many"), BATCH_DEFAULT);
});
