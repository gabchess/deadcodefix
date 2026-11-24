import { experimentFixture } from "./fixtures/experiment.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { validateExperiment } from "../src/design-comparison/schema.ts";
test("rejects an unsupported experiment schema before executing work", () => {
  const result = validateExperiment({ schemaVersion: 99 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Unsupported schemaVersion: expected 1"));
});

test("rejects an incomplete registration instead of treating version alone as a plan", () => {
  const result = validateExperiment({ schemaVersion: 1 });
  assert.equal(result.valid, false);
  for (const field of [
    "caseId",
    "repoSHA",
    "taskHash",
    "evidenceHash",
    "verifierHash",
    "repairHash",
    "arms",
    "primaryComparison",
    "phases",
    "limits",
  ]) {
    assert.ok(
      result.errors.some((error) => error.startsWith(field + ":")),
      field,
    );
  }
});

test("validates immutable identities, arm roles and finite resource limits", () => {
  const good = experimentFixture();
  assert.equal(validateExperiment(good).valid, true);
  const bad: unknown[] = [
    { ...good, caseId: "../outside" },
    { ...good, repoSHA: "HEAD" },
    { ...good, taskHash: "wrong" },
    { ...good, evidenceHash: null },
    { ...good, verifierHash: "" },
    { ...good, repairHash: "latest" },
    { ...good, arms: [] },
    { ...good, arms: [good.arms[1], good.arms[1]] },
    { ...good, arms: good.arms.map((a) => ({ ...a, repair: false })) },
    { ...good, arms: good.arms.map((a) => ({ ...a, model: {} })) },
    { ...good, primaryComparison: ["A", "C"] },
    { ...good, phases: { smoke: 0, pilot: 2, main: 4 } },
    { ...good, phases: { smoke: 1, pilot: 2, main: NaN } },
    { ...good, limits: {} },
    { ...good, limits: { ...good.limits, runMs: Infinity } },
    { ...good, limits: { ...good.limits, totalCapMicros: -1 } },
  ];
  for (const value of bad)
    assert.equal(validateExperiment(value).valid, false, JSON.stringify(value));
  const withoutOld = { ...good, arms: good.arms.slice(1) };
  assert.equal(validateExperiment(withoutOld).valid, true);
});

test("rejects confounded repair arms and schedules outside bounded prototype limits", () => {
  const good = experimentFixture();
  for (const input of [
    {
      ...good,
      arms: good.arms.map((a) =>
        a.id === "C" ? { ...a, model: { ...a.model, id: "another-model" } } : a,
      ),
    },
    { ...good, arms: [{ ...good.arms[0], id: ["A"] }, ...good.arms.slice(1)] },
    { ...good, phases: { smoke: 1, pilot: 1, main: 1000000 } },
    { ...good, limits: { ...good.limits, attemptMs: 2147483648 } },
    { ...good, limits: { ...good.limits, runMs: 2147483648 } },
  ])
    assert.equal(validateExperiment(input).valid, false, JSON.stringify(input));
});
