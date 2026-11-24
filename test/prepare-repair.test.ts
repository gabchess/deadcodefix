import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { prepareRepair } from "../src/design-comparison/prepare-repair.ts";
test("applies the exact patch in a disposable index and verifies the resulting tree", () => {
  const repo = mkdtempSync(join(tmpdir(), "deadcodefix-repair-"));
  const git = (args: string[], input?: string) =>
    execFileSync(
      "git",
      ["-c", "core.hooksPath=" + join(repo, "no-hooks"), ...args],
      { cwd: repo, input, encoding: "utf8" },
    ).trim();
  try {
    git(["init", "-q"]);
    writeFileSync(join(repo, "harness.ts"), "old\n");
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "Owned baseline",
    ]);
    const baseSHA = git(["rev-parse", "HEAD"]);
    const blob = git(["hash-object", "-w", "--stdin"], "new\n");
    const expectedResultTreeHash = git(
      ["mktree"],
      "100644 blob " + blob + "\tharness.ts\n",
    );
    const patch =
      "diff --git a/harness.ts b/harness.ts\n--- a/harness.ts\n+++ b/harness.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const manifest = {
      baseSHA,
      expectedResultTreeHash,
      patchSha256: createHash("sha256").update(patch).digest("hex"),
      allowedPaths: ["harness.ts"],
      protectedPaths: [],
      authorKind: "fixture" as const,
    };
    const result = prepareRepair({ repo, manifest, patch });
    assert.equal(result.treeHash, expectedResultTreeHash);
    assert.equal(result.files[0].content.toString(), "new\n");
    assert.equal(git(["show", "HEAD:harness.ts"]), "old");
    assert.throws(
      () =>
        prepareRepair({
          repo,
          manifest: { ...manifest, expectedResultTreeHash: "0".repeat(40) },
          patch,
        }),
      /result tree mismatch/,
    );
  } finally {
    assert.ok(repo.startsWith(join(tmpdir(), "deadcodefix-repair-")));
    rmSync(repo, { recursive: true, force: true });
  }
});
