import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SCHEMA_VERSION, readYaml } from "../lib.mjs";
import { GENERATED_MARKER } from "../grammars/track.mjs";
import { problemsIn } from "./generate.mjs";
import { LEGACY_COPIES, build, renderHead } from "./track.mjs";
import { fetchPackages } from "./upstream.mjs";

export async function validateTools({ problems, online }) {
  if (readYaml("tools/upstreams.yaml").schema_version !== SCHEMA_VERSION) problems.push("tools/upstreams.yaml: wrong schema_version");
  for (const name of LEGACY_COPIES) {
    const copy = readFileSync(join(ROOT, name));
    const source = readFileSync(join(ROOT, "tools", name));
    if (!copy.equals(source)) problems.push(`${name}: the copy released clients read differs from tools/${name}, run npm run track`);
  }
  const published = readYaml("tools/tools.yaml");
  for (const problem of problemsIn(published)) problems.push(`tools/tools.yaml: ${problem}`);
  if (!online) return;
  const text = readFileSync(join(ROOT, "tools/tools.yaml"), "utf8");
  const head = text.includes(GENERATED_MARKER) ? text.slice(0, text.indexOf(GENERATED_MARKER)).trimEnd() : text.trimEnd();
  const expected = renderHead(build(await fetchPackages(readYaml("tools/upstreams.yaml")))).trimEnd();
  if (head !== expected) problems.push("tools/tools.yaml differs from what its pinned sources generate, run npm run track");
}
