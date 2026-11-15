import { loadEntries } from "../lib.mjs";

export function validateRuntimes({ check, index, problems, same }) {
  const fail = (message) => problems.push(message);
  const entries = loadEntries("runtimes");
  for (const { path, entry } of entries) {
    problems.push(...check("runtimes", "runtimeEntry")(entry, path));
    if (path !== `runtimes/${entry.id}.yaml`) fail(`${path}: the file name must be the id`);
  }
  for (const item of index.runtimes ?? []) {
    problems.push(...check("runtimes", "indexRuntime")(item, `index.yaml runtimes/${item.id}`));
    const source = entries.find(({ entry }) => entry.id === item.id)?.entry;
    if (!source) {
      fail(`index.yaml: runtime ${item.id} has no entry file`);
      continue;
    }
    same(`index.yaml runtime ${item.id} gateway`, item.gateway, source.gateway);
  }
  for (const { entry } of entries) {
    if (!(index.runtimes ?? []).some((item) => item.id === entry.id)) fail(`index.yaml: missing runtime ${entry.id}, run npm run track`);
  }
}
