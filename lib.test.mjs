import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getBytes, getJson } from "./lib.mjs";
import { requiresOf } from "./tools/generate.mjs";
import { filetypeEntries } from "./tools/sources/filetype.mjs";
import { filetypeMarkerProblems, languageFileProblems, packageRequirementProblems, serverPriorityProblems, workspaceServerProblems } from "./tools/validate.mjs";

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

test("markers come through the generator", () => {
  const table = new Map([["ruby", { extensions: new Set(["rb"]), filenames: new Set() }]]);
  const [entry] = filetypeEntries(table, [], new Map(), { ruby: { markers: ["Gemfile", "Rakefile"] } });
  assert.deepEqual(Object.keys(entry), ["id", "extensions", "markers"]);
  assert.deepEqual(entry.markers, ["Gemfile", "Rakefile"]);
});

test("a marker on an unknown filetype or an empty marker is reported", () => {
  const known = new Set(["ruby", "go"]);
  const languages = { ruby: { markers: ["Gemfile"] }, cobol: { markers: ["x.cob"] }, go: { markers: ["go.mod", ""] } };
  assert.deepEqual(languageFileProblems(languages, known), [
    "tools/overrides/filetypes.yaml: cobol names no filetype in tools/filetypes.yaml",
    "tools/overrides/filetypes.yaml: go lists an empty marker",
  ]);
});

test("a marker in the generated filetypes may not be empty", () => {
  assert.deepEqual(filetypeMarkerProblems([{ id: "go", markers: ["go.mod", " "] }]), ["tools/filetypes.yaml: go lists an empty marker"]);
});

const server = (id, filetypes, extra = {}) => ({ id, package: id, filetypes, ...extra });

test("the top priority server of a filetype must be one server", () => {
  const servers = [server("a", ["x", "y"]), server("b", ["x"]), server("c", ["y"], { priority: 10 }), server("d", ["y"], { priority: 10 })];
  assert.deepEqual(serverPriorityProblems(servers), [
    "tools/servers.yaml: x has no single default, a and b share priority 0",
    "tools/servers.yaml: y has no single default, c and d share priority 10",
  ]);
});

test("a lower tie, an unrunnable server and a server without a package do not count", () => {
  const servers = [server("a", ["x"], { priority: 10 }), server("b", ["x"]), server("c", ["x"]), server("d", ["x"], { priority: 10, runnable: false }), { id: "e", filetypes: ["x"], priority: 10 }];
  assert.deepEqual(serverPriorityProblems(servers), []);
});

test("a workspace required server needs a root marker", () => {
  const servers = [server("a", ["x"], { workspace_required: true }), server("b", ["x"], { workspace_required: true, root_markers: [".git"] }), server("c", ["x"], { workspace_required: true, root_markers: ["go.mod"] })];
  assert.deepEqual(workspaceServerProblems(servers), [
    "tools/servers.yaml: a is workspace_required and lists no root marker",
    "tools/servers.yaml: b is workspace_required and its only root marker is .git",
  ]);
});

test("package requirements are unique lowercase program tokens", () => {
  const packages = [{ id: "ok", requires: ["node", "npm", "python3"] }, { id: "dup", requires: ["node", "node"] }, { id: "space", requires: ["Node js"] }, { id: "empty", requires: [""] }, { id: "none", requires: [] }];
  assert.deepEqual(packageRequirementProblems(packages), [
    "tools/packages.yaml: dup lists requirement node twice",
    "tools/packages.yaml: space requires Node js, which is not a lowercase program name",
    "tools/packages.yaml: empty requires , which is not a lowercase program name",
    "tools/packages.yaml: none lists an empty requires",
  ]);
});

test("a package requires the programs its client and its launchers need", () => {
  const clients = new Map([["npm", "npm"], ["node", "node"], ["pypi", "python3"], ["path", undefined]]);
  assert.deepEqual(requiresOf({ source: "npm", bin: { a: { client: "node" }, b: { client: "path" } } }, clients), ["node", "npm"]);
  assert.deepEqual(requiresOf({ source: "pypi", bin: { a: { client: "path" } } }, clients), ["python3"]);
  assert.equal(requiresOf({ source: "github", bin: { a: { client: "path" } } }, clients), undefined);
});
