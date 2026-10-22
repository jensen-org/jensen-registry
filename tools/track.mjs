import { dump, getBytes, github, readYaml, writeText } from "../lib.mjs";
import { generate } from "./generate.mjs";

export const upstreams = () => readYaml("tools/upstreams.yaml");

async function newestPins(current) {
  const release = await github(`/repos/${current.mason.repo}/releases/latest`);
  const checksums = (await getBytes(`https://github.com/${current.mason.repo}/releases/download/${release.tag_name}/checksums.txt`)).toString("utf8");
  const line = checksums.split("\n").find((entry) => entry.endsWith("  registry.json.zip"));
  if (!line) throw new Error(`mason ${release.tag_name} publishes no checksum for registry.json.zip`);
  const sources = {};
  for (const [name, pin] of Object.entries(current.sources)) {
    const head = await github(`/repos/${pin.repo}/commits/HEAD`);
    sources[name] = { repo: pin.repo, sha: head.sha };
  }
  return {
    schema_version: current.schema_version,
    mason: { repo: current.mason.repo, tag: release.tag_name, sha256: line.split(/\s+/)[0] },
    sources,
  };
}

export async function trackTools({ log = console.log, move = true } = {}) {
  const pins = move ? await newestPins(upstreams()) : upstreams();
  if (move) writeText("tools/upstreams.yaml", dump(pins));
  const { files, summary } = await generate(pins);
  for (const [path, text] of files) writeText(path, text);
  const brief = (key, value) => (["template_misses", "unreadable", "untranslatable", "language_misses"].includes(key) && Array.isArray(value) ? { count: value.length, first: value.slice(0, 5) } : value);
  log(JSON.stringify(summary, brief, 2));
  return summary;
}
