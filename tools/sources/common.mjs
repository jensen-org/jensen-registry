import { dropShiftedArrays, readModule } from "../lua.mjs";

export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const compact = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)));

export const asList = (value) => (Array.isArray(value) ? value : value && typeof value === "object" && Object.keys(value).length === 0 ? [] : undefined);

export function tally() {
  const counts = new Map();
  return {
    add(field) {
      counts.set(field, (counts.get(field) ?? 0) + 1);
    },
    toJSON: () => Object.fromEntries([...counts].sort(([a], [b]) => byText(a, b))),
  };
}

export function readEntries(files, directory, { onFile }) {
  const prefix = `${directory}/`;
  const names = [...files.keys()].filter((path) => path.startsWith(prefix) && path.endsWith(".lua") && !path.slice(prefix.length).includes("/")).sort(byText);
  const unreadable = [];
  const entries = [];
  for (const path of names) {
    const id = path.slice(prefix.length, -".lua".length);
    try {
      const { value, misses } = readModule(files.get(path).toString("utf8"));
      if (value && typeof value === "object") entries.push(onFile(id, dropShiftedArrays(value, misses), misses));
    } catch (error) {
      unreadable.push(`${path}: ${error.message}`);
    }
  }
  return { entries, unreadable };
}

export function bySource(packages) {
  const map = new Map();
  for (const pkg of packages) {
    for (const name of Object.keys(pkg.bin ?? {})) {
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(pkg);
    }
  }
  return map;
}

export function packageForBin(map, bin, category) {
  const candidates = map.get(bin) ?? [];
  return candidates.find((pkg) => pkg.categories?.includes(category)) ?? candidates[0];
}
