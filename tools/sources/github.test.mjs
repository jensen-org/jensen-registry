import assert from "node:assert/strict";
import test from "node:test";
import { refusedByAllowList } from "../../lib.mjs";

test("an organization that only admits listed addresses is told apart from other refusals", () => {
  const listed = Object.assign(new Error('answered 403 (said: {"message":"the `aquasecurity` organization has an IP allow list enabled, and your IP address is not permitted"})'), { status: 403 });
  assert.equal(refusedByAllowList(listed), true);
  assert.equal(refusedByAllowList(Object.assign(new Error("answered 403 (said: rate limit)"), { status: 403 })), false);
  assert.equal(refusedByAllowList(Object.assign(new Error("IP allow list"), { status: 404 })), false);
  assert.equal(refusedByAllowList(undefined), false);
});
