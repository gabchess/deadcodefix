import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { loadCase } from "../src/design-comparison/load-case.ts";
import { ownedFixture } from "../src/adapters/owned-fixture.ts";
test("generated owned case pins a real repository and exact supplied repair", () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-demo-"));
  try {
    const folder = join(root, "case");
    createOwnedCase(folder);
    const loaded = loadCase(folder);
    assert.equal(loaded.experiment.caseId, "owned-response-format");
    assert.deepEqual(
      loaded.experiment.arms.map((a) => a.id),
      ["B", "C"],
    );
    assert.equal(
      readFileSync(join(folder, "repository", "harness.ts"), "utf8"),
      ownedFixture().baseline,
    );
    assert.equal(
      loaded.prepared.files
        .find((f) => f.path === "harness.ts")
        ?.content.toString(),
      ownedFixture().repaired,
    );
    assert.match(loaded.patch, /diff --git a\/harness.ts b\/harness.ts/);
    assert.throws(() => createOwnedCase(folder), /exist/i);
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-demo-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
