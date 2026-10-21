import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBytes, github, sha256 } from "../lib.mjs";

const MASON = "mason-org/mason-registry";

export const masonUrls = (tag) => ({
  registry_url: `https://github.com/${MASON}/releases/download/${tag}/registry.json.zip`,
  checksums_url: `https://github.com/${MASON}/releases/download/${tag}/checksums.txt`,
});

export async function resolveUpstreams() {
  const release = await github(`/repos/${MASON}/releases/latest`);
  const checksums = (await getBytes(masonUrls(release.tag_name).checksums_url)).toString("utf8");
  const line = checksums.split("\n").find((entry) => entry.trim().endsWith("registry.json.zip"));
  if (!line) throw new Error(`${release.tag_name} publishes no checksum for registry.json.zip`);
  return { schema_version: 1, mason: { tag: release.tag_name, sha256: line.trim().split(/\s+/)[0], ...masonUrls(release.tag_name) } };
}

export async function fetchPackages(upstreams) {
  const archive = await getBytes(upstreams.mason.registry_url);
  if (sha256(archive) !== upstreams.mason.sha256) throw new Error(`mason ${upstreams.mason.tag} registry.json.zip does not match the sha256 pinned in tools/upstreams.yaml`);
  const dir = mkdtempSync(join(tmpdir(), "mason-"));
  try {
    writeFileSync(join(dir, "registry.zip"), archive);
    const json = execFileSync("unzip", ["-p", join(dir, "registry.zip"), "registry.json"], { maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(json.toString("utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
