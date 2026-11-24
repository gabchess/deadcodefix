import test from "node:test";
import assert from "node:assert/strict";
import { ownedFixture } from "../src/adapters/owned-fixture.ts";
import { verifyArtifact } from "../src/verify-artifacts/index.ts";
test("owned response-format fixture exposes the break and preserves required legacy compatibility", () => {
  const fixture = ownedFixture();
  const baseline = verifyArtifact(
    { files: { "harness.ts": fixture.baseline } },
    fixture.verifier,
  );
  const repaired = verifyArtifact(
    { files: { "harness.ts": fixture.repaired } },
    fixture.verifier,
  );
  assert.equal(baseline.status, "fail");
  assert.equal(repaired.status, "pass");
  assert.equal(repaired.completedChecks, 6);
  assert.equal(
    baseline.checks.find((c) => c.id === "legacy-compatibility")?.passed,
    true,
  );
  assert.equal(
    baseline.checks.find((c) => c.id === "current-tool-format")?.passed,
    false,
  );
  assert.equal(
    repaired.checks.every((c) => c.passed),
    true,
  );
  assert.match(fixture.task, /legacy/);
});
