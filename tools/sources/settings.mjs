import { getBytes, github, sha256 } from "../../lib.mjs";

export const INDEX_PATH = "scripts/gen_json_schemas.lua";
export const DESCRIPTION_LIMIT = 300;

const KEPT = ["type", "default", "enum", "items", "properties", "additionalProperties", "oneOf", "anyOf", "required", "minimum", "maximum", "pattern", "format"];
const ENTRY = /^\s*([A-Za-z_][\w]*)\s*=\s*'(https:\/\/[^']+)'/;
const OVERRIDE = /^\s{2}([A-Za-z_]\w*)\s*=\s*\{\s*$/;
const FLAG = /^\s{4}(translate)\s*=\s*true/;
const PREFIX = /^\s{4}prefix\s*=\s*'([^']*)'/;

export function readIndex(lua) {
  const lines = lua.split("\n");
  const servers = new Map();
  let section = null;
  let current = null;
  for (const line of lines) {
    if (/^local index = \{/.test(line)) section = "index";
    else if (/^local overrides = \{/.test(line)) section = "overrides";
    else if (/^\}/.test(line)) section = null;
    else if (section === "index") {
      const hit = ENTRY.exec(line);
      if (hit) servers.set(hit[1], { url: hit[2] });
    } else if (section === "overrides") {
      const open = OVERRIDE.exec(line);
      if (open) current = open[1];
      else if (current && FLAG.test(line)) servers.get(current) && (servers.get(current).translate = true);
      else if (current && PREFIX.test(line)) servers.get(current) && (servers.get(current).prefix = PREFIX.exec(line)[1]);
    }
  }
  if (!servers.size) throw new Error(`${INDEX_PATH} lists no servers, its format changed`);
  return servers;
}

const cut = (text) => {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > DESCRIPTION_LIMIT ? `${flat.slice(0, DESCRIPTION_LIMIT - 1)}…` : flat;
};

export function prune(node) {
  if (Array.isArray(node)) return node.map(prune);
  if (!node || typeof node !== "object") return node;
  const out = {};
  const text = node.markdownDescription ?? node.description;
  if (typeof text === "string" && text) out.description = cut(text);
  for (const key of KEPT) {
    if (node[key] === undefined) continue;
    if (key === "properties") out.properties = Object.fromEntries(Object.entries(node.properties).map(([name, child]) => [name, prune(child)]));
    else if (key === "default" || key === "enum") out[key] = node[key];
    else out[key] = prune(node[key]);
  }
  return out;
}

export function nest(properties) {
  const root = { type: "object", properties: {} };
  for (const [key, schema] of Object.entries(properties)) {
    const parts = key.split(".").filter(Boolean);
    if (!parts.length) continue;
    let level = root;
    for (const part of parts.slice(0, -1)) {
      level.properties[part] ??= { type: "object", properties: {} };
      level = level.properties[part];
      level.properties ??= {};
    }
    const leaf = parts.at(-1);
    const existing = level.properties[leaf];
    level.properties[leaf] = existing?.properties ? { ...schema, ...existing, properties: { ...(schema.properties ?? {}), ...existing.properties } } : schema;
  }
  return root;
}

export function settingsSchema(document, { prefix = "", nls } = {}) {
  const sections = document?.contributes?.configuration ?? (document?.properties ? document : null);
  if (!sections) throw new Error("it has no contributes.configuration and no properties");
  const properties = {};
  for (const section of Array.isArray(sections) ? sections : [sections]) {
    for (const [key, value] of Object.entries(section.properties ?? {})) if (key !== "$schema") properties[`${prefix}${key}`] = nls ? localized(value, nls) : value;
  }
  if (!Object.keys(properties).length) throw new Error("it declares no settings");
  return prune(nest(Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, prune(value)]))));
}

export function localized(node, table) {
  if (Array.isArray(node)) return node.map((item) => localized(item, table));
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if ((key === "description" || key === "markdownDescription") && typeof value === "string") {
      const hit = table[value.replaceAll("%", "")];
      out[key] = typeof hit === "string" ? hit : typeof hit?.message === "string" ? hit.message : value;
    } else out[key] = localized(value, table);
  }
  return out;
}

const siblingNls = (url) => url.replace(/package\.json$/, "package.nls.json");

const RAW = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/(.+)$/;

export function pinnedUrl(url, commit) {
  const hit = RAW.exec(url);
  if (!hit) throw new Error(`${url} is not a raw.githubusercontent.com url`);
  return `https://raw.githubusercontent.com/${hit[1]}/${hit[2]}/${commit}/${hit[4]}`;
}

export async function headCommit(url) {
  const hit = RAW.exec(url);
  if (!hit) throw new Error(`${url} is not a raw.githubusercontent.com url`);
  const repo = `/repos/${hit[1]}/${hit[2]}`;
  try {
    return (await github(`${repo}/commits/${hit[3]}`)).sha;
  } catch (error) {
    if (error.status !== 422 && error.status !== 404) throw error;
    // raw.githubusercontent keeps serving a renamed default branch, the commits API does not
    return (await github(`${repo}/commits/${(await github(repo)).default_branch}`)).sha;
  }
}

async function download(url, known, repin, { fetchBytes, resolveCommit }) {
  const pin = known.get(url);
  if (!pin && !repin) throw new Error(`${url} is not pinned, run npm run track`);
  const commit = repin ? await resolveCommit(url) : pin.commit;
  const bytes = await fetchBytes(pinnedUrl(url, commit));
  const digest = sha256(bytes);
  if (pin && !repin && pin.sha256 !== digest) throw new Error(`${url} at ${commit} no longer matches its pinned sha256`);
  return { bytes, pin: { commit, sha256: digest } };
}

export async function readSettingsSchemas(lua, ids, { known = new Map(), repin = false, fetchBytes = getBytes, resolveCommit = headCommit } = {}) {
  const index = readIndex(lua);
  const wanted = [...index].filter(([id]) => ids.has(id)).sort(([a], [b]) => (a < b ? -1 : 1));
  const built = new Map();
  const pins = new Map();
  const failures = [];
  await Promise.all(
    wanted.map(async ([id, source]) => {
      try {
        const page = await download(source.url, known, repin, { fetchBytes, resolveCommit });
        pins.set(source.url, page.pin);
        let nls;
        if (source.translate) {
          const table = await download(siblingNls(source.url), known, repin, { fetchBytes, resolveCommit });
          pins.set(siblingNls(source.url), table.pin);
          nls = JSON.parse(table.bytes.toString("utf8"));
        }
        built.set(id, settingsSchema(JSON.parse(page.bytes.toString("utf8")), { prefix: source.prefix, nls }));
      } catch (error) {
        failures.push(`${id} (${source.url}): ${error.message}`);
      }
    }),
  );
  if (failures.length) throw new Error(`settings schemas could not be built:\n${failures.sort().join("\n")}`);
  const schemas = new Map(wanted.map(([id]) => [id, built.get(id)]));
  return { schemas, pins: new Map([...pins].sort(([a], [b]) => (a < b ? -1 : 1))), skipped: [...index.keys()].filter((id) => !ids.has(id)).sort() };
}
