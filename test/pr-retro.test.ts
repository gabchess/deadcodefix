import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrDraft,
  buildRetroReport,
  validateRepoSlug,
} from "../src/pr-retro/index.ts";
import { runCommands } from "../src/cli/commands.ts";

test("buildPrDraft generates human-gated dry-run PR with Matt Pocock /pr sections and exact SHA-256", () => {
  const draft = buildPrDraft({
    caseId: "pi-sdk-tool-upgrade",
    targetRepo: "gabchess/deadcodefix",
  });
  assert.equal(draft.mode, "dry-run");
  assert.equal(draft.evidenceMode, "replay");
  assert.equal(draft.requiresHumanApproval, true);
  assert.equal(draft.mergeDanger.door, "Two-way");
  assert.equal(draft.mergeDanger.blastRadius, "Medium");
  assert.match(draft.patchSha256, /^[a-f0-9]{64}$/);
  assert.match(draft.draftSha256, /^[a-f0-9]{64}$/);
  assert.match(draft.bodyMarkdown, /## Summary/);
  assert.match(draft.bodyMarkdown, /## Evidence \(Before → After\)/);
  assert.match(draft.bodyMarkdown, /## Merge Danger/);
  assert.match(draft.bodyMarkdown, /\*\*Door:\*\* Two-way/);
  assert.match(draft.bodyMarkdown, /\*\*Blast Radius:\*\* Medium/);
  assert.match(draft.bodyMarkdown, /## Human Gate/);
  assert.match(draft.ghCommand, /gh pr create --repo gabchess\/deadcodefix/);
});

test("buildPrDraft marks docs-only pruning as Two-way / Small blast radius", () => {
  const draft = buildPrDraft({ caseId: "matt-coding-standards-prune" });
  assert.equal(draft.mergeDanger.door, "Two-way");
  assert.equal(draft.mergeDanger.blastRadius, "Small");
});

test("validateRepoSlug rejects shell injection and traversal attempts", () => {
  assert.equal(
    validateRepoSlug("gabchess/deadcodefix"),
    "gabchess/deadcodefix",
  );
  for (const bad of [
    "gabchess/deadcodefix; rm -rf /",
    "../evil/repo",
    "just-one-segment",
    "owner/repo --flag",
  ]) {
    assert.throws(() => validateRepoSlug(bad));
  }
});

test("buildRetroReport covers all 5 Matt Pocock /retro categories with SHA-256 hash", () => {
  const retro = buildRetroReport({ caseId: "pi-sdk-tool-upgrade" });
  assert.equal(retro.mode, "replay");
  assert.equal(retro.verificationKind, "static-contract");
  assert.equal(retro.recommendations.length, 5);
  assert.deepEqual(
    retro.recommendations.map((r) => r.category),
    [
      "coding-standards",
      "agents-md-pruning",
      "automated-checks",
      "tool-economy",
      "navigation",
    ],
  );
  assert.match(retro.reportSha256, /^[a-f0-9]{64}$/);
});

test("CLI pr --dry-run and retro commands run cleanly and fail closed on invalid args", async () => {
  const prOut: string[] = [];
  const prCode = await runCommands(
    ["pr", "--case", "pi-sdk-tool-upgrade", "--dry-run"],
    (t) => prOut.push(t),
  );
  assert.equal(prCode, 0);
  const parsedPr = JSON.parse(prOut.join("\n"));
  assert.equal(parsedPr.mode, "dry-run");
  assert.equal(parsedPr.requiresHumanApproval, true);

  const retroOut: string[] = [];
  const retroCode = await runCommands(
    ["retro", "--case", "matt-coding-standards-prune"],
    (t) => retroOut.push(t),
  );
  assert.equal(retroCode, 0);
  const parsedRetro = JSON.parse(retroOut.join("\n"));
  assert.equal(parsedRetro.recommendations.length, 5);

  const badOut: string[] = [];
  assert.equal(
    await runCommands(["pr", "--case", "nonexistent"], (t) => badOut.push(t)),
    2,
  );
  assert.equal(
    await runCommands(
      ["pr", "--case", "pi-sdk-tool-upgrade", "--repo", "bad;repo"],
      () => {},
    ),
    2,
  );
});
