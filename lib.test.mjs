import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getBytes, getJson } from "./lib.mjs";
import { filetypeLanguageProblems } from "./tools/validate.mjs";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const noWait = { sleep: async () => {} };

function script(steps) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  return calls;
}

const answer = (status, body = "{}", headers = {}) => new Response(body, { status, headers });

test("getJson retries gateway errors and network failures until the upstream answers", async () => {
  const calls = script([answer(504, "<html>"), new TypeError("fetch failed"), answer(200, '{"ok":true}')]);
  assert.deepEqual(await getJson("https://example.test/a", {}, noWait), { ok: true });
  assert.equal(calls.length, 3);
});

test("getBytes gives up with the last answer once the attempts are spent", async () => {
  const calls = script([answer(503)]);
  await assert.rejects(() => getBytes("https://example.test/b", { ...noWait, attempts: 3 }), { status: 503 });
  assert.equal(calls.length, 3);
});

test("a client error is reported at once without a retry", async () => {
  const calls = script([answer(404)]);
  await assert.rejects(() => getJson("https://example.test/c", {}, noWait), { status: 404 });
  assert.equal(calls.length, 1);
});

test("a network failure that never recovers is thrown after the last attempt", async () => {
  const calls = script([new TypeError("fetch failed")]);
  await assert.rejects(() => getBytes("https://example.test/d", { ...noWait, attempts: 2 }), TypeError);
  assert.equal(calls.length, 2);
});

const published = new Set(["bash", "html", "javascript", "typescript"]);

test("filetypes that name published grammars and plain interpreters have no problems", () => {
  const filetypes = [
    { id: "sh", grammar: "bash", interpreters: ["sh", "bash"] },
    { id: "vue", grammar: "html", embeds: ["javascript", "typescript"] },
    { id: "perl", interpreters: ["perl"] },
  ];
  assert.deepEqual(filetypeLanguageProblems(filetypes, published), []);
});

test("a grammar or embeds id that grammars.yaml does not publish is reported", () => {
  const filetypes = [
    { id: "cs", grammar: "c_sharp" },
    { id: "svelte", grammar: "html", embeds: ["javascript", "tsx"] },
  ];
  assert.deepEqual(filetypeLanguageProblems(filetypes, published), [
    "tools/filetypes.yaml: cs names grammar c_sharp, which grammars/grammars.yaml does not publish",
    "tools/filetypes.yaml: svelte embeds grammar tsx, which grammars/grammars.yaml does not publish",
  ]);
});

test("an interpreter must be a plain program name claimed by one filetype", () => {
  const filetypes = [
    { id: "sh", interpreters: ["/bin/sh", "env bash"] },
    { id: "zsh", interpreters: ["zsh"] },
    { id: "bash", interpreters: ["zsh"] },
  ];
  assert.deepEqual(filetypeLanguageProblems(filetypes, published), [
    "tools/filetypes.yaml: sh lists interpreter /bin/sh, which is not a plain program name",
    "tools/filetypes.yaml: sh lists interpreter env bash, which is not a plain program name",
    "tools/filetypes.yaml: bash lists interpreter zsh, which zsh already lists",
  ]);
});
