import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inspectRepository } from "../src/inspect-repository/index.ts";
import { runCli } from "../src/cli/index.ts";
test("pins tracked content without running repository scripts", () => {
  const repo = mkdtempSync(join(tmpdir(), "deadcodefix-inspect-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "core.hooksPath=" + join(repo, "absent-hooks"), ...args],
      { cwd: repo, encoding: "utf8" },
    ).trim();
  try {
    git("init", "-q");
    const content = 'export const model = "replay-old";\n';
    writeFileSync(join(repo, "harness.ts"), content);
    writeFileSync(join(repo, ".gitattributes"), "*.ts filter=hostile\n");
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ scripts: { prepare: "exit 99" } }),
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "Create owned fixture",
    );
    const sha = git("rev-parse", "HEAD");
    git(
      "config",
      "filter.hostile.clean",
      "node -e \"require('node:fs').writeFileSync('executed','yes');process.stdin.pipe(process.stdout)\"",
    );
    utimesSync(join(repo, "harness.ts"), new Date(0), new Date(0));
    const result = inspectRepository({ repo, ref: sha });
    assert.equal(existsSync(join(repo, "executed")), false);
    assert.equal(result.repoSHA, sha);
    const output: string[] = [];
    assert.equal(
      runCli(["inspect", "--repo", repo, "--ref", sha], (line) =>
        output.push(line),
      ),
      0,
    );
    assert.equal(JSON.parse(output[0]).repoSHA, sha);
    assert.equal(
      result.files.find((f) => f.path === "harness.ts")?.sha256,
      createHash("sha256").update(content).digest("hex"),
    );
    assert.deepEqual(
      result.candidates.map((c) => c.path),
      ["harness.ts"],
    );
    writeFileSync(join(repo, "harness.ts"), "uncommitted change");
    assert.throws(
      () => inspectRepository({ repo, ref: sha }),
      /clean checkout/,
    );
  } finally {
    assert.ok(repo.startsWith(join(tmpdir(), "deadcodefix-inspect-")));
    rmSync(repo, { recursive: true, force: true });
  }
});

test("requires an immutable full commit ID before invoking Git", () => {
  assert.throws(
    () => inspectRepository({ repo: "does-not-exist", ref: "HEAD" }),
    /full commit ID/,
  );
});
