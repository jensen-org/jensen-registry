import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { DESCRIPTION_LIMIT, localized, nest, prune, readIndex, readSettingsSchemas, settingsSchema } from "./settings.mjs";

const lua = `local index = {
  rust_analyzer = 'https://raw.githubusercontent.com/rust-analyzer/rust-analyzer/master/editors/code/package.json',
  zls = 'https://raw.githubusercontent.com/zigtools/zls/master/schema.json',
  lua_ls = 'https://raw.githubusercontent.com/LuaLS/vscode-lua/master/package.json',
  gone = 'https://raw.githubusercontent.com/example/gone/master/package.json',
}

local overrides = {
  lua_ls = {
    translate = true,
  },
  zls = {
    prefix = 'zls.',
  },
}
`;

const digest = (text) => createHash("sha256").update(text).digest("hex");

test("the index names every server with its prefix and translation flag", () => {
  const index = readIndex(lua);
  assert.equal(index.size, 4);
  assert.equal(index.get("zls").prefix, "zls.");
  assert.equal(index.get("lua_ls").translate, true);
  assert.equal(index.get("rust_analyzer").prefix, undefined);
});

test("an index with no servers fails instead of yielding nothing", () => {
  assert.throws(() => readIndex("local x = 1\n"), /lists no servers/);
});

test("dotted keys become nested objects", () => {
  const schema = nest({ "a.b.c": { type: "string" }, "a.d": { type: "number" }, top: { type: "boolean" } });
  assert.deepEqual(schema.properties.a.properties.b.properties.c, { type: "string" });
  assert.deepEqual(schema.properties.a.properties.d, { type: "number" });
  assert.deepEqual(schema.properties.top, { type: "boolean" });
});

test("a key that is both a setting and a parent keeps both", () => {
  const schema = nest({ "a.b": { type: "string" }, a: { type: "object", description: "parent" } });
  assert.equal(schema.properties.a.description, "parent");
  assert.deepEqual(schema.properties.a.properties.b, { type: "string" });
});

test("pruning keeps the guiding fields and cuts a long description", () => {
  const long = "x".repeat(DESCRIPTION_LIMIT * 2);
  const out = prune({ type: "string", markdownDescription: long, description: "plain", default: "a", enum: ["a", "b"], scope: "window", order: 4, enumDescriptions: ["x", "y"] });
  assert.deepEqual(Object.keys(out).sort(), ["default", "description", "enum", "type"]);
  assert.equal(out.description.length, DESCRIPTION_LIMIT);
  assert.ok(out.description.endsWith("…"));
});

test("pruning reaches nested items and properties", () => {
  const out = prune({ type: "array", items: { type: "string", scope: "x", description: "item" }, properties: { inner: { type: "number", order: 1 } } });
  assert.deepEqual(out.items, { description: "item", type: "string" });
  assert.deepEqual(out.properties.inner, { type: "number" });
});

test("contributes.configuration may be one section or a list", () => {
  const one = { contributes: { configuration: { properties: { "s.a": { type: "string" } } } } };
  const many = { contributes: { configuration: [{ properties: { "s.a": { type: "string" } } }, { properties: { "s.b": { type: "number" } } }] } };
  assert.deepEqual(Object.keys(settingsSchema(one).properties.s.properties), ["a"]);
  assert.deepEqual(Object.keys(settingsSchema(many).properties.s.properties), ["a", "b"]);
});

test("a prefix is put in front of every key", () => {
  const schema = settingsSchema({ properties: { enable: { type: "boolean" } } }, { prefix: "zls." });
  assert.deepEqual(schema.properties.zls.properties.enable, { type: "boolean" });
});

test("the $schema key is not a setting", () => {
  const schema = settingsSchema({ properties: { $schema: { type: "string" }, a: { type: "string" } } });
  assert.deepEqual(Object.keys(schema.properties), ["a"]);
});

