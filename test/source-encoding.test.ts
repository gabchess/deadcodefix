import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { collectCaseEvidence } from "../src/collect-evidence/case.ts";

test("frozen evidence rejects invalid UTF-8 even when replacement text matches the declared hash", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-source-encoding-"));
  try {
    mkdirSync(join(root, "sources"));
    writeFileSync(
      join(root, "evidence-policy.json"),
      JSON.stringify({
        allowedHosts: ["example.invalid"],
        expectedVersion: "v1",
      }),
    );
    const bytes = Buffer.from([0xff]);
    writeFileSync(join(root, "sources", "guide.md"), bytes);
    const packet = {
      schemaVersion: 1,
      packetId: "encoding",
      caseId: "owned",
      omissions: [],
      allowanceId: null,
      sources: [
        {
          url: "https://example.invalid/guide",
          finalUrl: "https://example.invalid/guide",
          retrievedAt: "2026-11-24T00:00:00Z",
          declaredVersion: "v1",
          contentSha256: createHash("sha256")
            .update(bytes.toString("utf8"))
            .digest("hex"),
          storedPath: "sources/guide.md",
          excerpt: "",
          method: "manual-import",
        },
      ],
    };
    await assert.rejects(collectCaseEvidence(root, packet), /UTF-8/);
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-source-encoding-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
