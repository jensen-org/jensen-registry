import assert from "node:assert/strict";
import test from "node:test";
import { runWithTimeout } from "./track.mjs";

test("a build that hangs is killed at the timeout and reported, not left to stall the run", async () => {
  const started = Date.now();
  const result = await runWithTimeout(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: process.cwd(), timeoutMs: 300 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /timed out/);
  assert.ok(Date.now() - started < 5000);
});

test("a build that finishes before the timeout succeeds", async () => {
  const result = await runWithTimeout(process.execPath, ["-e", "process.exit(0)"], { cwd: process.cwd(), timeoutMs: 5000 });
  assert.deepEqual(result, { ok: true });
});

test("a build that fails is reported with its exit code", async () => {
  const result = await runWithTimeout(process.execPath, ["-e", "process.exit(3)"], { cwd: process.cwd(), timeoutMs: 5000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exited with 3/);
});
