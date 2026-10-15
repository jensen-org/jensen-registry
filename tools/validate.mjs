import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SCHEMA_VERSION, readYaml } from "../lib.mjs";
import { LEGACY_COPIES } from "./track.mjs";

export function validateTools({ problems }) {
  if (readYaml("tools/upstreams.yaml").schema_version !== SCHEMA_VERSION) problems.push("tools/upstreams.yaml: wrong schema_version");
  for (const name of LEGACY_COPIES) {
    const copy = readFileSync(join(ROOT, name));
    const source = readFileSync(join(ROOT, "tools", name));
    if (!copy.equals(source)) problems.push(`${name}: the copy released clients read differs from tools/${name}, run npm run track`);
  }
}
