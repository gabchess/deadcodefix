import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownedCase } from "./fixtures/owned-case.ts";
import { loadCase } from "../src/design-comparison/load-case.ts";
import { runCli } from "../src/cli/index.ts";
test("pins case bytes and the repair result before reporting a validated plan", () => {
  const folder = mkdtempSync(join(tmpdir(), "deadcodefix-case-"));
  try {
    const fixture = ownedCase(folder);
    const loaded = loadCase(folder);
    assert.equal(
      loaded.prepared.treeHash,
      fixture.manifest.expectedResultTreeHash,
    );
    assert.equal(loaded.experiment.caseId, "owned-model-upgrade");
    for (const name of [
      "task.md",
      "evidence.json",
      "verifier.json",
      "repair.patch",
    ]) {
      const original = readFileSync(join(folder, name));
      writeFileSync(join(folder, name), "tampered");
      assert.throws(() => loadCase(folder), /hash mismatch/);
      assert.equal(
        runCli(["plan", "--case", folder], () => {}),
        2,
      );
      writeFileSync(join(folder, name), original);
    }
  } finally {
    assert.ok(folder.startsWith(join(tmpdir(), "deadcodefix-case-")));
    rmSync(folder, { recursive: true, force: true });
  }
});
