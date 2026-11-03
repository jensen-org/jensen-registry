import { dump, readYaml, writeText } from "../lib.mjs";
import { SOURCES_FILE, loadCandidates, resolveCrates, withDiscovered } from "./discover.mjs";
import { attemptBuild } from "./track.mjs";

export async function seedFrom({ sources, added, attempt, log }) {
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
  const skip = [...(sources.skip ?? []), ...failed].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const next = skip.length ? { ...joined, skip } : joined;
  log(`seeded ${built.length} grammars, skipped ${skipped.length} that cannot build`);
  for (const line of skipped) log(`  skipped ${line}`);
  return { next, built, skipped };
}

export async function seedGrammars({ only, log = console.log, attempt = attemptBuild } = {}) {
  const sources = readYaml(SOURCES_FILE);
  const wanted = await loadCandidates(sources, only);
  const known = new Set(sources.grammars.map((grammar) => grammar.id));
  const { added, skipped: unresolved } = await resolveCrates(wanted, { known, limit: Number.POSITIVE_INFINITY, log });
  for (const line of unresolved) log(`  skipped ${line}`);
  const result = await seedFrom({ sources, added, attempt, log });
  writeText(SOURCES_FILE, dump(result.next));
  return result;
}
