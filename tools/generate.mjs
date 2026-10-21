const KINDS = {
  LSP: { kind: "languageserver", suffix: "lsp", args: ["--stdio"] },
  Linter: { kind: "linter", suffix: "lint", args: ["{path}"] },
  Formatter: { kind: "formatter", suffix: "format", args: null },
  DAP: { kind: "debugadapter", suffix: "dap", args: null },
};

const SOURCE_PREFIXES = new Set(["npm", "pypi", "cargo", "golang", "gem", "github", "composer", "luarocks", "nuget", "opam", "openvsx", "generic"]);

export const GENERATED_PRIORITY = -10;

const clone = (value) => JSON.parse(JSON.stringify(value));

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function deepMerge(base, patch) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = isObject(value) && isObject(base[key]) ? deepMerge(base[key], value) : clone(value);
  }
  return merged;
}

const sourceType = (package_) => package_.source.id.match(/^pkg:([^/]+)\//)?.[1] ?? "";

const slug = (label) =>
  label
    .toLowerCase()
    .replace(/#/g, "sharp")
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]/g, "");

const SERVER_BIN = /(lsp|language-?server|langserver|-ls$)/i;

function pickBin(package_, binKeys, kind) {
  const pool = kind === "languageserver" && binKeys.some((key) => SERVER_BIN.test(key)) ? binKeys.filter((key) => SERVER_BIN.test(key)) : binKeys;
  if (pool.includes(package_.name)) return package_.name;
  return [...pool].sort()[0];
}

export function generate({ packages, languages: declared, definitions, installers }) {
  const skipped = {};
  const skip = (reason, name) => (skipped[reason] ??= []).push(name);
  const languages = clone(declared);
  const labels = new Map();
  for (const language of languages) {
    for (const label of language.catalog_labels ?? []) {
      const key = label.toLowerCase();
      labels.set(key, [...(labels.get(key) ?? []), language.id]);
    }
  }
  const launchers = new Set(Object.keys(installers.launchers ?? {}));
  const installable = new Set(["npm", "pypi", "cargo", "golang", "gem", "github", ...Object.keys(installers.sources ?? {})]);

  const idsFor = (label) => {
    const key = label.toLowerCase();
    if (!labels.has(key)) {
      const id = slug(label);
      if (!id || languages.some((language) => language.id === id)) return [];
      languages.push({ id, catalog_labels: [label] });
      labels.set(key, [id]);
    }
    return labels.get(key);
  };

  const generated = [];
  const relevant = packages
    .filter((package_) => (package_.categories ?? []).some((category) => KINDS[category]))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const package_ of relevant) {
    if (package_.deprecation) {
      skip("deprecated", package_.name);
      continue;
    }
    const categories = package_.categories.filter((category) => KINDS[category]);
    const binKeys = Object.keys(package_.bin ?? {});
    for (const category of categories) {
      const { kind, suffix, args } = KINDS[category];
      const label = `${package_.name} (${kind})`;
      const id = categories.length === 1 ? package_.name : `${package_.name}-${suffix}`;
      if (!installable.has(sourceType(package_))) {
        skip("source", label);
        continue;
      }
      const prefixes = binKeys
        .map((key) => package_.bin[key].match(/^([a-z][a-z0-9-]*):/)?.[1])
        .filter((prefix) => prefix && !SOURCE_PREFIXES.has(prefix));
      if (binKeys.length === 0 || prefixes.some((prefix) => prefix !== "exec" && !launchers.has(prefix))) {
        skip("bin", label);
        continue;
      }
      if (!args) {
        skip("no-run-line", label);
        continue;
      }
      const resolved = [...new Set((package_.languages ?? []).flatMap(idsFor))];
      if (resolved.length === 0) {
        skip("language", label);
        continue;
      }
      generated.push({
        id,
        kind,
        bin: pickBin(package_, binKeys, kind),
        args: [...args],
        languages: resolved,
        priority: GENERATED_PRIORITY,
        package: package_.name,
      });
    }
  }

  let pool = generated;
  const claimed = new Set();
  const curated = [];
  for (const definition of definitions) {
    claimed.add(definition.id);
    if (definition.exclude) continue;
    const match = definition.package ? pool.find((tool) => tool.package === definition.package && tool.kind === definition.kind) : undefined;
    if (match) {
      pool = pool.filter((tool) => tool !== match);
      curated.push({ ...deepMerge(match, definition), id: definition.id });
    } else {
      curated.push(clone(definition));
    }
  }
  pool = pool.filter((tool) => !claimed.has(tool.id)).sort((a, b) => a.id.localeCompare(b.id));
  const tools = [...curated, ...pool];

  const fixed = declared.length;
  const extra = languages.slice(fixed).sort((a, b) => a.id.localeCompare(b.id));
  return { languages: [...languages.slice(0, fixed), ...extra], tools, skipped };
}

export function problemsIn({ languages, tools }) {
  const problems = [];
  const ids = new Set();
  const languageIds = new Set(languages.map((language) => language.id));
  if (languageIds.size !== languages.length) problems.push("a language id is declared twice");
  const kinds = new Set([...Object.values(KINDS).map(({ kind }) => kind), "scanner"]);
  const claimed = new Map();
  for (const language of languages) {
    for (const key of [...(language.extensions ?? []).map((extension) => `.${extension}`), ...(language.filenames ?? [])]) {
      if (claimed.has(key)) problems.push(`${key} belongs to both ${claimed.get(key)} and ${language.id}`);
      claimed.set(key, language.id);
    }
  }
  for (const tool of tools) {
    if (ids.has(tool.id)) problems.push(`tool ${tool.id} is listed twice`);
    ids.add(tool.id);
    if (!kinds.has(tool.kind)) problems.push(`tool ${tool.id} has unknown kind ${tool.kind}`);
    if (!tool.bin) problems.push(`tool ${tool.id} has no bin`);
    for (const language of tool.languages ?? []) {
      if (!languageIds.has(language)) problems.push(`tool ${tool.id} names undeclared language ${language}`);
    }
  }
  return problems;
}
