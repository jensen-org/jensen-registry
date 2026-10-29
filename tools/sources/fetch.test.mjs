import assert from "node:assert/strict";
import test from "node:test";
import { retryAfterSeconds } from "../../lib.mjs";
import { LONGEST_WAIT_MS, RETRY_ATTEMPTS, retryDelay } from "./fetch.mjs";

const headers = (values) => ({ get: (name) => values[name] ?? null });

test("a rate limited answer waits until the limit resets, as the headers say", () => {
  assert.equal(retryAfterSeconds(headers({ "retry-after": "30" })), 30);
  const nowMs = 1_000_000;
  assert.equal(retryAfterSeconds(headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1090" }), nowMs), 90);
  assert.equal(retryAfterSeconds(headers({ "x-ratelimit-remaining": "12" })), null);
});

test("a short wait is honoured and a wait longer than the job can spare gives up loudly", () => {
  assert.equal(retryDelay({ status: 403, retryAfter: 45 }, 0), 45_000);
  assert.equal(retryDelay({ status: 403, retryAfter: LONGEST_WAIT_MS / 1000 + 1 }, 0), null);
});

test("an answer without a hint backs off, and stops after the attempts are spent", () => {
  assert.equal(retryDelay({ status: 503, retryAfter: null }, 0), 2000);
  assert.equal(retryDelay({ status: 503, retryAfter: null }, 2), 8000);
  assert.equal(retryDelay({ status: 503, retryAfter: null }, RETRY_ATTEMPTS), null);
});

test("an answer that retrying cannot change is not retried", () => {
  assert.equal(retryDelay({ status: 401, retryAfter: null }, 0), null);
  assert.equal(retryDelay({ status: 404, retryAfter: null }, 0), null);
});
