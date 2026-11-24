import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMain } from "../src/prepare-repair/statistics.ts";
import { experimentFixture } from "./fixtures/experiment.ts";
import type { RunReceipt, RunAttempt } from "../src/run-comparison/index.ts";
function row(
  arm: "A" | "B" | "C",
  replicate: number,
  disposition: RunAttempt["disposition"],
): RunAttempt {
  return {
    id: `main-${replicate}-${arm}`,
    phase: "main",
    arm,
    replicate,
    disposition,
    startedAt: "",
    endedAt: "",
    reason: "",
    rawPath: null,
    rawHash: null,
    verification: null,
  };
}
test("main comparison counts all planned slots and suppresses effect inference for incomplete runs", () => {
  const spec = {
    ...experimentFixture(),
    phases: { smoke: 1, pilot: 1, main: 2 },
  };
  const run: RunReceipt = {
    schemaVersion: 1,
    mode: "replay",
    caseId: spec.caseId,
    attempts: [
      row("A", 1, "pass"),
      row("A", 2, "pass"),
      row("B", 1, "fail"),
      row("B", 2, "fail"),
      row("C", 1, "pass"),
      row("C", 2, "pass"),
    ],
  };
  const result = summarizeMain(run, spec);
  assert.equal(result.complete, true);
  assert.equal(result.difference, 1);
  assert.equal(result.arms.B.fail, 2);
  assert.equal(result.arms.C.conservativeCompletion, 1);
  assert.ok(Math.abs(result.arms.C.interval![0] - 0.3423802275) < 0.000001);
  const missing = summarizeMain(
    { ...run, attempts: run.attempts.filter((a) => a.id !== "main-2-C") },
    spec,
  );
  assert.equal(missing.complete, false);
  assert.equal(missing.difference, null);
  assert.equal(missing.arms.C.not_run, 1);
  assert.equal(missing.arms.C.conservativeCompletion, 0.5);
  assert.equal(missing.arms.C.interval, null);
  assert.throws(
    () =>
      summarizeMain(
        { ...run, attempts: [...run.attempts, run.attempts[0]] },
        spec,
      ),
    /duplicate/i,
  );
});
