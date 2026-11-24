import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli/index.ts";
import { runCommands } from "../src/cli/commands.ts";

test("help explains replay outcomes and inspect rejects unknown options", async () => {
  const output: string[] = [];
  assert.equal(await runCommands(["--help"], (text) => output.push(text)), 0);
  assert.match(output.join("\n"), /0: completed operation/);
  assert.match(output.join("\n"), /not proof of live model improvement/);
  for (const command of ["inspect", "plan"]) {
    const errors: string[] = [];
    assert.equal(
      runCli([command, "--typo", "value"], (text) => errors.push(text)),
      2,
    );
    assert.match(errors.join("\n"), /Unknown option/);
  }
});
test("plan reports invalid registrations with exit 2 and never launches a worker", () => {
  const folder = mkdtempSync(join(tmpdir(), "deadcodefix-cli-"));
  const output: string[] = [];
  try {
    writeFileSync(
      join(folder, "experiment.json"),
      JSON.stringify({ schemaVersion: 99 }),
    );
    const exit = runCli(["plan", "--case", folder], (line) =>
      output.push(line),
    );
    assert.equal(exit, 2);
    assert.match(output.join("\n"), /schemaVersion/);
    assert.equal(
      runCli(["unknown"], () => {}),
      2,
    );
    assert.equal(
      runCli(["run", "--case", folder, "--mode", "live"], () => {}),
      3,
    );
  } finally {
    assert.ok(folder.startsWith(join(tmpdir(), "deadcodefix-cli-")));
    rmSync(folder, { recursive: true, force: true });
  }
});

test("CLI process returns the documented invalid-input exit code", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["src/cli/main.ts", "unknown"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Unknown command/);
});
