import { loadEntries } from "../lib.mjs";

export function trackRuntimes({ check, problems }) {
  const runtimes = [];
  for (const { path, entry } of loadEntries("runtimes")) {
    const found = check("runtimes", "runtimeEntry")(entry, path);
    problems.push(...found);
    if (!found.length) runtimes.push(entry);
  }
  return runtimes;
}
