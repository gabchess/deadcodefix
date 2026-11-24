import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateRepair } from "../src/design-comparison/repair.ts";
const patch =
  "diff --git a/harness.ts b/harness.ts\n--- a/harness.ts\n+++ b/harness.ts\n@@ -1 +1 @@\n-old\n+new\n";
export const repairFixture = () => ({
  baseSHA: "a".repeat(40),
  patchSha256: createHash("sha256").update(patch).digest("hex"),
  expectedResultTreeHash: "b".repeat(40),
  allowedPaths: ["harness.ts"],
  protectedPaths: ["test/guard.ts"],
  authorKind: "fixture",
});
test("accepts an exact bounded text repair and rejects unsafe or mismatched inputs", () => {
  assert.equal(validateRepair(repairFixture(), patch).valid, true);
  for (const change of [
    { baseSHA: "HEAD" },
    { patchSha256: "0".repeat(64) },
    { expectedResultTreeHash: "latest" },
    { allowedPaths: ["../outside"] },
    { allowedPaths: ["C:/outside"] },
    { allowedPaths: [".git/config"] },
    { protectedPaths: ["harness.ts"] },
    { allowedPaths: [] },
    { authorKind: "unknown" },
  ])
    assert.equal(
      validateRepair({ ...repairFixture(), ...change }, patch).valid,
      false,
      JSON.stringify(change),
    );
  assert.equal(
    validateRepair(repairFixture(), patch + "GIT binary patch\n").valid,
    false,
  );
});
