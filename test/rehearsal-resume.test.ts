import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { runOwnedCase } from "../src/adapters/run-owned-case.ts";
import { RunStore } from "../src/run-comparison/store.ts";
import { readSavedRun, writeReport } from "../src/prepare-repair/saved-run.ts";

test("deadline during rehearsal retains observations and terminal slot outcomes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-rehearsal-expiry-"));
  try {
    const folder = join(root, "case"),
      output = join(root, "run");
    createOwnedCase(folder);
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    const save = RunStore.prototype.saveRaw;
    t.mock.method(
      RunStore.prototype,
      "saveRaw",
      function (this: RunStore, raw: string) {
        const ref = save.call(this, raw);
        if (raw.includes('"checkId"')) now += 600000;
        return ref;
      },
    );
    const spy = t.mock.method(childProcess, "spawnSync");
    syncBuiltinESMExports();
    const result = await runOwnedCase(folder, output);
    assert.equal(spy.mock.callCount(), 1);
    assert.equal(result.attempts.length, 8);
    assert.ok(
      result.attempts.every((attempt) => attempt.disposition === "not_run"),
    );
    const saved = readSavedRun(output);
    const rehearsal = JSON.parse(saved.readRaw(result.rehearsal));
    assert.equal(rehearsal.correct.status, "unknown");
    assert.equal(rehearsal.correct.checks.length, 1);
    assert.ok(
      saved
        .readRaw(rehearsal.correct.checks[0].observation)
        .includes('"stdout"'),
    );
    assert.equal(writeReport(output).status, "written");
    assert.deepEqual(await runOwnedCase(folder, output), result);
    assert.equal(spy.mock.callCount(), 1);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (!root.startsWith(join(tmpdir(), "deadcodefix-rehearsal-expiry-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

test("expired initialization records every slot without running rehearsal", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-expired-init-"));
  try {
    const folder = join(root, "case"),
      output = join(root, "run");
    createOwnedCase(folder);
    const original = RunStore.prototype.getRunDeadline;
    t.mock.method(
      RunStore.prototype,
      "getRunDeadline",
      function (this: RunStore, duration: number) {
        original.call(this, duration);
        throw new Error("Interrupted after deadline publication");
      },
    );
    await assert.rejects(
      runOwnedCase(folder, output),
      /Interrupted after deadline/,
    );
    t.mock.restoreAll();
    const expired = Date.now() + 600000;
    t.mock.method(Date, "now", () => expired);
    const spy = t.mock.method(childProcess, "spawnSync", () => {
      throw new Error("No candidate after expiration");
    });
    syncBuiltinESMExports();
    const result = await runOwnedCase(folder, output);
    assert.equal(result.attempts.length, 8);
    assert.ok(
      result.attempts.every(
        (attempt) =>
          attempt.disposition === "not_run" && attempt.verification === null,
      ),
    );
    assert.equal(spy.mock.callCount(), 0);
    assert.equal(writeReport(output).status, "written");
    assert.deepEqual(readSavedRun(output).run, result);
    assert.deepEqual(await runOwnedCase(folder, output), result);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (!root.startsWith(join(tmpdir(), "deadcodefix-expired-init-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

test("expired completed replay resumes without executing verifier rehearsal again", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-rehearsal-resume-"));
  try {
    const folder = join(root, "case");
    const output = join(root, "run");
    createOwnedCase(folder);
    const first = await runOwnedCase(folder, output);
    const expired = Date.now() + 600000;
    t.mock.method(Date, "now", () => expired);
    const spy = t.mock.method(childProcess, "spawnSync", () => {
      throw new Error("No candidate execution is allowed after expiration");
    });
    syncBuiltinESMExports();
    assert.deepEqual(await runOwnedCase(folder, output), first);
    assert.equal(spy.mock.callCount(), 0);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (!root.startsWith(join(tmpdir(), "deadcodefix-rehearsal-resume-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