test("a document with no configuration fails loudly", () => {
  assert.throws(() => settingsSchema({ name: "x" }), /no contributes.configuration/);
  assert.throws(() => settingsSchema({ contributes: { configuration: { properties: {} } } }), /declares no settings/);
});

test("localized descriptions are looked up in the nls table", () => {
  const out = localized({ description: "%a.b%", nested: { markdownDescription: "%c%", other: "%keep%" } }, { "a.b": "Hello", c: { message: "World" } });
  assert.equal(out.description, "Hello");
  assert.equal(out.nested.markdownDescription, "World");
  assert.equal(out.nested.other, "%keep%");
});

const pages = {
  "https://raw.githubusercontent.com/rust-analyzer/rust-analyzer/master/editors/code/package.json": JSON.stringify({ contributes: { configuration: { properties: { "rust-analyzer.check.command": { type: "string", default: "check" } } } } }),
  "https://raw.githubusercontent.com/zigtools/zls/master/schema.json": JSON.stringify({ properties: { enable_snippets: { type: "boolean" } } }),
  "https://raw.githubusercontent.com/LuaLS/vscode-lua/master/package.json": JSON.stringify({ contributes: { configuration: { properties: { "Lua.runtime.version": { type: "string", description: "%lua.version%" } } } } }),
  "https://raw.githubusercontent.com/LuaLS/vscode-lua/master/package.nls.json": JSON.stringify({ "lua.version": "Runtime version" }),
};
const serve = (table) => async (url) => {
  if (!(url in table)) throw new Error(`404 ${url}`);
  return Buffer.from(table[url]);
};

test("schemas are built for servers the registry has and the rest are reported skipped", async () => {
  const { schemas, pins, skipped } = await readSettingsSchemas(lua, new Set(["rust_analyzer", "zls", "lua_ls"]), { repin: true, fetchBytes: serve(pages) });
  assert.deepEqual([...schemas.keys()], ["lua_ls", "rust_analyzer", "zls"]);
  assert.equal(schemas.get("lua_ls").properties.Lua.properties.runtime.properties.version.description, "Runtime version");
  assert.equal(schemas.get("zls").properties.zls.properties.enable_snippets.type, "boolean");
  assert.deepEqual(skipped, ["gone"]);
  assert.equal(pins.size, 4);
  assert.equal(pins.get("https://raw.githubusercontent.com/zigtools/zls/master/schema.json"), digest(pages["https://raw.githubusercontent.com/zigtools/zls/master/schema.json"]));
});

test("a source that cannot be fetched fails the whole run and names it", async () => {
  const table = { ...pages };
  delete table["https://raw.githubusercontent.com/zigtools/zls/master/schema.json"];
  await assert.rejects(readSettingsSchemas(lua, new Set(["rust_analyzer", "zls"]), { repin: true, fetchBytes: serve(table) }), /zls \(https:\/\/raw.githubusercontent.com\/zigtools\/zls\/master\/schema.json\): 404/);
});

test("a source that is not a settings document fails the whole run", async () => {
  const table = { ...pages, "https://raw.githubusercontent.com/zigtools/zls/master/schema.json": "{}" };
  await assert.rejects(readSettingsSchemas(lua, new Set(["zls"]), { repin: true, fetchBytes: serve(table) }), /zls .*no contributes.configuration/);
});

test("a source that changed after it was pinned fails unless the run re-pins", async () => {
  const url = "https://raw.githubusercontent.com/zigtools/zls/master/schema.json";
  const known = new Map([[url, digest("old")]]);
  await assert.rejects(readSettingsSchemas(lua, new Set(["zls"]), { known, fetchBytes: serve(pages) }), /changed since it was pinned/);
  const fresh = await readSettingsSchemas(lua, new Set(["zls"]), { known, repin: true, fetchBytes: serve(pages) });
  assert.equal(fresh.pins.get(url), digest(pages[url]));
});

test("a source that was never pinned fails unless the run re-pins", async () => {
  await assert.rejects(readSettingsSchemas(lua, new Set(["zls"]), { fetchBytes: serve(pages) }), /is not pinned/);
});
