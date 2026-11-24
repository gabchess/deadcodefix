import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { experimentFixture } from "./fixtures/experiment.ts";
import { replayWorker } from "../src/adapters/replay-worker.ts";
import { runExperiment } from "../src/run-comparison/index.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

test("replay checks each registered phase and arm independently with preserved raw references", async () => {
  const good = "process.stdout.write(JSON.stringify({answer:42}));";
  const bad = "process.stdout.write(JSON.stringify({answer:0}));";
  const spec = {
    ...experimentFixture(),
    repository: ".",
    phases: { smoke: 1, pilot: 1, main: 2 },
  };
  const raws = new Map<string, string>();
  const run = await runExperiment(
    spec,
    async (input) => {
      const raw = JSON.stringify({
        files: { "harness.cjs": input.arm === "B" ? bad : good },
        status: "pass",
      });
      return replayWorker(
        { raw, rawHash: hash(raw), maxBytes: 1024 },
        (text) => {
          raws.set(input.id, text);
          return input.id + ".json";
        },
      );
    },
    {
      entry: "harness.cjs",
      qualifiedHashes: new Set([hash(good), hash(bad)]),
      checks: [{ id: "answer", input: {}, expected: { answer: 42 } }],
      protectedHashes: {},
      timeoutMs: 1000,
      maxBytes: 1024,
    },
  );
  assert.equal(run.mode, "replay");
  assert.equal(
    run.attempts.every(
      (a) =>
        a.usage?.providerCalls === 0 &&
        a.usage.providerBill === "not-applicable" &&
        a.usage.reservedMicros === 0,
    ),
    true,
  );
  assert.equal(run.attempts.length, 12);
  assert.equal(new Set(run.attempts.map((a) => a.id)).size, 12);
  assert.equal(raws.size, 12);
  assert.deepEqual(
    run.attempts.filter((a) => a.phase === "main").map((a) => a.arm),
    ["A", "B", "C", "C", "B", "A"],
  );
  assert.equal(
    run.attempts
      .filter((a) => a.arm === "B")
      .every((a) => a.disposition === "fail"),
    true,
  );
  assert.equal(
    run.attempts
      .filter((a) => a.arm === "C")
      .every((a) => a.disposition === "pass"),
    true,
  );
  assert.equal(
    run.attempts.every(
      (a) =>
        a.rawHash?.length === 64 && a.verification?.artifactHash.length === 64,
    ),
    true,
  );
});

test("a stalled worker times out and leaves every remaining slot explicitly not run", async () => {
  let calls = 0;
  const run = await runExperiment(
    {
      ...experimentFixture(),
      phases: { smoke: 1, pilot: 1, main: 1 },
      limits: { ...experimentFixture().limits, attemptMs: 25, runMs: 200 },
    },
    async () => {
      calls++;
      return new Promise(() => {});
    },
    {
      entry: "harness.cjs",
      qualifiedHashes: new Set(),
      checks: [{ id: "answer", input: {}, expected: 42 }],
      protectedHashes: {},
      timeoutMs: 100,
      maxBytes: 1024,
    },
  );
  assert.equal(calls, 1);
  assert.equal(run.attempts.length, 9);
  assert.equal(run.attempts[0].disposition, "unknown");
  assert.match(run.attempts[0].reason, /deadline/i);
  assert.equal(
    run.attempts.slice(1).every((a) => a.disposition === "not_run"),
    true,
  );
});
