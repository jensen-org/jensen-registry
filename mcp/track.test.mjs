import assert from "node:assert/strict";
import { test } from "node:test";
import { needsSignIn } from "./track.mjs";

test("a server that signs in with OAuth is never probed anonymously", () => {
  assert.equal(needsSignIn({ transport: "http", oauth: true, env: [] }), true);
});

test("a server that sends an auth header is never probed anonymously", () => {
  assert.equal(needsSignIn({ transport: "http", headers: [{ name: "Authorization", scheme: "bearer", secret: "TOKEN" }], env: [] }), true);
});

test("a server that needs a secret variable is never probed anonymously", () => {
  assert.equal(needsSignIn({ transport: "http", env: [{ name: "KEY", secret: true }] }), true);
});

test("an open server is probed to list its tools", () => {
  assert.equal(needsSignIn({ transport: "http", env: [{ name: "REGION", secret: false }] }), false);
});
