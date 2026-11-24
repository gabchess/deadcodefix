import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { planOwnedCase, runOwnedCase } from "../src/adapters/run-owned-case.ts";
import { writeReport } from "../src/prepare-repair/saved-run.ts";

test("qualified BOM-prefixed evidence reconstructs without changing its frozen bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-packet-bom-"));
  try {
    const folder = join(root, "case"),
      output = join(root, "run");
    createOwnedCase(folder);
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      readFileSync(join(folder, "evidence.json")),
    ]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(folder, "evidence.json"), bytes);
    const experiment = JSON.parse(
      readFileSync(join(folder, "experiment.json"), "utf8"),
    );
    experiment.evidenceHash = sha256;
    writeFileSync(join(folder, "experiment.json"), JSON.stringify(experiment));
    assert.equal(
      (await planOwnedCase(folder)).status,
      "qualified-replay-inputs",
    );
    const run = await runOwnedCase(folder, output);
    assert.equal(run.evidence.sha256, sha256);
    assert.deepEqual(readFileSync(join(output, run.evidence.path)), bytes);
    assert.equal(writeReport(output).status, "written");
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-packet-bom-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
