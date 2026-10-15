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
    integrationEntry: check("integrationEntry"),
    indexIntegration: check("indexIntegration"),
  };
}

const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "upgrade",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "mcp-session-id",
]);

export function mcpProblems(entry, label) {
  const problems = [];
  const env = new Map((entry.env ?? []).map((variable) => [variable.name, variable]));
  for (const header of entry.headers ?? []) {
    const where = `${label}: header ${header.name}`;
    if (FORBIDDEN_HEADERS.has(header.name.toLowerCase())) problems.push(`${where} may not be set by an entry`);
    if (!env.get(header.secret)?.secret) problems.push(`${where} must name a secret env variable`);
    if (header.scheme === "basic") {
      if (!header.user) problems.push(`${where} uses basic and needs a user`);
      else if (!env.has(header.user)) problems.push(`${where} user must name an env variable`);
      else if (env.get(header.user).secret) problems.push(`${where} user must not be a secret`);
    } else if (header.user) {
      problems.push(`${where} only basic takes a user`);
    }
  }
  if (entry.oauth && (entry.headers ?? []).some((header) => header.name.toLowerCase() === "authorization")) {
    problems.push(`${label}: oauth and an Authorization header cannot both be set`);
  }
  return problems;
}

function satisfiable(server, entry) {
  const required = (server.env ?? []).filter((variable) => !variable.optional).map((variable) => variable.name);
  return entry.auth.some((auth) => {
    if (auth.method === "oauth") return Boolean(server.oauth);
    if (server.oauth) return false;
    if (auth.method === "api_key") {
      const names = new Set((auth.fields ?? []).map((field) => field.name));
      return required.every((name) => names.has(name));
    }
    return auth.method === "none" && required.length === 0;
  });
}

export function integrationProblems(entry, label, mcpById) {
  const problems = [];
  const methods = new Set(entry.auth.map((auth) => auth.method));
  if (methods.size !== entry.auth.length) problems.push(`${label}: an auth method is listed twice`);
  for (const auth of entry.auth) {
    if (auth.method === "api_key" && !(auth.fields ?? []).some((field) => field.secret)) {
      problems.push(`${label}: api_key needs at least one secret field`);
    }
    if (auth.method !== "api_key" && auth.fields?.length) problems.push(`${label}: only api_key takes fields`);
    if (auth.method === "cli_login" && !entry.native) problems.push(`${label}: cli_login needs a native protocol that knows the binary`);
  }
  const refs = entry.mcp ?? [];
  const ids = new Set(refs.map((ref) => ref.id));
  if (ids.size !== refs.length) problems.push(`${label}: an mcp server is listed twice`);
  for (const ref of refs) {
    const server = mcpById.get(ref.id);
    if (!server) problems.push(`${label}: mcp server ${ref.id} has no entry in mcp/`);
    else if (!satisfiable(server, entry)) problems.push(`${label}: no auth method can satisfy mcp server ${ref.id}`);
  }
  if (refs.filter((ref) => ref.default).length > 1) problems.push(`${label}: more than one default mcp server`);
  if (entry.default_on) {
    if (!entry.auth.every((auth) => auth.method === "none")) {
      problems.push(`${label}: default_on is only for an integration that needs no credentials`);
    }
    if (!refs.some((ref) => ref.default)) problems.push(`${label}: default_on needs a default mcp server`);
  }
  const actions = (entry.permissions ?? []).map((permission) => permission.action);
  if (new Set(actions).size !== actions.length) problems.push(`${label}: a permission action is listed twice`);
  return problems;
}

export function purl(ecosystem, name, version) {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:${ecosystem}/${encoded}@${version}`;
}

export function checksumsText(files) {
  return files.map((name) => `${sha256(readFileSync(join(ROOT, name)))}  ${name}\n`).join("");
}

export const CHECKSUMMED = ["tools.yaml", "index.yaml", "upstreams.yaml"];
