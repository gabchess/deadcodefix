import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  cpSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
test("CLI creates an owned case and produces a repeatable no-key replay with exact patch evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-cli-demo-"));
  const cli = (args: string[]) => {
    const r = spawnSync(
      process.execPath,
      [resolve("src/cli/main.ts"), ...args],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return JSON.parse(r.stdout);
  };
  try {
    const folder = join(root, "case"),
      run = join(root, "run");
    cli(["demo", "--out", folder]);
    const collected = cli(["evidence", "--case", folder, "--mode", "replay"]);
    assert.equal(collected.sources[0].status, "available");
    const first = cli([
      "run",
      "--case",
      folder,
      "--mode",
      "replay",
      "--out",
      run,
    ]);
    assert.equal(first.mode, "replay");
    assert.equal(
      first.sources[0].artifact.sha256,
      collected.sources[0].contentSha256,
    );
    assert.equal(
      readFileSync(join(run, first.sources[0].artifact.path), "utf8"),
      collected.sources[0].content,
    );
    const summaryReference = JSON.parse(
      readFileSync(join(run, "summary.json"), "utf8"),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(run, summaryReference.path), "utf8")),
      first,
    );
    assert.equal(first.attempts.length, 8);
    const rehearsal = JSON.parse(
      readFileSync(join(run, first.rehearsal.path), "utf8"),
    );
    assert.equal(
      JSON.parse(
        readFileSync(
          join(run, rehearsal.correct.checks[0].observation.path),
          "utf8",
        ),
      ).checkId,
      "legacy-compatibility",
    );
    const observation = first.attempts[0].verification.checks[0].observation;
    assert.equal(
      JSON.parse(readFileSync(join(run, observation.path), "utf8")).observed
        .stdout,
      first.attempts[0].verification.checks[0].stdout,
    );
    const experiment = JSON.parse(
      readFileSync(join(folder, "experiment.json"), "utf8"),
    );
    assert.equal(first.evidence.sha256, experiment.evidenceHash);
    assert.equal(
      readFileSync(join(run, first.evidence.path), "utf8"),
      readFileSync(join(folder, "evidence.json"), "utf8"),
    );
    assert.equal(
      first.attempts
        .filter((a: { arm: string }) => a.arm === "B")
        .every((a: { disposition: string }) => a.disposition === "fail"),
      true,
    );
    assert.equal(
      first.attempts
        .filter((a: { arm: string }) => a.arm === "C")
        .every((a: { disposition: string }) => a.disposition === "pass"),
      true,
    );
    assert.equal(
      readFileSync(join(run, first.patch.path), "utf8"),
      readFileSync(join(folder, "repair.patch"), "utf8"),
    );
    assert.deepEqual(
      cli(["run", "--case", folder, "--mode", "replay", "--out", run]),
      first,
    );
    const report = cli(["report", "--run", run]);
    const html = readFileSync(report.html, "utf8");
    assert.match(html, /Owned replay/);
    assert.match(html, /Old model unavailable/);
    assert.match(html, /main-2-C/);
    assert.match(html, /owned-v2/);
    assert.deepEqual(cli(["report", "--run", run]), report);
    assert.equal(readFileSync(report.html, "utf8"), html);
    const copied = join(root, "changed-application");
    cpSync(resolve("src"), join(copied, "src"), { recursive: true });
    cpSync(resolve("package.json"), join(copied, "package.json"));
    appendFileSync(
      join(copied, "src", "verify-artifacts", "index.ts"),
      "\n// Different verifier revision\n",
    );
    const changed = spawnSync(
      process.execPath,
      [
        join(copied, "src", "cli", "main.ts"),
        "run",
        "--case",
        folder,
        "--mode",
        "replay",
        "--out",
        run,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(changed.status, 1, changed.stdout + changed.stderr);
    assert.match(changed.stdout, /registration/i);
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-cli-demo-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
