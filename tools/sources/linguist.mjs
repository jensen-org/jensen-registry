import { parse } from "yaml";

export function linguistLookup(text) {
  const languages = parse(text);
  const byName = new Map();
  const all = [];
  for (const [name, language] of Object.entries(languages)) {
    const entry = { extensions: (language.extensions ?? []).map((ext) => ext.replace(/^\./, "")), filenames: language.filenames ?? [] };
    const names = [name, ...(language.aliases ?? [])].map((word) => word.toLowerCase().replace(/\s+/g, ""));
    all.push({ ...entry, names, name });
    byName.set(name.toLowerCase(), entry);
    for (const alias of language.aliases ?? []) if (!byName.has(alias.toLowerCase())) byName.set(alias.toLowerCase(), entry);
  }
  byName.all = all;
  return byName;
}

export function supplementFromLinguist(table, linguist, popular = new Set()) {
  const mapped = (id) => {
    const { extensions, filenames } = table.get(id);
    return extensions.size + filenames.size;
  };
  const targetOf = (language) => {
    if (table.has(language.names[0])) return language.names[0];
    const ids = [...new Set(language.names.filter((name) => table.has(name)))];
    if (!ids.length) return null;
    return ids.sort((a, b) => mapped(b) - mapped(a) || (a < b ? -1 : 1))[0];
  };
  const targets = new Map(linguist.all.map((language) => [language, targetOf(language)]));
  const winner = (claimers) => {
    const known = claimers.filter((language) => targets.get(language));
    if (known.length === 1) return known[0];
    const favoured = known.filter((language) => popular.has(language.name));
    if (favoured.length === 1) return favoured[0];
    const narrow = [...known].sort((a, b) => a.extensions.length - b.extensions.length);
    return narrow.length > 1 && narrow[0].extensions.length * 3 <= narrow[1].extensions.length ? narrow[0] : null;
  };
  const claimed = new Map();
  const claimedNames = new Map();
  for (const language of linguist.all) {
    for (const ext of language.extensions) claimed.set(ext, [...(claimed.get(ext) ?? []), language]);
    for (const name of language.filenames) claimedNames.set(name, [...(claimedNames.get(name) ?? []), language]);
  }
  const mappedExtensions = new Set();
  const mappedFilenames = new Set();
  for (const { extensions, filenames } of table.values()) {
    for (const ext of extensions) mappedExtensions.add(ext);
    for (const name of filenames) mappedFilenames.add(name);
  }
  let added = 0;
  for (const [ext, claimers] of claimed) {
    const language = winner(claimers);
    const id = language && targets.get(language);
    if (id && !mappedExtensions.has(ext)) {
      table.get(id).extensions.add(ext);
      mappedExtensions.add(ext);
      added += 1;
    }
  }
  for (const [name, claimers] of claimedNames) {
    const language = winner(claimers);
    const id = language && targets.get(language);
    if (id && !mappedFilenames.has(name)) {
      table.get(id).filenames.add(name);
      mappedFilenames.add(name);
      added += 1;
    }
  }
  return added;
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

export function relatedFiletypes(table, linguist) {
  const related = new Map();
  for (const language of linguist.all) {
    const ids = [...new Set(language.names.filter((name) => table.has(name)))];
    if (ids.length < 2 || ids.length > 4) continue;
    for (const id of ids) {
      const set = related.get(id) ?? new Set();
      for (const other of ids) if (other !== id) set.add(other);
      related.set(id, set);
    }
  }
  return related;
}

export function nameByExtension(table, ids) {
  const mapped = new Set();
  for (const { extensions } of table.values()) for (const ext of extensions) mapped.add(ext);
  let added = 0;
  for (const id of ids) {
    const entry = table.get(id);
    if (!entry || entry.extensions.size || entry.filenames.size) continue;
    if (/^[a-z0-9]{2,12}$/.test(id) && !mapped.has(id)) {
      entry.extensions.add(id);
      mapped.add(id);
      added += 1;
    }
  }
  return added;
}
