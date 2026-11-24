import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../src/run-comparison/store.ts";
test("immutable run storage verifies hashes, rejects changed registrations and enforces its byte cap", () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-store-"));
  try {
    const folder = join(root, "run");
    const store = new RunStore(folder, { task: "frozen" }, 4096);
    const saved = store.saveRaw("original output");
    assert.equal(store.readRaw(saved), "original output");
    assert.equal(
      readFileSync(join(folder, saved.path), "utf8"),
      "original output",
    );
    store.close();
    assert.throws(
      () => new RunStore(folder, { task: "changed" }, 4096),
      /registration/i,
    );
    const resumed = new RunStore(folder, { task: "frozen" }, 4096);
    assert.equal(resumed.readRaw(saved), "original output");
    assert.throws(() => resumed.saveRaw("x".repeat(5000)), /limit/i);
    const unicode = resumed.saveRaw("\uFFFD");
    writeFileSync(join(folder, unicode.path), Buffer.from([0xff]));
    assert.throws(() => resumed.readRaw(unicode), /UTF-8|hash/i);
    writeFileSync(join(folder, saved.path), "tampered");
    assert.throws(() => resumed.readRaw(saved), /hash/i);
    resumed.close();
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-store-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

test("started slots cannot run twice and completion receipts remain immutable", () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-store-"));
  try {
    const store = new RunStore(join(root, "run"), { task: "frozen" }, 8192);
    assert.equal(store.beginAttempt("main-1-B"), true);
    assert.equal(store.beginAttempt("main-1-B"), false);
    assert.equal(store.readAttempt("main-1-B"), null);
    const raw = store.saveRaw("original worker bytes");
    const receipt = {
      id: "main-1-B",
      phase: "main",
      arm: "B",
      replicate: 1,
      startedAt: store.readStartedAt("main-1-B"),
      endedAt: "2026-11-24T00:00:01Z",
      disposition: "fail",
      reason: "Fixture",
      rawPath: raw.path,
      rawHash: raw.sha256,
      verification: null,
    } as const;
    store.completeAttempt(receipt);
    assert.deepEqual(store.readAttempt("main-1-B"), receipt);
    assert.throws(
      () => store.completeAttempt({ ...receipt, disposition: "pass" }),
      /exist/i,
    );
    assert.throws(() => store.beginAttempt("../escape"), /slot/i);
    writeFileSync(join(root, "run", raw.path), "changed bytes");
    assert.throws(() => store.readAttempt("main-1-B"), /hash/i);
    store.close();
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-store-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

test("the run summary is published once and can be read without opening a writer", () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-store-"));
  try {
    const folder = join(root, "run"),
      store = new RunStore(folder, { task: "frozen" }, 8192);
    const summary = {
      schemaVersion: 1,
      mode: "replay",
      caseId: "fixture",
      attempts: [],
    };
    store.publishSummary(summary);
    store.publishSummary(summary);
    assert.throws(
      () => store.publishSummary({ ...summary, caseId: "changed" }),
      /summary/i,
    );
    const ref = JSON.parse(readFileSync(join(folder, "summary.json"), "utf8"));
    assert.deepEqual(JSON.parse(store.readRaw(ref)), summary);
    store.close();
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-store-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
