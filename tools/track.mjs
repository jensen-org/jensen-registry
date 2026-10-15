import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib.mjs";

export const LEGACY_COPIES = ["tools.yaml", "upstreams.yaml"];

export function trackTools() {
  for (const name of LEGACY_COPIES) copyFileSync(join(ROOT, "tools", name), join(ROOT, name));
}
