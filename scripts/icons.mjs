import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const HEX = /^[0-9A-Fa-f]{6}$/;
export const MAX_PATH_DATA = 16384;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-. ,]+$/;
const UPSTREAM = /^<svg role="img" viewBox="0 0 24 24" xmlns="http:\/\/www\.w3\.org\/2000\/svg"><title>[^<>"]*<\/title><path d="([^"<>&]*)"\/><\/svg>\s*$/;
const CANONICAL = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"><path d="([^"<>&]*)"\/><\/svg>\n$/;

export function checkPathData(d) {
  if (typeof d !== "string" || d.length === 0) throw new Error("icon path data is empty");
  if (d.length > MAX_PATH_DATA) throw new Error(`icon path data is longer than ${MAX_PATH_DATA} characters`);
  if (!PATH_DATA.test(d)) throw new Error("icon path data holds a character outside the path alphabet");
  if (!/^[Mm]/.test(d)) throw new Error("icon path data must start with a move command");
  return d;
}

export const canonicalSvg = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${checkPathData(d)}"/></svg>\n`;

export function fromUpstream(text) {
  const match = UPSTREAM.exec(text);
  if (!match) throw new Error("icon is not a single path on a 24 by 24 canvas");
  return checkPathData(match[1]);
}

export function fromCanonical(text) {
  const match = CANONICAL.exec(text);
  if (!match) throw new Error("icon is not the canonical single path form");
  return checkPathData(match[1]);
}

export function checkCanonicalBytes(bytes) {
  const text = bytes.toString("utf8");
  if (canonicalSvg(fromCanonical(text)) !== text) throw new Error("icon is not byte for byte canonical");
}

export function simpleIcons() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "simple-icons");
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(root, "data", "simple-icons.json"), "utf8"));
  return {
    version,
    resolve(slug) {
      if (!SLUG.test(slug)) throw new Error(`"${slug}" is not a valid icon slug`);
      const found = catalog.find((icon) => icon.slug === slug);
      if (!found) throw new Error(`simple-icons ${version} has no icon "${slug}"`);
      if (!HEX.test(found.hex)) throw new Error(`simple-icons ${version} gives "${slug}" a malformed color`);
      const d = fromUpstream(readFileSync(join(root, "icons", `${slug}.svg`), "utf8"));
      return { d, hex: found.hex.toUpperCase() };
    },
  };
}
