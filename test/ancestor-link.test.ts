import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { inspectRepository } from "../src/inspect-repository/index.ts";
test("inspection rejects an ancestor junction even when outside bytes match the pinned tree", () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-junction-")),
    repo = join(root, "repo"),
    src = join(repo, "src"),
    outside = join(root, "outside");
  try {
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "harness.ts"), "owned\n");
    const git = (args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "core.autocrlf=false",
          "-c",
          "core.hooksPath=" + join(root, "no-hooks"),
          ...args,
        ],
        { cwd: repo, encoding: "utf8" },
      ).trim();
    git(["init", "-q"]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "Owned",
    ]);
    const ref = git(["rev-parse", "HEAD"]);
    const linkedRepo = join(root, "linked-repo");
    symlinkSync(repo, linkedRepo, "junction");
    assert.throws(() => inspectRepository({ repo: linkedRepo, ref }), /link/i);
    assert.ok(src.startsWith(root) && outside.startsWith(root));
    renameSync(src, outside);
    symlinkSync(outside, src, "junction");
    assert.throws(
      () => inspectRepository({ repo, ref }),
      /clean checkout|link/i,
    );
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-junction-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
