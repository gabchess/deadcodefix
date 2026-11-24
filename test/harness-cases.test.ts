import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HARNESS_UPGRADE_CASES,
  verifyPiHarnessSource,
  verifyStandardsPruneSource,
} from "../src/harnesses/cases.ts";

test("Pi/pstack AI SDK v4 -> v6+ case fails on baseline Arm B and passes 6/6 static contract checks on repaired Arm C", () => {
  const piCase = HARNESS_UPGRADE_CASES.find(
    (c) => c.id === "pi-sdk-tool-upgrade",
  );
  assert.ok(piCase);
  assert.equal(piCase.mode, "replay");
  assert.equal(piCase.verificationKind, "static-contract");
  const armB = verifyPiHarnessSource(piCase.baseCode);
  const armC = verifyPiHarnessSource(piCase.repairedCode);

  assert.equal(armB.verificationKind, "static-contract");
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
  assert.equal(mattCase.mode, "replay");
  assert.equal(mattCase.verificationKind, "static-contract");
  const armB = verifyStandardsPruneSource(mattCase.baseCode);
  const armC = verifyStandardsPruneSource(mattCase.repairedCode);

  assert.equal(armB.passed, 1);
  assert.equal(armC.passed, 4);
  assert.ok(mattCase.tokensSavedPerTurn >= 1000);
});

test("exported repair patches apply cleanly with git apply and reproduce repairedCode exactly", () => {
  for (const item of HARNESS_UPGRADE_CASES) {
    const dir = mkdtempSync(join(tmpdir(), "deadcodefix-patch-check-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      const target = join(dir, item.patchFilePath);
      writeFileSync(target, item.baseCode + "\n", "utf8");
      const patchPath = join(dir, "repair.patch");
      writeFileSync(patchPath, item.repairPatch, "utf8");
      execFileSync("git", ["apply", "--check", patchPath], { cwd: dir });
      execFileSync("git", ["apply", patchPath], { cwd: dir });
      const applied = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
      assert.equal(applied, item.repairedCode + "\n");
      for (const ch of item.checks) {
        assert.match(ch.observationSha256, /^[a-f0-9]{64}$/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
