import { gunzipSync, unzipSync } from "fflate";
import { getBytes, github, sha256 } from "../../lib.mjs";

const memo = new Map();
const once = (key, make) => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
};

export const rawText = (repo, sha, path) =>
  once(`raw:${repo}@${sha}:${path}`, async () => (await getBytes(`https://raw.githubusercontent.com/${repo}/${sha}/${path}`)).toString("utf8"));

export function untar(bytes) {
  const files = new Map();
  let offset = 0;
  let longName = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => Buffer.from(header.subarray(start, start + length)).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    let name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    if (type === "L") longName = Buffer.from(body).toString("utf8").replace(/\0.*$/s, "");
    else if (type === "0" || type === "") files.set(name.split("/").slice(1).join("/"), Buffer.from(body));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

export const repoFiles = (repo, sha) =>
  once(`tar:${repo}@${sha}`, async () => untar(gunzipSync(await getBytes(`https://codeload.github.com/${repo}/tar.gz/${sha}`))));

export async function masonRegistry({ repo, tag, sha256: pinned }) {
  return once(`mason:${repo}@${tag}`, async () => {
    const base = `https://github.com/${repo}/releases/download/${tag}`;
    const zip = await getBytes(`${base}/registry.json.zip`);
    if (sha256(zip) !== pinned) throw new Error(`mason registry ${tag} does not match its pinned sha256`);
    const published = (await getBytes(`${base}/checksums.txt`)).toString("utf8");
    const line = published.split("\n").find((entry) => entry.endsWith("  registry.json.zip"));
    if (!line || line.split(/\s+/)[0] !== pinned) throw new Error(`mason registry ${tag} does not match the checksum its release publishes`);
    const entries = unzipSync(new Uint8Array(zip));
    return JSON.parse(Buffer.from(entries["registry.json"]).toString("utf8"));
  });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const releaseDigests = (repo, tag) =>
  once(`release:${repo}@${tag}`, async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const release = await github(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
        return new Map(
          (release.assets ?? [])
            .filter((asset) => asset.digest?.startsWith("sha256:"))
            .map((asset) => [asset.name, asset.digest.slice("sha256:".length)]),
        );
      } catch (error) {
        const message = String(error.message);
        if (/answered (404|451)$/.test(message)) return new Map();
        if (!/answered (403|429|502|503)$/.test(message) || attempt >= 4) throw error;
        await pause(2000 * 2 ** attempt);
      }
    }
  });
