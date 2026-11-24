import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyArtifact } from "../src/verify-artifacts/index.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

test("skipped inventory and supervisor crashes cannot produce a passing receipt", () => {
  const source =
    'process.stdout.write(JSON.stringify({skipped:1,status:"pass"}));';
  const config = {
    entry: "harness.cjs",
    qualifiedHashes: new Set([hash(source)]),
    checks: [{ id: "required", input: {}, expected: { value: 42 } }],
    protectedHashes: {},
    timeoutMs: 1000,
    maxBytes: 1024,
  };
  const artifact = { files: { "harness.cjs": source } };
  assert.equal(verifyArtifact(artifact, config).status, "fail");
  assert.equal(
    verifyArtifact(artifact, { ...config, checks: [] }).status,
    "unknown",
  );
  assert.equal(
    verifyArtifact(artifact, {
      ...config,
      checks: [...config.checks, ...config.checks],
    }).status,
    "unknown",
  );
  const brokenSupervisor = {
    ...config,
    get checks(): typeof config.checks {
      throw new Error("Injected supervisor crash");
    },
  };
  const crashed = verifyArtifact(artifact, brokenSupervisor);
  assert.equal(crashed.status, "unknown");
  assert.equal(crashed.completedChecks, 0);
  assert.match(crashed.reason, /Injected supervisor crash/);
});
test("supervisor owns exact assertions and rejects forged passes or protected changes", () => {
  const correct = "process.stdout.write(JSON.stringify({value:42}));";
  const forged =
    'process.stdout.write(JSON.stringify({status:"pass",skipped:0}));';
  const config = {
    entry: "harness.cjs",
    qualifiedHashes: new Set([hash(correct), hash(forged)]),
    checks: [{ id: "answer", input: {}, expected: { value: 42 } }],
    protectedHashes: { "guard.txt": hash("unchanged") },
    timeoutMs: 1000,
    maxBytes: 1024,
  };
  const good = verifyArtifact(
    { files: { "harness.cjs": correct, "guard.txt": "unchanged" } },
    config,
  );
  assert.equal(good.status, "pass");
  assert.match(good.verifierHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(good.completedChecks, 1);
  assert.equal(
    verifyArtifact(
      { files: { "harness.cjs": forged, "guard.txt": "unchanged" } },
      config,
    ).status,
    "fail",
  );
  assert.equal(
    verifyArtifact(
      { files: { "harness.cjs": correct, "guard.txt": "changed" } },
      config,
    ).status,
    "fail",
  );
  assert.equal(
    verifyArtifact(
      { files: { "harness.cjs": correct, "guard.txt": "unchanged" } },
      { ...config, checks: [] },
    ).status,
    "unknown",
  );
});

test("interrupted verification retains raw output and its termination reason", () => {
  const hanging = 'process.stdout.write("partial evidence"); while(true) {}';
  const result = verifyArtifact(
    { files: { "harness.cjs": hanging } },
    {
      entry: "harness.cjs",
      qualifiedHashes: new Set([hash(hanging)]),
      checks: [{ id: "hang", input: {}, expected: 42 }],
      protectedHashes: {},
      timeoutMs: 250,
      maxBytes: 1024,
    },
  );
  assert.equal(result.status, "unknown");
  assert.equal(result.completedChecks, 0);
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].stdout, "partial evidence");
  assert.equal(result.checks[0].termination, "unknown");
});

test("verifier observations must be saved before a correctness verdict is returned", () => {
  const source = 'process.stdout.write("unparseable raw output");';
  const observations: unknown[] = [];
  const config = {
    entry: "harness.cjs",
    qualifiedHashes: new Set([hash(source)]),
    checks: [{ id: "raw", input: {}, expected: 42 }],
    protectedHashes: {},
    timeoutMs: 1000,
    maxBytes: 1024,
    persistObservation: (value: unknown) => {
      observations.push(value);
      return {
        path: "objects/" + "a".repeat(64) + ".txt",
        sha256: "a".repeat(64),
      };
    },
  };
  const receipt = verifyArtifact({ files: { "harness.cjs": source } }, config);
  assert.equal(observations.length, 1);
  assert.equal(receipt.status, "fail");
  assert.equal(receipt.checks[0].observation?.sha256, "a".repeat(64));
  const storageFailure = verifyArtifact(
    { files: { "harness.cjs": source } },
    {
      ...config,
      persistObservation: () => {
        throw new Error("Observation storage unavailable");
      },
    },
  );
  assert.equal(storageFailure.status, "unknown");
  assert.equal(storageFailure.completedChecks, 0);
  assert.match(storageFailure.reason, /storage unavailable/);
});
