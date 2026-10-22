import { writeText, readYaml } from "../lib.mjs";
import { generate } from "./generate.mjs";

export const upstreams = () => readYaml("tools/upstreams.yaml");

export async function trackTools({ log = console.log } = {}) {
  const { files, summary } = await generate(upstreams());
  for (const [path, text] of files) writeText(path, text);
  log(JSON.stringify(summary, (key, value) => (key === "template_misses" || key === "unreadable" || key === "untranslatable" || key === "language_misses" ? { count: value.length, first: value.slice(0, 5) } : value), 2));
  return summary;
}
