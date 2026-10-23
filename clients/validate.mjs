import Ajv2020 from "ajv/dist/2020.js";
import { entryFiles, readYaml } from "../lib.mjs";
import schema from "./schema.json" with { type: "json" };

const PLACEHOLDER = /\{([^{}]+)\}/g;
const KNOWN = new Set(["dir", "name", "version", "coordinate", "namespace", "leaf", "target", "rest", "url", "file", "script", "extra_packages", "bin_root"]);

export const loadClients = () => entryFiles("clients").map((path) => ({ path, client: readYaml(path) }));

function placeholdersOf(value) {
  if (typeof value === "string") return [...value.matchAll(PLACEHOLDER)].map((match) => match[1]);
  if (Array.isArray(value)) return value.flatMap(placeholdersOf);
  if (value && typeof value === "object") return Object.values(value).flatMap(placeholdersOf);
  return [];
}

const knownPlaceholder = (name) => KNOWN.has(name) || /^qualifier\.[a-z_]+$/.test(name) || /^bin_root:[a-z-]+$/.test(name);

export function validateClients({ problems, packages = [] }) {
  const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
  const clients = loadClients();
  const byId = new Map();
  for (const { path, client } of clients) {
    if (!validate(client)) {
      for (const error of validate.errors) problems.push(`${path}: ${error.instancePath || "/"} ${error.message}`);
      continue;
    }
    if (path !== `clients/${client.id}.yaml`) problems.push(`${path}: id ${client.id} does not match the file name`);
    for (const name of placeholdersOf([client.install, client.launcher, client.env, client.bin_root])) {
      if (!knownPlaceholder(name)) problems.push(`${path}: unknown placeholder {${name}}`);
    }
    byId.set(client.id, client);
  }
  for (const client of byId.values()) {
    if (client.uses && !byId.has(client.uses)) problems.push(`clients/${client.id}.yaml: uses ${client.uses}, which has no client file`);
  }
  const managers = new Map([...byId.values()].filter((client) => client.kind === "package-manager").map((client) => [client.source, client]));
  const used = new Set();
  for (const pkg of packages) {
    if (!managers.has(pkg.source)) problems.push(`packages: ${pkg.id} has source ${pkg.source}, which has no client file`);
    if (pkg.runs_script && !byId.has("shell")) problems.push(`packages: ${pkg.id} runs a script and there is no shell client`);
    for (const [name, bin] of Object.entries(pkg.bin ?? {})) {
      used.add(bin.client);
      if (!byId.has(bin.client)) problems.push(`packages: ${pkg.id} bin ${name} names client ${bin.client}, which has no client file`);
    }
  }
  return { clients: byId, used };
}
