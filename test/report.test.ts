import test from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/prepare-repair/index.ts";
import { experimentFixture } from "./fixtures/experiment.ts";
import type { RunAttempt } from "../src/run-comparison/index.ts";
test("report labels replay, keeps phase outcomes and escapes hostile evidence", () => {
  const experiment = {
    ...experimentFixture(),
    phases: { smoke: 1, pilot: 1, main: 1 },
  };
  const ref = {
    path: "objects/" + "a".repeat(64) + ".txt",
    sha256: "a".repeat(64),
  };
  const attempts: RunAttempt[] = [];
  for (const phase of ["smoke", "pilot", "main"] as const)
    for (const arm of ["A", "B", "C"] as const)
      attempts.push({
        id: `${phase}-1-${arm}`,
        phase,
        arm,
        replicate: 1,
        startedAt: "",
        endedAt: "",
        disposition: arm === "B" ? "fail" : "pass",
        reason: '<script>alert("run")</script>',
        rawPath: ref.path,
        rawHash: ref.sha256,
        verification: null,
      });
  const run = {
    schemaVersion: 1 as const,
    mode: "replay" as const,
    caseId: experiment.caseId,
    attempts,
    repoSHA: experiment.repoSHA,
    repairTree: "f".repeat(40),
    patch: ref,
    evidence: ref,
    task: ref,
    rehearsal: ref,
    sources: [
      {
        url: "https://docs.example.com",
        finalUrl: "https://docs.example.com",
        retrievedAt: "2026-11-24T00:00:00Z",
        declaredVersion: "v2",
        contentSha256: ref.sha256,
        storedPath: "sources/guide.md",
        excerpt: "<img src=x onerror=alert(1)>",
        method: "manual-import",
        status: "available" as const,
        artifact: ref,
      },
    ],
    omissions: [],
    oldModel: "available",
    interpretation: "Replay only",
  };
  const report = buildReport(
    run,
    experiment,
    () => "<script>hostile patch</script>",
  );
  assert.match(report.html, /Owned replay/);
  assert.match(report.html, /B versus C/);
  assert.match(report.html, /smoke-1-B/);
  assert.match(report.html, /main-1-C/);
  assert.doesNotMatch(report.html, /<script>|<img src=x/);
  assert.match(report.html, /&lt;script&gt;/);
  assert.match(report.html, /Content-Security-Policy/);
  assert.match(report.html, /Wilson 95%/);
  assert.match(report.html, /100.0 percentage points/);
  assert.match(report.markdown, /replay/i);
  assert.match(report.html, /No live model improvement/);
  assert.match(report.html, /href="objects\/[a-f0-9]{64}\.txt"/);
});
