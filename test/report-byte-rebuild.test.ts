import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { runOwnedCase } from "../src/adapters/run-owned-case.ts";
import { writeReport } from "../src/prepare-repair/saved-run.ts";

test("report rebuild restores exact bytes when corrupt bytes decode identically", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-report-bytes-"));
  try {
    const folder = join(root, "case"),
      output = join(root, "run");
    createOwnedCase(folder);
    const packetPath = join(folder, "evidence.json");
    const packet = JSON.parse(readFileSync(packetPath, "utf8"));
    const source = packet.sources[0];
    const content =
      readFileSync(join(folder, source.storedPath), "utf8") +
      "\nLiteral replacement character: \uFFFD\n";
    const hash = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    writeFileSync(join(folder, source.storedPath), content);
    source.excerpt = content;
    source.contentSha256 = hash(content);
    const raw = JSON.stringify(packet);
    writeFileSync(packetPath, raw);
    const experimentPath = join(folder, "experiment.json");
    const experiment = JSON.parse(readFileSync(experimentPath, "utf8"));
    experiment.evidenceHash = hash(raw);
    writeFileSync(experimentPath, JSON.stringify(experiment));
    await runOwnedCase(folder, output);
    const report = writeReport(output);
    const canonical = readFileSync(report.html);
    const offset = canonical.indexOf(Buffer.from("\uFFFD"));
    assert.ok(offset >= 0);
    const corrupt = Buffer.concat([
      canonical.subarray(0, offset),
      Buffer.from([0xff]),
      canonical.subarray(offset + 3),
    ]);
    assert.equal(corrupt.toString("utf8"), canonical.toString("utf8"));
    writeFileSync(report.html, corrupt);
    writeReport(output);
    assert.deepEqual(readFileSync(report.html), canonical);
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-report-bytes-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
