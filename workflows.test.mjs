import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const folder = fileURLToPath(new URL("./.github/workflows/", import.meta.url));
const load = (name) => parse(readFileSync(`${folder}${name}`, "utf8"), { strict: true, uniqueKeys: true });

test("every workflow is valid yaml without duplicate keys", () => {
  for (const name of readdirSync(folder).filter((file) => /\.ya?ml$/.test(file))) {
    assert.doesNotThrow(() => load(name), name);
  }
});

test("the scheduled track runs on the branch its pull request targets", () => {
  const workflow = load("track.yml");
  const steps = workflow.jobs.track.steps;
  const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  const track = steps.find((step) => step.run === "node registry.mjs track");
  const pullRequest = steps.find((step) => step.uses?.startsWith("peter-evans/create-pull-request@"));
  assert.equal(checkout.with.ref, pullRequest.with.base);
  assert.equal(track.env.REGISTRY_REF, pullRequest.with.base);
});

test("the track job provides the wasi-sdk before it builds a grammar", () => {
  const steps = load("track.yml").jobs.track.steps;
  const install = steps.findIndex((step) => /wasi-sdk-29[\s\S]*bin\/clang/.test(step.run ?? ""));
  const track = steps.findIndex((step) => step.run === "node registry.mjs track");
  assert.ok(install >= 0, "no step installs the wasi-sdk");
  assert.ok(install < track, "the wasi-sdk must be installed before track");
});

test("validate and track resolve urls against the same branch", () => {
  const validate = load("validate.yml").jobs.validate.steps.find((step) => step.run === "node registry.mjs validate --online");
  const track = load("track.yml").jobs.track.steps.find((step) => step.run === "node registry.mjs track");
  assert.equal(validate.env.REGISTRY_REF, track.env.REGISTRY_REF);
});

test("the nightly track only re-pins and never discovers new grammars", () => {
  const steps = load("track.yml").jobs.track.steps;
  assert.ok(!steps.some((step) => /registry\.mjs discover/.test(step.run ?? "")));
});

test("the seed workflow is manual, resolves once and builds the grammars in parallel shards", () => {
  const workflow = load("seed.yml");
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(workflow.jobs), ["resolve", "build", "merge"]);
  assert.equal(workflow.jobs.build.needs, "resolve");
  assert.equal(workflow.jobs.merge.needs, "build");
  assert.equal(workflow.jobs.build.strategy["fail-fast"], false);
  const steps = workflow.jobs.build.steps;
  const install = steps.findIndex((step) => /wasi-sdk-29[\s\S]*bin\/clang/.test(step.run ?? ""));
  const build = steps.findIndex((step) => /registry\.mjs seed \$\{\{ matrix\.shard \}\}\/\d+/.test(step.run ?? ""));
  assert.ok(install >= 0 && install < build);
  const total = Number(/\/(\d+)/.exec(steps[build].run)[1]);
  assert.equal(workflow.jobs.build.strategy.matrix.shard.length, total);
});
