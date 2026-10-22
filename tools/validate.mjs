import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { validateClients } from "../clients/validate.mjs";
import { ROOT, readYaml } from "../lib.mjs";
import { KINDS, OUTPUTS, generate, loadOverrides } from "./generate.mjs";

const POLICY = new Set(["config", "priority", "root_strategy", "remedies"]);
const WITH_PARSER = new Set(["args", "stdin", "stream", "append_file", "ignore_exitcode"]);
const LEGACY = ["tools.yaml", "upstreams.yaml", "tools/tools.yaml"];
const FILES = { packages: "packages", servers: "servers", formatters: "formatters", linters: "linters", debuggers: "debuggers", filetypes: "filetypes" };
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const schemaOf = (name) => JSON.parse(readFileSync(join(ROOT, `tools/schema/${name}.json`), "utf8"));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function leaves(value, path = []) {
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.entries(value).flatMap(([key, item]) => leaves(item, [...path, key]));
  return [{ path, value }];
}

const at = (object, path) => path.reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), object);

export function checkOverrides({ generated, overrides, problems, allowed }) {
  for (const [kind, table] of Object.entries(overrides)) {
    for (const [id, { path, value }] of table) {
      const entry = generated[kind].find((candidate) => candidate.id === id);
      if (!entry) {
        problems.push(`${path}: names no generated ${kind}`);
        continue;
      }
      for (const field of Object.keys(value)) {
        if (!allowed[kind].has(field)) problems.push(`${path}: ${field} is not an allowed override field`);
        else if (!POLICY.has(field) && entry[field] !== undefined && !(kind === "linter" && value.parser && entry.parser === undefined && WITH_PARSER.has(field))) {
          problems.push(`${path}: ${field} is already provided by upstream`);
        }
      }
      for (const leaf of leaves(value)) {
        if (leaf.value !== undefined && same(at(entry, leaf.path), leaf.value)) problems.push(`${path}: ${leaf.path.join(".")} repeats the generated value`);
      }
    }
  }
}

export function validateOffline({ problems }) {
  const upstreams = readYaml("tools/upstreams.yaml");
  if (upstreams.schema_version !== 2) problems.push("tools/upstreams.yaml: schema_version must be 2");
  if (!SHA256.test(upstreams.mason?.sha256 ?? "") || !upstreams.mason?.tag) problems.push("tools/upstreams.yaml: mason needs a tag and a sha256");
  for (const [name, pin] of Object.entries(upstreams.sources ?? {})) {
    if (!FULL_SHA.test(pin.sha ?? "")) problems.push(`tools/upstreams.yaml: ${name} must be pinned to a full commit sha`);
  }
  for (const name of LEGACY) if (existsSync(join(ROOT, name))) problems.push(`${name}: legacy file must not exist`);

  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const data = {};
  for (const [name, key] of Object.entries(FILES)) {
    const file = `tools/${name}.yaml`;
    const schema = schemaOf(name);
    const validate = ajv.compile(schema);
    const value = readYaml(file);
    if (!validate(value)) {
      for (const error of validate.errors.slice(0, 20)) problems.push(`${file}: ${error.instancePath || "/"} ${error.message}`);
      continue;
    }
    data[name] = value[key];
    const seen = new Set();
    for (const entry of value[key]) {
      if (seen.has(entry.id)) problems.push(`${file}: duplicate id ${entry.id}`);
      seen.add(entry.id);
    }
  }
  if (Object.keys(FILES).some((name) => !data[name])) return;
  const packageIds = new Set(data.packages.map((pkg) => pkg.id));
  const filetypeIds = new Set(data.filetypes.map((entry) => entry.id));
  for (const name of ["servers", "formatters", "linters", "debuggers"]) {
    for (const entry of data[name] ?? []) {
      if (entry.package && !packageIds.has(entry.package)) problems.push(`tools/${name}.yaml: ${entry.id} names package ${entry.package}, which does not exist`);
      for (const type of entry.filetypes ?? []) if (!filetypeIds.has(type)) problems.push(`tools/${name}.yaml: ${entry.id} names filetype ${type}, which does not exist`);
    }
  }
  validateClients({ problems, packages: data.packages });
  const allowed = {};
  for (const [kind, plural] of Object.entries(KINDS)) allowed[kind] = new Set(Object.keys(schemaOf(plural).$defs.entry.properties));
  return { data, allowed };
}

export async function validateTools({ problems, online }) {
  const offline = validateOffline({ problems });
  if (!offline) return;
  const overrides = loadOverrides();
  for (const [kind, plural] of Object.entries(KINDS)) {
    const ids = new Set(offline.data[plural].map((entry) => entry.id));
    for (const [id, { path, value }] of overrides[kind]) {
      if (!ids.has(id) && !online) problems.push(`${path}: names no ${kind} in tools/${plural}.yaml`);
      for (const field of Object.keys(value)) if (!offline.allowed[kind].has(field)) problems.push(`${path}: ${field} is not an allowed override field`);
    }
  }
  if (!online) return;
  const { files, generated } = await generate(readYaml("tools/upstreams.yaml"));
  checkOverrides({ generated, overrides, problems, allowed: offline.allowed });
  for (const path of OUTPUTS) {
    if (readFileSync(join(ROOT, path), "utf8") !== files.get(path)) problems.push(`${path}: differs from what its pinned upstreams generate, run npm run track`);
  }
}
