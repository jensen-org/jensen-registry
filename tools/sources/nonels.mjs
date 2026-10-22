import { readModule } from "../lua.mjs";
import { byText } from "./common.mjs";

function collect(files, directory) {
  const prefix = `${directory}/`;
  const found = new Map();
  for (const [path, bytes] of files) {
    if (!path.startsWith(prefix) || !path.endsWith(".lua") || path.slice(prefix.length).includes("/")) continue;
    let value;
    try {
      value = readModule(bytes.toString("utf8")).value;
    } catch {
      continue;
    }
    const types = Array.isArray(value?.filetypes) ? value.filetypes.filter((type) => typeof type === "string") : [];
    const names = [value?.generator_opts?.command, value?.name].filter((name) => typeof name === "string");
    if (!types.length) continue;
    for (const name of names) {
      const set = found.get(name) ?? new Set();
      for (const type of types) set.add(type);
      found.set(name, set);
    }
  }
  return new Map([...found].sort(([a], [b]) => byText(a, b)));
}

export const readNoneLs = (files) => ({
  formatting: collect(files, "lua/null-ls/builtins/formatting"),
  diagnostics: collect(files, "lua/null-ls/builtins/diagnostics"),
});
