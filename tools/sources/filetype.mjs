import { readModule } from "../lua.mjs";
import { byText } from "./common.mjs";

const filetypeOf = (value) => (typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined);

export function readFiletypes(source) {
  const { scope, localMisses } = readModule(source);
  const extension = scope.get("extension") ?? {};
  const filename = scope.get("filename") ?? {};
  const table = new Map();
  const entry = (id) => {
    if (!table.has(id)) table.set(id, { extensions: new Set(), filenames: new Set() });
    return table.get(id);
  };
  for (const [ext, value] of Object.entries(extension)) {
    const id = filetypeOf(value);
    if (id) entry(id).extensions.add(ext);
  }
  for (const [name, value] of Object.entries(filename)) {
    const id = filetypeOf(value);
    if (id) entry(id).filenames.add(name);
  }
  const unextractable = {
    extension: localMisses.filter((path) => path.startsWith("extension.")).length,
    filename: localMisses.filter((path) => path.startsWith("filename.")).length,
  };
  return { table, summary: { filetypes: table.size, unextractable } };
}

export const filetypeEntries = (table, extra = [], related = new Map()) => {
  for (const id of extra) if (!table.has(id)) table.set(id, { extensions: new Set(), filenames: new Set() });
  return [...table.keys()].sort(byText).map((id) => {
    const { extensions, filenames } = table.get(id);
    const out = { id };
    if (extensions.size) out.extensions = [...extensions].sort(byText);
    if (filenames.size) out.filenames = [...filenames].sort(byText);
    if (related.get(id)?.size) out.related = [...related.get(id)].sort(byText);
    return out;
  });
};
