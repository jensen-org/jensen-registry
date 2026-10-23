import { bySource, compact, packageForBin, readEntries, tally } from "./common.mjs";

const PLACEHOLDERS = { $FILENAME: "{file}", $DIRNAME: "{dir}", $RELATIVE_FILEPATH: "{relative_file}", $FILEEXT: "{ext}" };

const rewrite = (args, unknown) =>
  args.map((arg) =>
    typeof arg === "string"
      ? arg.replace(/\$[A-Z_]+/g, (token) => {
          if (token in PLACEHOLDERS) return PLACEHOLDERS[token];
          unknown.add(token);
          return token;
        })
      : arg,
  );

export function readFormatters(files, packages) {
  const unextractable = tally();
  const unknownPlaceholders = new Set();
  const bins = bySource(packages);
  const { entries, unreadable } = readEntries(files, "lua/conform/formatters", {
    onFile(id, value, misses) {
      for (const path of new Set(misses.map((miss) => miss.split(".")[0]))) unextractable.add(path);
      const pkg = typeof value.command === "string" ? packageForBin(bins, value.command, "Formatter") : undefined;
      return compact({
        id,
        package: pkg?.id,
        command: typeof value.command === "string" ? value.command : undefined,
        args: Array.isArray(value.args) ? rewrite(value.args, unknownPlaceholders) : undefined,
        range_args: Array.isArray(value.range_args) ? rewrite(value.range_args, unknownPlaceholders) : undefined,
        stdin: typeof value.stdin === "boolean" ? value.stdin : undefined,
        cwd_markers: value.cwd?.root_markers,
        require_cwd: typeof value.require_cwd === "boolean" ? value.require_cwd : undefined,
        exit_codes: Array.isArray(value.exit_codes) ? value.exit_codes : undefined,
        env: value.env && Object.keys(value.env).length ? value.env : undefined,
      });
    },
  });
  const formatters = entries;
  return { formatters, summary: { formatters: formatters.length, unextractable, unknown_placeholders: [...unknownPlaceholders].sort(), unreadable } };
}
