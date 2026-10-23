import { readModule } from "../lua.mjs";
import { byText, compact } from "./common.mjs";

const read = (files, path) => {
  const file = files.get(path);
  return file ? readModule(file.toString("utf8")) : { value: {}, misses: [] };
};

export function readDebuggers(files, packages) {
  const base = "lua/mason-nvim-dap/mappings";
  const toPackage = read(files, `${base}/source.lua`).scope.get("M")?.nvim_dap_to_package ?? {};
  const filetypes = read(files, `${base}/filetypes.lua`).value ?? {};
  const configurations = read(files, `${base}/configurations.lua`).value ?? {};
  const known = new Set(packages.map((pkg) => pkg.id));
  const unextractable = [];
  const debuggers = Object.keys(toPackage)
    .sort(byText)
    .map((id) => {
      const { value, misses } = read(files, `${base}/adapters/${id}.lua`);
      for (const miss of misses) unextractable.push(`${id}.${miss}`);
      const adapter = value && typeof value === "object" ? { ...value } : undefined;
      if (adapter?.command?.bin) {
        adapter.bin = adapter.command.bin;
        delete adapter.command;
      }
      return compact({
        id,
        package: known.has(toPackage[id]) ? toPackage[id] : undefined,
        filetypes: Array.isArray(filetypes[id]) ? filetypes[id] : undefined,
        adapter: adapter && Object.keys(adapter).length ? adapter : undefined,
        configurations: Array.isArray(configurations[id]) ? configurations[id] : undefined,
      });
    });
  return { debuggers, summary: { debuggers: debuggers.length, unextractable } };
}
