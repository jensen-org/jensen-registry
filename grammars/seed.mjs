import { dump, readYaml, writeText } from "../lib.mjs";
import { SOURCES_FILE, UNDETECTABLE, loadCandidates, resolveCrates, undetectableParsers, withDiscovered } from "./discover.mjs";
import { attemptBuild } from "./track.mjs";

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
