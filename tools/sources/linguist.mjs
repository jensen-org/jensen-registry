import { parse } from "yaml";

export function linguistLookup(text) {
  const languages = parse(text);
  const byName = new Map();
  for (const [name, language] of Object.entries(languages)) {
    const entry = { extensions: (language.extensions ?? []).map((ext) => ext.replace(/^\./, "")), filenames: language.filenames ?? [] };
    byName.set(name.toLowerCase(), entry);
    for (const alias of language.aliases ?? []) if (!byName.has(alias.toLowerCase())) byName.set(alias.toLowerCase(), entry);
  }
  return byName;
}

export function filetypesFor(language, { linguist, table }) {
  const byExtension = new Map();
  const byFilename = new Map();
  for (const [id, { extensions, filenames }] of table) {
    for (const ext of extensions) byExtension.set(ext, id);
    for (const name of filenames) byFilename.set(name, id);
  }
  const lower = language.toLowerCase();
  const scores = new Map();
  const entry = linguist.get(lower);
  if (entry) {
    for (const ext of entry.extensions) if (byExtension.has(ext)) scores.set(byExtension.get(ext), (scores.get(byExtension.get(ext)) ?? 0) + 1);
    for (const name of entry.filenames) if (byFilename.has(name)) scores.set(byFilename.get(name), (scores.get(byFilename.get(name)) ?? 0) + 1);
  }
  const same = lower.replace(/\s+/g, "");
  if (table.has(same)) scores.set(same, Number.MAX_SAFE_INTEGER);
  else if (!entry && byExtension.has(same)) scores.set(byExtension.get(same), 1);
  if (!scores.size) return new Set();
  const best = Math.max(...scores.values());
  const winners = [...scores].filter(([, score]) => score === best).map(([id]) => id);
  const found = new Set(winners);
  for (const id of scores.keys()) if (winners.some((winner) => id.startsWith(winner) && id !== winner)) found.add(id);
  return found;
}
