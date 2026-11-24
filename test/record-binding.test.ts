import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { runOwnedCase } from "../src/adapters/run-owned-case.ts";
import { createHash } from "node:crypto";

test("owned replay rejects baseline and repair recordings assigned to the wrong arms", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-record-binding-"));
  try {
    const folder = join(root, "case");
    createOwnedCase(folder);
    const baseline = readFileSync(join(folder, "records", "B.json"));
    const repaired = readFileSync(join(folder, "records", "C.json"));
    writeFileSync(join(folder, "records", "B.json"), repaired);
    writeFileSync(join(folder, "records", "C.json"), baseline);
    await assert.rejects(
      runOwnedCase(folder, join(root, "run")),
      /Replay record does not match its qualified arm/,
    );
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-record-binding-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejected recording bytes survive invalid UTF-8 without normalization", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-raw-rejection-"));
  try {
    const folder = join(root, "case");
    const output = join(root, "run");
    createOwnedCase(folder);
    const bytes = Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    writeFileSync(join(folder, "records", "B.json"), bytes);
    await assert.rejects(runOwnedCase(folder, output), /qualified arm/);
    const records = readdirSync(join(output, "objects")).map((name) =>
      JSON.parse(readFileSync(join(output, "objects", name), "utf8")),
    );
    const rejected = records.find(
      (value) => value.kind === "rejected-replay-input",
    );
    assert.equal(rejected.arm, "B");
    assert.equal(rejected.encoding, "base64");
    assert.deepEqual(Buffer.from(rejected.bytes, "base64"), bytes);
    assert.equal(
      rejected.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-raw-rejection-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
