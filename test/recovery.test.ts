import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { RunStore } from "../src/run-comparison/store.ts";
import { runExperiment } from "../src/run-comparison/index.ts";
import { replayWorker } from "../src/adapters/replay-worker.ts";
import { experimentFixture } from "./fixtures/experiment.ts";

test("resume retains the original whole-run deadline and stops before another worker", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-recovery-"));
  try {
    const spec = experimentFixture();
    const past = Date.now() - spec.limits.runMs - 1;
    const originalNow = Date.now;
    let deadline: number;
    try {
      Date.now = () => past;
      const store = new RunStore(join(root, "run"), spec, 1048576);
      deadline = store.getRunDeadline(spec.limits.runMs);
      store.close();
    } finally {
      Date.now = originalNow;
    }
    const resumed = new RunStore(join(root, "run"), spec, 1048576);
    assert.equal(resumed.getRunDeadline(spec.limits.runMs), deadline);
    let calls = 0;
    const result = await runExperiment(
      spec,
      async () => {
        calls++;
        throw new Error("Must not dispatch");
      },
      {
        entry: "harness.cjs",
        qualifiedHashes: new Set(),
        checks: [],
        protectedHashes: {},
        timeoutMs: 100,
        maxBytes: 1024,
      },
      resumed,
    );
    assert.equal(calls, 0);
    assert.ok(
      result.attempts.every((attempt) => attempt.disposition === "not_run"),
    );
    assert.throws(
      () => resumed.getRunDeadline(spec.limits.runMs + 1),
      /deadline/i,
    );
    resumed.close();
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), "deadcodefix-recovery-")));
    rmSync(root, { recursive: true, force: true });
  }
});
test("resume after an interrupted receipt never repeats the started worker", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-recovery-"));
  try {
    const spec = {
      ...experimentFixture(),
      phases: { smoke: 1, pilot: 1, main: 1 },
    };
    const store = new RunStore(join(root, "run"), spec, 1048576);
    const source = 'process.stdout.write("42");';
    const verifier = {
      entry: "harness.cjs",
      qualifiedHashes: new Set([
        createHash("sha256").update(source).digest("hex"),
      ]),
      checks: [{ id: "answer", input: {}, expected: 42 }],
      protectedHashes: {},
      timeoutMs: 1000,
      maxBytes: 1024,
    };
    let calls = 0;
    const worker = async () => {
      calls++;
      const raw = JSON.stringify({ files: { "harness.cjs": source } });
      return replayWorker(
        {
          raw,
          rawHash: createHash("sha256").update(raw).digest("hex"),
          maxBytes: 1024,
        },
        (text) => store.saveRaw(text).path,
      );
    };
    await assert.rejects(
      runExperiment(spec, worker, verifier, {
        getRunDeadline: (duration) => store.getRunDeadline(duration),
        beginAttempt: (id, startedAt) => store.beginAttempt(id, startedAt),
        readStartedAt: (id) => store.readStartedAt(id),
        readAttempt: (id) => store.readAttempt(id),
        completeAttempt: () => {
          throw new Error("Injected disk interruption");
        },
      }),
      /Injected disk/,
    );
    assert.equal(calls, 1);
    const durableStart = JSON.parse(
      readFileSync(join(root, "run", "smoke-1-A.started.json"), "utf8"),
    ).startedAt;
    const resumed = await runExperiment(spec, worker, verifier, store);
    assert.equal(resumed.attempts[0].startedAt, durableStart);
    assert.equal(calls, 1);
    assert.equal(resumed.attempts.length, 9);
    assert.equal(resumed.attempts[0].disposition, "unknown");
    assert.match(resumed.attempts[0].reason, /interrupted/i);
    assert.equal(
      resumed.attempts.slice(1).every((a) => a.disposition === "not_run"),
      true,
    );
    assert.deepEqual(
      await runExperiment(spec, worker, verifier, store),
      resumed,
    );
    assert.equal(calls, 1);
    store.close();
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-recovery-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
