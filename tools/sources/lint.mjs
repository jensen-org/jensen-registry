import { Untranslatable, translateParser } from "../patterns.mjs";
import { bySource, compact, packageForBin, readEntries, tally } from "./common.mjs";

export function readLinters(files, packages) {
  const unextractable = tally();
  const untranslatable = [];
  const bins = bySource(packages);
  const { entries, unreadable } = readEntries(files, "lua/lint/linters", {
    onFile(id, value, misses) {
      for (const path of new Set(misses.map((miss) => miss.split(".")[0]))) unextractable.add(path);
      let parser;
      if (value.parser && typeof value.parser === "object") {
        try {
          parser = translateParser(value.parser);
        } catch (error) {
          if (!(error instanceof Untranslatable)) throw error;
          untranslatable.push(`${id}: ${error.message}`);
        }
      }
      const pkg = typeof value.cmd === "string" ? packageForBin(bins, value.cmd, "Linter") : undefined;
      return compact({
        id,
        package: pkg?.id,
        cmd: typeof value.cmd === "string" ? value.cmd : undefined,
        args: Array.isArray(value.args) ? value.args : undefined,
        stdin: typeof value.stdin === "boolean" ? value.stdin : undefined,
        append_file: typeof value.append_fname === "boolean" ? value.append_fname : undefined,
        stream: typeof value.stream === "string" ? value.stream : undefined,
        ignore_exitcode: typeof value.ignore_exitcode === "boolean" ? value.ignore_exitcode : undefined,
        env: value.env && Object.keys(value.env).length ? value.env : undefined,
        parser,
      });
    },
  });
  const linters = entries;
  return { linters, summary: { linters: linters.length, with_parser: linters.filter((entry) => entry.parser).length, unextractable, untranslatable, unreadable } };
}
