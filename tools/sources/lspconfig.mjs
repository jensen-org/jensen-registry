import { compact, readEntries, tally } from "./common.mjs";

export function readServers(files, packages) {
  const unextractable = tally();
  const byLspconfig = new Map(packages.filter((pkg) => pkg.lspconfig).map((pkg) => [pkg.lspconfig, pkg]));
  const { entries, unreadable } = readEntries(files, "lsp", {
    onFile(id, value, misses) {
      for (const path of new Set(misses.map((miss) => miss.split(".")[0]))) unextractable.add(path);
      const pkg = byLspconfig.get(id);
      return compact({
        id,
        package: pkg?.id,
        cmd: Array.isArray(value.cmd) ? value.cmd : undefined,
        filetypes: Array.isArray(value.filetypes) ? value.filetypes : undefined,
        root_markers: Array.isArray(value.root_markers) ? value.root_markers.flat() : undefined,
        workspace_required: typeof value.workspace_required === "boolean" ? value.workspace_required : undefined,
        settings: value.settings && Object.keys(value.settings).length ? value.settings : undefined,
        init_options: value.init_options && Object.keys(value.init_options).length ? value.init_options : undefined,
      });
    },
  });
  return { servers: entries, summary: { servers: entries.length, unextractable, unreadable } };
}
