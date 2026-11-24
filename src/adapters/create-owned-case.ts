import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ownedFixture } from "./owned-fixture.ts";
import type { ExperimentSpec } from "../design-comparison/contracts.ts";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function createOwnedCase(folder: string): void {
  folder = resolve(folder);
  mkdirSync(folder);
  const repo = join(folder, "repository");
  mkdirSync(repo);
  const fixture = ownedFixture();
  const git = (args: string[], input?: string) =>
    execFileSync(
      "git",
      [
        "--no-replace-objects",
        "--no-lazy-fetch",
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=" + join(folder, "no-hooks"),
        ...args,
      ],
      {
        cwd: repo,
        input,
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
    ).trim();
  git(["init", "-q"]);
  writeFileSync(join(repo, "harness.ts"), fixture.baseline);
  git(["add", "--", "harness.ts"]);
  git([
    "-c",
    "user.name=Owned fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "Create owned replay fixture",
  ]);
  const repoSHA = git(["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "harness.ts"), fixture.repaired);
  const patch =
    git(["diff", "--no-ext-diff", "--no-textconv", "--", "harness.ts"]) + "\n";
  const blob = git(["hash-object", "-w", "--stdin"], fixture.repaired);
  const tree = git(["mktree"], `100644 blob ${blob}\tharness.ts\n`);
  writeFileSync(join(repo, "harness.ts"), fixture.baseline);
  mkdirSync(join(folder, "sources"));
  writeFileSync(
    join(folder, "evidence-policy.json"),
    JSON.stringify({
      allowedHosts: ["example.invalid"],
      expectedVersion: "owned-v2",
    }),
  );
  mkdirSync(join(folder, "records"));
  for (const [arm, source] of Object.entries({
    B: fixture.baseline,
    C: fixture.repaired,
  }))
    writeFileSync(
      join(folder, "records", arm + ".json"),
      JSON.stringify({
        kind: "owned synthetic replay",
        files: { "harness.ts": source },
      }),
    );
  writeFileSync(
    join(folder, "sources", "owned-contract.md"),
    fixture.documentation,
  );
  const evidence = JSON.stringify(
    {
      schemaVersion: 1,
      packetId: "owned-contract-v2",
      caseId: "owned-response-format",
      sources: [
        {
          url: "https://example.invalid/deadcodefix/owned-contract",
          finalUrl: "https://example.invalid/deadcodefix/owned-contract",
          retrievedAt: new Date().toISOString(),
          declaredVersion: "owned-v2",
          contentSha256: hash(fixture.documentation),
          storedPath: "sources/owned-contract.md",
          excerpt: fixture.documentation,
          method: "owned-fixture",
        },
      ],
      omissions: [
        "Synthetic documentation authored for this replay, not retrieved provider guidance.",
      ],
      allowanceId: null,
    },
    null,
    2,
  );
  const verifier = JSON.stringify(
    {
      schemaVersion: 1,
      kind: "owned-response-format-v1",
      description:
        "Six supervisor-owned checks. Expectations are never sent to the candidate.",
    },
    null,
    2,
  );
  const experiment: ExperimentSpec = {
    schemaVersion: 1,
    caseId: "owned-response-format",
    repository: "repository",
    repoSHA,
    taskHash: hash(fixture.task),
    evidenceHash: hash(evidence),
    verifierHash: hash(verifier),
    repairHash: hash(patch),
    primaryComparison: ["B", "C"],
    arms: [
      {
        id: "B",
        model: {
          provider: "replay",
          id: "synthetic-new",
          snapshot: "owned-v2",
        },
        repair: false,
      },
      {
        id: "C",
        model: {
          provider: "replay",
          id: "synthetic-new",
          snapshot: "owned-v2",
        },
        repair: true,
      },
    ],
    phases: { smoke: 1, pilot: 1, main: 2 },
    limits: {
      maxCallsPerAttempt: 1,
      inputTokens: 2048,
      outputTokens: 4096,
      attemptMs: 3000,
      verifierMs: 3000,
      runMs: 60000,
      artifactBytes: 2097152,
      retainedBytes: 10485760,
      totalCapMicros: 0,
      attemptCapMicros: 0,
    },
  };
  const repair = {
    baseSHA: repoSHA,
    patchSha256: hash(patch),
    expectedResultTreeHash: tree,
    allowedPaths: ["harness.ts"],
    protectedPaths: [],
    authorKind: "fixture",
  };
  for (const [name, text] of Object.entries({
    "task.md": fixture.task,
    "evidence.json": evidence,
    "verifier.json": verifier,
    "experiment.json": JSON.stringify(experiment, null, 2),
    "repair.json": JSON.stringify(repair, null, 2),
    "repair.patch": patch,
  }))
    writeFileSync(join(folder, name), text);
}
