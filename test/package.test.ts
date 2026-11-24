import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  cpSync,
  unlinkSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { runOwnedCase } from "../src/adapters/run-owned-case.ts";
import { packageRun } from "../src/prepare-repair/package.ts";
test("local package preserves exact evidence and source revision without rerunning attempts", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-package-"));
  try {
    const casePath = join(root, "case"),
      runPath = join(root, "run"),
      out = join(root, "package");
    createOwnedCase(casePath);
    const result = await runOwnedCase(casePath, runPath);
    assert.throws(
      () => packageRun(runPath, out, join(casePath, "repository")),
      /application|source identity/i,
    );
    const sourceRepo = join(casePath, "repository");
    cpSync(resolve("src"), join(sourceRepo, "src"), { recursive: true });
    cpSync(resolve("package.json"), join(sourceRepo, "package.json"));
    const git = (args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "core.autocrlf=false",
          "-c",
          "user.name=Owned fixture",
          "-c",
          "user.email=fixture@example.invalid",
          ...args,
        ],
        { cwd: sourceRepo, encoding: "utf8" },
      ).trim();
    git(["add", "--", "src", "package.json"]);
    git(["commit", "-qm", "Add application source fixture"]);
    const alias = join(root, "run-alias");
    symlinkSync(
      runPath,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    try {
      assert.throws(
        () => packageRun(runPath, join(alias, "nested"), sourceRepo),
        /link|outside/i,
      );
      assert.equal(existsSync(join(runPath, "nested")), false);
    } finally {
      unlinkSync(alias);
    }
    const packaged = packageRun(runPath, out, join(casePath, "repository"));
    const manifest = JSON.parse(readFileSync(packaged.manifest, "utf8"));
    assert.equal(manifest.sourceRevision, git(["rev-parse", "HEAD"]));
    assert.equal(manifest.fixtureRevision, result.repoSHA);
    assert.equal(manifest.mode, "replay");
    assert.equal(
      readFileSync(join(out, "repair.patch"), "utf8"),
      readFileSync(join(casePath, "repair.patch"), "utf8"),
    );
    for (const file of manifest.files) {
      assert.equal(
        createHash("sha256")
          .update(readFileSync(join(out, file.path)))
          .digest("hex"),
        file.sha256,
      );
    }
    assert.match(
      readFileSync(join(out, "run", "report.html"), "utf8"),
      /Owned replay/,
    );
    assert.match(readFileSync(join(out, "REPRODUCE.md"), "utf8"), /npm ci/);
    assert.deepEqual(
      packageRun(runPath, out, join(casePath, "repository")),
      packaged,
    );
    const extra = join(out, "run", "private-note.txt");
    writeFileSync(extra, "Not part of the approved export");
    assert.throws(
      () => packageRun(runPath, out, sourceRepo),
      /Unlisted package entry/,
    );
    unlinkSync(extra);
    writeFileSync(join(out, "repair.patch"), "tampered");
    assert.throws(
      () => packageRun(runPath, out, join(casePath, "repository")),
      /hash|differs/i,
    );
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-package-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
