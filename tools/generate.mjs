import { existsSync } from "node:fs";
import { parse } from "yaml";
import { join } from "node:path";
import { ROOT, dump, entryFiles, readYaml } from "../lib.mjs";
import { readFormatters } from "./sources/conform.mjs";
import { byText } from "./sources/common.mjs";
import { readDebuggers } from "./sources/dap.mjs";
import { masonRegistry, rawText, releaseDigests, repoFiles } from "./sources/fetch.mjs";
import { filetypeEntries, readFiletypes } from "./sources/filetype.mjs";
import { readLinters } from "./sources/lint.mjs";
import { readNoneLs } from "./sources/nonels.mjs";
import { filetypesFor, linguistLookup, nameByExtension, relatedFiletypes, supplementFromLinguist } from "./sources/linguist.mjs";
import { readServers } from "./sources/lspconfig.mjs";
import { buildPackages } from "./sources/mason.mjs";

export const SCHEMA_VERSION = 2;
export const KINDS = { server: "servers", formatter: "formatters", linter: "linters", debugger: "debuggers" };
export const OUTPUTS = ["packages", "servers", "formatters", "linters", "debuggers", "filetypes", "unresolved"].map((name) => `tools/${name}.yaml`);

export function deepMerge(base, override) {
  if (Array.isArray(override) || !override || typeof override !== "object") return override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = base && typeof base[key] === "object" && !Array.isArray(base[key]) ? deepMerge(base[key], value) : value;
  return out;
}

export function loadOverrides() {
  const overrides = {};
  for (const kind of Object.keys(KINDS)) {
    overrides[kind] = new Map(entryFiles(`tools/overrides/${kind}`).map((path) => [path.split("/").at(-1).slice(0, -".yaml".length), { path, value: readYaml(path) }]));
  }
  return overrides;
}

const previousDigests = () => {
  const known = new Map();
  if (!existsSync(join(ROOT, "tools/packages.yaml"))) return known;
  for (const pkg of readYaml("tools/packages.yaml").packages ?? []) {
    for (const artifact of pkg.artifacts ?? []) for (const file of artifact.files ?? []) if (file.url) known.set(file.url, file.sha256 ?? null);
  }
  return known;
};

const NOISE = ["formatter", "format", "fmt", "linter", "lint", "check", "tidy", "fixer", "ls"];

function named(entry, lookup) {
  const words = [entry.id, entry.command, entry.cmd].filter((word) => typeof word === "string");
  const found = new Set();
  for (const word of words) {
    for (const token of word.toLowerCase().split(/[-_.\s]+/)) {
      let base = token;
      for (const noise of NOISE) if (base.endsWith(noise) && base.length > noise.length) base = base.slice(0, -noise.length);
      if (base.length < 2 || NOISE.includes(base)) continue;
      for (const type of filetypesFor(base, lookup)) found.add(type);
    }
    if (found.size) break;
  }
  return found;
}

const withLanguages = (entries, packages, lookup, declared = new Map()) => {
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const missed = new Set();
  const out = entries.map((entry) => {
    const found = new Set();
    for (const language of entry.package ? (byId.get(entry.package)?.languages ?? []) : []) {
      const types = filetypesFor(language, lookup);
      if (!types.size) missed.add(language);
      for (const type of types) found.add(type);
    }
    if (!found.size) for (const word of [entry.command, entry.cmd, entry.id]) for (const type of declared.get(word) ?? []) found.add(type);
    if (!found.size) for (const type of named(entry, lookup)) found.add(type);
    if (!found.size) return entry;
    const { id, package: pkg, ...rest } = entry;
    return { id, package: pkg, filetypes: [...found].sort(byText), ...rest };
  });
  return { entries: out, missed };
};

