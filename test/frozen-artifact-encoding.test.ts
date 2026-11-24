import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { runOwnedCase } from "../src/adapters/run-owned-case.ts";
import { readSavedRun } from "../src/prepare-repair/saved-run.ts";

test("report readback detects invalid bytes that decode to the original replacement character", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-frozen-encoding-"));
  try {
    const folder = join(root, "case"),
      output = join(root, "run");
    createOwnedCase(folder);
    const hash = (text: string) =>
      createHash("sha256").update(text).digest("hex");
    const content = "Recorded replacement character: \uFFFD";
    const packet = JSON.parse(
      readFileSync(join(folder, "evidence.json"), "utf8"),
    );
    packet.sources[0].contentSha256 = hash(content);
    packet.sources[0].excerpt = content;
    writeFileSync(join(folder, packet.sources[0].storedPath), content);
    const raw = JSON.stringify(packet);
    writeFileSync(join(folder, "evidence.json"), raw);
    const experiment = JSON.parse(
      readFileSync(join(folder, "experiment.json"), "utf8"),
    );
    experiment.evidenceHash = hash(raw);
    writeFileSync(join(folder, "experiment.json"), JSON.stringify(experiment));
    const run = await runOwnedCase(folder, output);
    const path = join(output, run.sources[0].artifact!.path);
    const bytes = readFileSync(path);
    const offset = bytes.indexOf(Buffer.from("\uFFFD"));
    assert.ok(offset >= 0);
    writeFileSync(
      path,
      Buffer.concat([
        bytes.subarray(0, offset),
        Buffer.from([0xff]),
        bytes.subarray(offset + 3),
      ]),
    );
    assert.throws(() => readSavedRun(output), /UTF-8|hash/i);
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-frozen-encoding-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
