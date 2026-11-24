import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { experimentFixture } from "./experiment.ts";
export function ownedCase(folder: string) {
  const repo = join(folder, "repo");
  mkdirSync(repo);
  const git = (args: string[], input?: string) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.hooksPath=" + join(folder, "no-hooks"),
        ...args,
      ],
      { cwd: repo, input, encoding: "utf8" },
    ).trim();
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
  const tree = git(["mktree"], "100644 blob " + blob + "\tharness.ts\n");
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const task = "Adapt the response shape.";
  const evidence = JSON.stringify({
    schemaVersion: 1,
    sources: [],
    omissions: ["Owned synthetic evidence"],
  });
  const verifier = JSON.stringify({ schemaVersion: 1, kind: "owned-fixture" });
  const patch =
    "diff --git a/harness.ts b/harness.ts\n--- a/harness.ts\n+++ b/harness.ts\n@@ -1 +1 @@\n-old\n+new\n";
  const manifest = {
    baseSHA,
    patchSha256: hash(patch),
    expectedResultTreeHash: tree,
    allowedPaths: ["harness.ts"],
    protectedPaths: [],
    authorKind: "fixture",
  };
  const experiment = {
    ...experimentFixture(),
    repository: "repo",
    repoSHA: baseSHA,
    taskHash: hash(task),
    evidenceHash: hash(evidence),
    verifierHash: hash(verifier),
    repairHash: hash(patch),
  };
  for (const [name, data] of Object.entries({
    "task.md": task,
    "evidence.json": evidence,
    "verifier.json": verifier,
    "repair.patch": patch,
    "repair.json": JSON.stringify(manifest),
    "experiment.json": JSON.stringify(experiment),
  }))
    writeFileSync(join(folder, name), data);
  return { experiment, manifest };
}
