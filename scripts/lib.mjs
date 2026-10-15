import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse, stringify } from "yaml";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SCHEMA_VERSION = 1;
export const RAW_BASE = "https://raw.githubusercontent.com/jensen-org/jensen-registry";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const readYaml = (path) => parse(readFileSync(join(ROOT, path), "utf8"));

export const dump = (value) => stringify(value, { lineWidth: 0, sortMapEntries: false });

export const writeText = (path, text) => writeFileSync(join(ROOT, path), text);

export function entryFiles(dir) {
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

export function validator() {
  const schema = JSON.parse(readFileSync(join(ROOT, "schema/registry.schema.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addSchema(schema);
  const check = (name) => {
    const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
    return (value, label) => {
      if (validate(value)) return [];
      return validate.errors.map((e) => `${label}: ${e.instancePath || "/"} ${e.message}`);
    };
  };
  return {
    skillEntry: check("skillEntry"),
    mcpEntry: check("mcpEntry"),
    indexSkill: check("indexSkill"),
    indexMcp: check("indexMcp"),
  };
}

export function purl(ecosystem, name, version) {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:${ecosystem}/${encoded}@${version}`;
}

export function checksumsText(files) {
  return files.map((name) => `${sha256(readFileSync(join(ROOT, name)))}  ${name}\n`).join("");
}

export const CHECKSUMMED = ["tools.yaml", "index.yaml", "upstreams.yaml"];
