import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPackages, parsePurl } from "./mason.mjs";
import { resolveString } from "./mason-template.mjs";

const registry = [
  {
    name: "rust-analyzer",
    languages: ["Rust"],
    categories: ["LSP"],
    source: {
      id: "pkg:github/rust-lang/rust-analyzer@2026-10-19",
      asset: [{ target: "linux_x64_gnu", file: "rust-analyzer-x86_64-unknown-linux-gnu.gz", bin: "rust-analyzer-x86_64-unknown-linux-gnu" }],
    },
    bin: { "rust-analyzer": "{{source.asset.bin}}" },
    neovim: { lspconfig: "rust_analyzer" },
  },
  { name: "prettier", languages: ["CSS"], categories: ["Formatter"], source: { id: "pkg:npm/prettier@3.9.10" }, bin: { prettier: "npm:prettier" } },
  {
    name: "debugpy",
    languages: ["Python"],
    categories: ["DAP"],
    source: { id: "pkg:pypi/debugpy@1.8.22" },
    bin: { "debugpy-adapter": "pyvenv:debugpy.adapter" },
  },
  {
    name: "jdtls",
    languages: ["Java"],
    categories: ["LSP"],
    source: {
      id: "pkg:generic/eclipse/eclipse.jdt.ls@v1.62.0",
      download: [{ target: "linux", files: { "jdtls.tar.gz": "https://example.test/jdt-{{ version | strip_prefix \"v\" }}.tar.gz" } }],
    },
    bin: { jdtls: "python:bin/jdtls" },
  },
  {
    name: "cabal-thing",
    languages: ["Haskell"],
    categories: ["LSP"],
    source: { id: "pkg:generic/x/y@1.0.0", build: [{ target: "unix", run: "cabal install\n", env: { VERSION: "{{version}}" }, bin: { y: "y" } }] },
    bin: { y: "{{source.build.bin.y}}" },
  },
  { name: "old", source: { id: "pkg:npm/old@1.0.0" }, deprecation: { reason: "gone" } },
];

const run = () => buildPackages(registry, { digests: async () => new Map([["rust-analyzer-x86_64-unknown-linux-gnu.gz", "ab".repeat(32)]]) });

test("github asset gets its url, digest and resolved bin", async () => {
  const { packages } = await run();
  const pkg = packages.find((entry) => entry.id === "rust-analyzer");
  assert.equal(pkg.lspconfig, "rust_analyzer");
  assert.deepEqual(pkg.bin, { "rust-analyzer": { client: "path" } });
  assert.equal(pkg.artifacts[0].files[0].url, "https://github.com/rust-lang/rust-analyzer/releases/download/2026-10-19/rust-analyzer-x86_64-unknown-linux-gnu.gz");
  assert.equal(pkg.artifacts[0].files[0].sha256, "ab".repeat(32));
  assert.deepEqual(pkg.artifacts[0].bin, { "rust-analyzer": "rust-analyzer-x86_64-unknown-linux-gnu" });
});

test("npm and pyvenv bins split into client and target", async () => {
  const { packages } = await run();
  assert.deepEqual(packages.find((entry) => entry.id === "prettier").bin, { prettier: { client: "npm", target: "prettier" } });
  assert.deepEqual(packages.find((entry) => entry.id === "debugpy").bin, { "debugpy-adapter": { client: "pyvenv", target: "debugpy.adapter" } });
});

test("generic download resolves strip_prefix", async () => {
  const { packages } = await run();
  assert.equal(packages.find((entry) => entry.id === "jdtls").artifacts[0].files[0].url, "https://example.test/jdt-1.62.0.tar.gz");
});

test("build packages keep their script and are marked", async () => {
  const { packages, summary } = await run();
  const pkg = packages.find((entry) => entry.id === "cabal-thing");
  assert.equal(pkg.runs_script, true);
  assert.equal(pkg.artifacts[0].run, "cabal install\n");
  assert.deepEqual(pkg.artifacts[0].env, { VERSION: "1.0.0" });
  assert.equal(summary.build, 1);
});

test("deprecated packages are dropped and the output is sorted", async () => {
  const { packages, summary } = await run();
  assert.equal(summary.deprecated, 1);
  assert.deepEqual(packages.map((entry) => entry.id), [...packages.map((entry) => entry.id)].sort());
});

test("purls decode scopes, golang subpaths and pypi extras", () => {
  assert.equal(parsePurl("pkg:npm/%40angular/language-server@22.2.3").coordinate, "@angular/language-server");
  assert.equal(parsePurl("pkg:golang/github.com/a/b/v2@v2.4.0#cmd/b").coordinate, "github.com/a/b/v2/cmd/b");
  assert.equal(parsePurl("pkg:pypi/cmakelang@0.6.13?extra=YAML").coordinate, "cmakelang[YAML]");
  assert.equal(parsePurl("pkg:github/o/r@tectonic%400.15.0").version, "tectonic@0.15.0");
});

test("templates cover the filters Mason uses and refuse the rest", () => {
  const context = { version: "tectonic@0.15.0", __targets: ["win_x64"] };
  assert.equal(resolveString('{{ version || strip_prefix "tectonic@" }}', context), "0.15.0");
  assert.equal(resolveString('x{{ take_if_not(is_platform("win"), ".py") }}', context), "x");
  assert.equal(resolveString('x{{ take_if_not(is_platform("win"), ".py") }}', { ...context, __targets: ["linux_x64"] }), "x.py");
  assert.throws(() => resolveString("{{ version | shout }}", context));
});
