import { resolveDeep } from "./mason-template.mjs";

const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0)));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function parsePurl(text) {
  const match = /^pkg:([^/]+)\/(.+?)(?:@([^?#]+))?(?:\?([^#]*))?(?:#(.*))?$/s.exec(text);
  if (!match) throw new Error(`unreadable purl ${text}`);
  const [, type, path, version, query, subpath] = match;
  const qualifiers = Object.fromEntries((query ?? "").split("&").filter(Boolean).map((pair) => {
    const [key, ...rest] = pair.split("=");
    return [key, decodeURIComponent(rest.join("="))];
  }));
  let coordinate = decodeURIComponent(path);
  if (type === "golang" && subpath) coordinate = `${coordinate}/${subpath}`;
  if (type === "pypi" && qualifiers.extra) coordinate = `${coordinate}[${qualifiers.extra}]`;
  return { type, coordinate, version: version === undefined ? "" : decodeURIComponent(version), qualifiers };
}

const numbers = (version) => version.replace(/^[^\d]*/, "").split(/[.\-+]/).map((part) => parseInt(part, 10) || 0);

function atMost(version, limit) {
  const a = numbers(version);
  const b = numbers(limit);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return true;
}

function withVersionOverride(source, version) {
  for (const override of source.version_overrides ?? []) {
    const bound = /^semver:<=(.+)$/.exec(override.constraint ?? "");
    if (bound && atMost(version, bound[1])) {
      const { constraint, id, ...rest } = override;
      return { ...source, ...rest };
    }
  }
  return source;
}

const parseBin = (value) => {
  const match = /^([a-z][a-z0-9-]*):(.*)$/s.exec(value);
  return match ? { client: match[1], target: match[2] } : { client: "path", target: value };
};

function artifactsOf(source) {
  return [
    ...list(source.asset).map((entry) => ({ kind: "asset", entry })),
    ...list(source.download).map((entry) => ({ kind: "download", entry })),
    ...list(source.build).map((entry) => ({ kind: "build", entry })),
  ];
}

function normalizeArtifact({ kind, entry }, { purl, binTemplates, miss, label }) {
  const targets = list(entry.target);
  const base = { version: purl.version, __targets: targets };
  const record = (message) => miss(`${label}: ${message}`);
  const resolved = resolveDeep(entry, { ...base, source: { [kind]: entry } }, record);
  const context = { ...base, source: { [kind]: resolved, ...(purl.sourceBin ? { bin: purl.sourceBin } : {}) } };
  const { target, file, files, run, env, bin, staged, ...rest } = resolved;
  const fileSpecs = kind === "asset" ? list(file) : kind === "download" ? Object.entries(files ?? {}) : [];
  const artifact = { targets };
  if (kind === "asset") {
    artifact.files = fileSpecs.map((spec) => {
      const [name, dest] = spec.split(/:(.*)/s);
      const url = purl.type === "github" ? `https://github.com/${purl.coordinate}/releases/download/${purl.version}/${name}` : undefined;
      if (!url) record(`asset ${name} has no known host`);
      return compact({ name, url, dest: dest || undefined });
    });
  } else if (kind === "download") {
    artifact.files = fileSpecs.map(([name, url]) => ({ name, url }));
    if (typeof file === "string") artifact.file = file;
  } else {
    artifact.run = run;
    if (env) artifact.env = env;
    if (staged !== undefined) artifact.staged = staged;
  }
  const binMap = {};
  for (const [name, template] of Object.entries(binTemplates)) {
    const value = resolveDeep(template, context, record);
    if (typeof value === "string" && value !== "") binMap[name] = value;
  }
  if (Object.keys(binMap).length) artifact.bin = binMap;
  if (Object.keys(rest).length) artifact.extra = rest;
  return artifact;
}

export function normalizePackage(pkg, { miss }) {
  const purl = parsePurl(pkg.source.id);
  const source = withVersionOverride(pkg.source, purl.version);
  purl.sourceBin = source.bin;
  const label = pkg.name;
  const bin = {};
  const perArtifact = {};
  for (const [name, value] of Object.entries(pkg.bin ?? {})) {
    const parsed = parseBin(value);
    if (parsed.target.includes("{{")) {
      perArtifact[name] = parsed.target;
      bin[name] = { client: parsed.client };
    } else bin[name] = parsed;
  }
  const entries = artifactsOf(source);
  const artifacts = entries.map((entry) => normalizeArtifact(entry, { purl, binTemplates: perArtifact, miss, label }));
  if (!entries.length) {
    for (const [name, template] of Object.entries(perArtifact)) {
      const value = resolveDeep(template, { version: purl.version, source: { bin: source.bin ?? {} } }, (message) => miss(`${label}: ${message}`));
      if (typeof value === "string") bin[name] = { ...bin[name], target: value };
    }
  }
  const platformFree = (value) => resolveDeep(value, { version: purl.version, __targets: ["unix"] }, (message) => miss(`${label}: ${message}`));
  const binResolved = Object.fromEntries(Object.entries(bin).map(([name, value]) => [name, value.target === undefined ? value : { client: value.client, target: platformFree(value.target) }]));
  return compact({
    id: pkg.name,
    source: purl.type,
    coordinate: purl.coordinate,
    version: purl.version,
    qualifiers: Object.keys(purl.qualifiers).length ? purl.qualifiers : undefined,
    description: pkg.description?.trim() || undefined,
    homepage: pkg.homepage,
    languages: pkg.languages,
    categories: pkg.categories,
    lspconfig: pkg.neovim?.lspconfig,
    extra_packages: source.extra_packages,
    supported_platforms: source.supported_platforms,
    runs_script: artifacts.some((artifact) => artifact.run !== undefined) ? true : undefined,
    bin: Object.keys(binResolved).length ? binResolved : undefined,
    share: pkg.share ? platformFree(pkg.share) : undefined,
    opt: pkg.opt ? platformFree(pkg.opt) : undefined,
    artifacts,
  });
}

export async function buildPackages(registry, { digests, known = new Map(), concurrency = 4 }) {
  const misses = [];
  const miss = (message) => misses.push(message);
  const live = registry.filter((pkg) => !pkg.deprecation).sort((a, b) => byText(a.name, b.name));
  const packages = live.map((pkg) => normalizePackage(pkg, { miss }));
  let unhashed = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < packages.length) {
      const pkg = packages[cursor++];
      if (pkg.source !== "github") continue;
      for (const artifact of pkg.artifacts) {
        for (const file of artifact.files ?? []) {
          if (!file.url) continue;
          if (known.has(file.url)) {
            const recorded = known.get(file.url);
            if (recorded) file.sha256 = recorded;
            else unhashed += 1;
            continue;
          }
          const found = (await digests(pkg.coordinate, pkg.version)).get(file.name);
          if (found) file.sha256 = found;
          else unhashed += 1;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return {
    packages,
    summary: {
      packages: packages.length,
      deprecated: registry.length - live.length,
      build: packages.filter((pkg) => pkg.runs_script).length,
      unhashed,
      template_misses: misses,
    },
  };
}
