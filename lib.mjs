import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse, stringify } from "yaml";

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_VERSION = 1;
export const TOOLS_SCHEMA_VERSION = 2;
export const RAW_BASE = "https://raw.githubusercontent.com/jensen-org/jensen-registry";
export const SCHEMA_BASE = "https://github.com/jensen-org/jensen-registry";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const readYaml = (path) => parse(readFileSync(join(ROOT, path), "utf8"));

export const dump = (value) => stringify(value, { lineWidth: 0, sortMapEntries: false });

export const writeText = (path, text) => writeFileSync(join(ROOT, path), text);

export function entryFiles(dir) {
  if (!existsSync(join(ROOT, dir))) return [];
  return readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => `${dir}/${name}`);
}

export function loadEntries(dir) {
  return entryFiles(dir).map((path) => ({ path, entry: readYaml(path) }));
}

export function contentHash(files) {
  const lines = [...files]
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
    .map((file) => `${file.path}\0${file.sha256}\n`)
    .join("");
  return sha256(lines);
}

export function purl(ecosystem, name, version) {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:${ecosystem}/${encoded}@${version}`;
}

const SCHEMAS = ["skills", "mcp", "integrations"];

export function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const schemas = SCHEMAS.map((folder) => JSON.parse(readFileSync(join(ROOT, folder, "schema.json"), "utf8")));
  for (const schema of schemas) ajv.addSchema(schema);
  return (folder, name) => {
    const schema = schemas[SCHEMAS.indexOf(folder)];
    const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
    return (value, label) => {
      if (validate(value)) return [];
      return validate.errors.map((e) => `${label}: ${e.instancePath || "/"} ${e.message}`);
    };
  };
}

export async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { "user-agent": "jensen-registry", ...headers } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

export async function getBytes(url) {
  const response = await fetch(url, { headers: { "user-agent": "jensen-registry" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const githubHeaders = process.env.GITHUB_TOKEN
  ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" }
  : { accept: "application/vnd.github+json" };

export const github = (path) => getJson(`https://api.github.com${path}`, githubHeaders);

const TOOL_FILES = ["packages", "servers", "formatters", "linters", "debuggers", "filetypes", "unresolved", "testrunners", "entrypoints"].map((name) => `tools/${name}.yaml`);

export const checksummed = () => [
  "index.yaml",
  "grammars/grammars.yaml",
  "tools/upstreams.yaml",
  ...TOOL_FILES,
  ...TOOL_FILES.map((file) => file.replace("tools/", "tools/schema/").replace(".yaml", ".json")),
  "clients/schema.json",
  ...entryFiles("clients"),
  ...entryFiles("tools/overrides/server"),
  ...entryFiles("tools/overrides/formatter"),
  ...entryFiles("tools/overrides/linter"),
  ...entryFiles("tools/overrides/debugger"),
];

export function checksumsText(files = checksummed()) {
  return files.map((name) => `${sha256(readFileSync(join(ROOT, name)))}  ${name}\n`).join("");
}
