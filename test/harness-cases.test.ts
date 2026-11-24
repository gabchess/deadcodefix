import test from "node:test";
import assert from "node:assert/strict";
import {
  HARNESS_UPGRADE_CASES,
  verifyPiHarnessSource,
  verifyStandardsPruneSource,
} from "../src/harnesses/cases.ts";

test("Pi/pstack AI SDK v4 -> v6+ case fails on baseline Arm B and passes 6/6 on repaired Arm C", () => {
  const piCase = HARNESS_UPGRADE_CASES.find(
    (c) => c.id === "pi-sdk-tool-upgrade",
  );
  assert.ok(piCase);
  const armB = verifyPiHarnessSource(piCase.baseCode);
  const armC = verifyPiHarnessSource(piCase.repairedCode);

  assert.equal(armB.total, 6);
  assert.equal(armB.passed, 1); // only legacy-v1-compat passes on baseline
  assert.equal(armC.passed, 6); // upgrade + compat + security + bloat pruning all pass
  assert.equal(piCase.firecrawlDrift.changeStatus, "changed");
  assert.ok(piCase.tokensSavedPerTurn > 0);
});

test("Matt Pocock CODING_STANDARDS.md pruning case removes sediment while keeping architecture rules", () => {
  const mattCase = HARNESS_UPGRADE_CASES.find(
    (c) => c.id === "matt-coding-standards-prune",
  );
  assert.ok(mattCase);
  const armB = verifyStandardsPruneSource(mattCase.baseCode);
  const armC = verifyStandardsPruneSource(mattCase.repairedCode);

  assert.equal(armB.passed, 1); // only architecture rules preserved, sediment fails checks
  assert.equal(armC.passed, 4); // all 4 checks pass after pruning
  assert.ok(mattCase.tokensSavedPerTurn >= 1000);
});
