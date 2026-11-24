import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../src/run-comparison/store.ts";

test("interrupted initialization resumes with the original creation deadline", (t) => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-init-recovery-"));
  try {
    const started = Date.now() - 10000;
    t.mock.method(Date, "now", () => started);
    new RunStore(root, { caseId: "frozen" }, 1048576).close();
    t.mock.restoreAll();
    const resumed = new RunStore(root, { caseId: "frozen" }, 1048576);
    try {
      assert.equal(resumed.getRunDeadline(1000), started + 1000);
      assert.ok(resumed.getRunDeadline(1000) < Date.now());
    } finally {
      resumed.close();
    }
  } finally {
    t.mock.restoreAll();
    if (!root.startsWith(join(tmpdir(), "deadcodefix-init-recovery-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

test("deadline replacements and missing pre-slot deadlines cannot renew a run", (t) => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-deadline-integrity-"));
  try {
    const started = Date.now() - 10000;
    t.mock.method(Date, "now", () => started);
    const store = new RunStore(root, { caseId: "frozen" }, 1048576);
    store.getRunDeadline(1000);
    store.publishRehearsal({ kind: "checkpoint" });
    store.close();
    t.mock.restoreAll();
    const now = Date.now();
    writeFileSync(
      join(root, "deadline.json"),
      JSON.stringify({
        durationMs: 1000,
        startedAt: now,
        deadline: now + 1000,
      }),
    );
    const resumed = new RunStore(root, { caseId: "frozen" }, 1048576);
    try {
      assert.throws(() => resumed.getRunDeadline(1000), /deadline/i);
    } finally {
      resumed.close();
    }
    unlinkSync(join(root, "deadline.json"));
    const missing = new RunStore(root, { caseId: "frozen" }, 1048576);
    try {
      assert.throws(() => missing.getRunDeadline(1000), /deadline/i);
    } finally {
      missing.close();
    }
  } finally {
    t.mock.restoreAll();
    if (!root.startsWith(join(tmpdir(), "deadcodefix-deadline-integrity-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
