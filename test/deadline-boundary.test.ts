import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { runExperiment } from "../src/run-comparison/index.ts";
import { replayWorker } from "../src/adapters/replay-worker.ts";
import { experimentFixture } from "./fixtures/experiment.ts";

test("worker completion at the absolute deadline cannot start verification", async (t) => {
  const spec = experimentFixture();
  let clock = Date.now();
  const initial = clock;
  t.mock.method(Date, "now", () => clock);
  const spawn = t.mock.method(childProcess, "spawnSync", () => {
    throw new Error("Verifier must not start");
  });
  syncBuiltinESMExports();
  try {
    const source = 'process.stdout.write("42");';
    const raw = JSON.stringify({ files: { "harness.cjs": source } });
    const hash = (text: string) =>
      createHash("sha256").update(text).digest("hex");
    const run = await runExperiment(
      spec,
      async () => {
        const result = await replayWorker(
          { raw, rawHash: hash(raw), maxBytes: 1024 },
          () => "raw.txt",
        );
        clock = initial + spec.limits.runMs;
        return result;
      },
      {
        entry: "harness.cjs",
        qualifiedHashes: new Set([hash(source)]),
        checks: [{ id: "answer", input: {}, expected: 42 }],
        protectedHashes: {},
        timeoutMs: 1000,
        maxBytes: 1024,
      },
    );
    assert.equal(spawn.mock.callCount(), 0);
    assert.equal(run.attempts[0].disposition, "unknown");
    assert.equal(run.attempts[0].verification, null);
    assert.ok(run.attempts.slice(1).every((a) => a.disposition === "not_run"));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