export async function generate(upstreams) {
  const { mason, sources } = upstreams;
  const registry = await masonRegistry(mason);
  const built = await buildPackages(registry, { digests: (repo, tag) => releaseDigests(repo, tag), known: previousDigests() });
  const { packages } = built;
  const archives = Object.fromEntries(
    await Promise.all(["lspconfig", "conform", "lint", "dap", "nonels"].map(async (name) => [name, await repoFiles(sources[name].repo, sources[name].sha)])),
  );
  const filetypeSource = await rawText(sources.neovim.repo, sources.neovim.sha, "runtime/lua/vim/filetype.lua");
  const linguist = linguistLookup(await rawText(sources.linguist.repo, sources.linguist.sha, "lib/linguist/languages.yml"));
  const { table, summary: filetypeSummary } = readFiletypes(filetypeSource);
  const lookup = { linguist, table };
  const noneLs = readNoneLs(archives.nonels);
  const servers = readServers(archives.lspconfig, packages);
  const formatters = readFormatters(archives.conform, packages);
  const linters = readLinters(archives.lint, packages);
  const debuggers = readDebuggers(archives.dap, packages);
  for (const id of [...servers.servers, ...debuggers.debuggers].flatMap((entry) => entry.filetypes ?? [])) {
    if (!table.has(id)) table.set(id, { extensions: new Set(), filenames: new Set() });
  }
  const popular = new Set(parse(await rawText(sources.linguist.repo, sources.linguist.sha, "lib/linguist/popular.yml")));
  filetypeSummary.supplemented_from_linguist = supplementFromLinguist(table, linguist, popular);
  for (const pkg of packages) {
    const found = new Set();
    for (const language of pkg.languages ?? []) for (const type of filetypesFor(language, lookup)) found.add(type);
    if (found.size) pkg.filetypes = [...found].sort(byText);
  }
  const generated = {
    server: servers.servers,
    formatter: withLanguages(formatters.formatters, packages, lookup, noneLs.formatting).entries,
    linter: withLanguages(linters.linters, packages, lookup, noneLs.diagnostics).entries,
    debugger: debuggers.debuggers,
  };
  const missed = new Set([...withLanguages(formatters.formatters, packages, lookup, noneLs.formatting).missed, ...withLanguages(linters.linters, packages, lookup, noneLs.diagnostics).missed]);

  const overrides = loadOverrides();
  const merged = Object.fromEntries(
    Object.entries(generated).map(([kind, entries]) => [kind, entries.map((entry) => (overrides[kind].has(entry.id) ? deepMerge(entry, overrides[kind].get(entry.id).value) : entry))]),
  );
  const named = new Set([...merged.server, ...merged.debugger].flatMap((entry) => entry.filetypes ?? []));
  for (const entry of [...merged.formatter, ...merged.linter]) for (const type of entry.filetypes ?? []) named.add(type);
  filetypeSummary.named_by_extension = nameByExtension(table, named);
  const related = relatedFiletypes(table, linguist);
  const reachable = (id) => {
    const hit = (type) => table.get(type)?.extensions.size || table.get(type)?.filenames.size;
    return Boolean(hit(id) || [...(related.get(id) ?? [])].some(hit));
  };

  const bins = new Map(packages.map((pkg) => [pkg.id, Object.keys(pkg.bin ?? {})]));
  const programOf = { server: (entry) => entry.cmd?.[0], formatter: (entry) => entry.command, linter: (entry) => entry.cmd };
  const mismatched = new Set();
  for (const [kind, read] of Object.entries(programOf)) {
    merged[kind] = merged[kind].map((entry) => {
      const program = read(entry);
      const installed = entry.package && bins.get(entry.package);
      if (!program || !installed?.length || installed.includes(program)) return entry;
      const spelling = installed.find((bin) => bin.toLowerCase() === program.toLowerCase());
      if (!spelling) {
        mismatched.add(`${kind}:${entry.id}`);
        return entry;
      }
      if (kind === "server") return { ...entry, cmd: [spelling, ...entry.cmd.slice(1)] };
      return kind === "formatter" ? { ...entry, command: spelling } : { ...entry, cmd: spelling };
    });
  }
  const required = { server: ["cmd", "filetypes"], formatter: ["command", "filetypes"], linter: ["cmd", "parser", "filetypes"], debugger: ["adapter", "filetypes"] };
  const unresolved = [];
  for (const [kind, fields] of Object.entries(required)) {
    merged[kind] = merged[kind].map((entry) => {
      const missing = fields.filter((name) => entry[name] === undefined);
      if (entry.filetypes?.length && !entry.filetypes.some(reachable)) missing.push("reachable_filetype");
      if (mismatched.has(`${kind}:${entry.id}`)) missing.push("package_binary");
      if (!missing.length) return entry;
      unresolved.push({ kind, id: entry.id, missing });
      return { ...entry, runnable: false };
    });
  }
  unresolved.sort((a, b) => byText(a.kind, b.kind) || byText(a.id, b.id));

  const header = (pin) => ({ schema_version: SCHEMA_VERSION, upstream: pin });
  const files = new Map([
    ["tools/packages.yaml", dump({ ...header({ repo: mason.repo, tag: mason.tag, sha256: mason.sha256 }), packages })],
    ["tools/servers.yaml", dump({ ...header(sources.lspconfig), servers: merged.server })],
    ["tools/formatters.yaml", dump({ ...header(sources.conform), formatters: merged.formatter })],
    ["tools/linters.yaml", dump({ ...header(sources.lint), linters: merged.linter })],
    ["tools/debuggers.yaml", dump({ ...header(sources.dap), debuggers: merged.debugger })],
    ["tools/filetypes.yaml", dump({ ...header(sources.neovim), filetypes: filetypeEntries(table, [...named], related) })],
    ["tools/unresolved.yaml", dump({ schema_version: SCHEMA_VERSION, unresolved })],
  ]);
  const summary = {
    packages: built.summary,
    servers: servers.summary,
    formatters: formatters.summary,
    linters: linters.summary,
    debuggers: debuggers.summary,
    filetypes: filetypeSummary,
    unresolved: Object.fromEntries(Object.keys(required).map((kind) => [kind, unresolved.filter((entry) => entry.kind === kind).length])),
    language_misses: [...missed].sort(byText),
  };
  return { files, generated, merged, overrides, summary };
}
