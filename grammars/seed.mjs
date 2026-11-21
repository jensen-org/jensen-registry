import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, dump, readYaml, writeText } from "../lib.mjs";
import { SOURCES_FILE, UNDETECTABLE, loadCandidates, resolveCrates, undetectableParsers, withDiscovered } from "./discover.mjs";
import { WASM_DIR, attemptBuild, wasmFile } from "./track.mjs";

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function seedFrom({ sources, added, attempt, log, ledger = [] }) {
  const built = [];
  const skipped = [];
  const failed = [];
  for (const grammar of added) {
    const result = await attempt(grammar, sources.tree_sitter_cli);
    if (result.ok) built.push(grammar);
    else {
      skipped.push(`${grammar.id}: ${result.reason}`);
      failed.push({ id: grammar.id, reason: result.reason });
    }
  }
  const joined = withDiscovered(sources, built);
  const skip = [...(sources.skip ?? []), ...ledger, ...failed].sort(byId);
  const next = skip.length ? { ...joined, skip } : joined;
  log(`seeded ${built.length} grammars, skipped ${skipped.length} that cannot build, ledger holds ${skip.length}`);
  for (const line of skipped) log(`  skipped ${line}`);
  return { next, built, skipped };
}

export async function seedGrammars({ only, log = console.log, attempt = attemptBuild } = {}) {
  const sources = readYaml(SOURCES_FILE);
  const { wanted, undetectable } = await loadCandidates(sources, only);
  const known = new Set(sources.grammars.map((grammar) => grammar.id));
  const { added, skipped: unresolved } = await resolveCrates(wanted, { known, log });
  const result = await seedFrom({ sources, added, attempt, log, ledger: [...unresolved, ...undetectable] });
  writeText(SOURCES_FILE, dump(result.next));
  return result;
}

export const FAILURES_DIR = "grammars/.failed";

export function shardOf(grammars, shard, total) {
  return [...grammars].sort(byId).filter((_, index) => index % total === shard);
}

export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match || Number(match[2]) < 1 || Number(match[1]) >= Number(match[2])) throw new Error(`a shard is written index/total with index below total, got ${value}`);
  return { shard: Number(match[1]), total: Number(match[2]) };
}

export async function resolveGrammars({ log = console.log } = {}) {
  const sources = readYaml(SOURCES_FILE);
  const { wanted, undetectable } = await loadCandidates(sources);
  const known = new Set(sources.grammars.map((grammar) => grammar.id));
  const { added, skipped } = await resolveCrates(wanted, { known, log });
  const skip = [...(sources.skip ?? []), ...skipped, ...undetectable].sort(byId);
  const joined = withDiscovered(sources, added);
  writeText(SOURCES_FILE, dump(skip.length ? { ...joined, skip } : joined));
  log(`resolved ${added.length} new grammars, ledger holds ${skip.length}`);
  return { added, skip };
}

export async function buildShard({ shard, total, attempt = attemptBuild, log = console.log }) {
  const sources = readYaml(SOURCES_FILE);
  const failures = [];
  for (const grammar of shardOf(sources.grammars, shard, total)) {
    if (existsSync(join(ROOT, WASM_DIR, wasmFile(grammar)))) continue;
    const result = await attempt(grammar, sources.tree_sitter_cli);
    if (!result.ok) failures.push({ id: grammar.id, reason: result.reason });
  }
  mkdirSync(join(ROOT, FAILURES_DIR), { recursive: true });
  writeFileSync(join(ROOT, FAILURES_DIR, `${shard}.json`), `${JSON.stringify(failures)}\n`);
  log(`shard ${shard}/${total}: ${failures.length} grammars could not build`);
  return failures;
}

export function applyFailures(sources, failures) {
  const failed = new Map(failures.map((entry) => [entry.id, entry.reason]));
  const grammars = sources.grammars.filter((grammar) => !failed.has(grammar.id));
  const skip = [...(sources.skip ?? []).filter((entry) => !failed.has(entry.id)), ...failures].sort(byId);
  return { ...sources, grammars, skip };
}

export function mergeShards({ log = console.log } = {}) {
  const folder = join(ROOT, FAILURES_DIR);
  const failures = existsSync(folder)
    ? readdirSync(folder).filter((file) => file.endsWith(".json")).flatMap((file) => JSON.parse(readFileSync(join(folder, file), "utf8")))
    : [];
  const sources = readYaml(SOURCES_FILE);
  for (const { id } of failures) {
    const grammar = sources.grammars.find((candidate) => candidate.id === id);
    if (grammar) rmSync(join(ROOT, WASM_DIR, wasmFile(grammar)), { force: true });
  }
  writeText(SOURCES_FILE, dump(applyFailures(sources, failures)));
  rmSync(folder, { recursive: true, force: true });
  log(`merged ${failures.length} build failures into the ledger`);
  return failures;
}
