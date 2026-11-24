import test from "node:test";
import assert from "node:assert/strict";
import { runCommands } from "../src/cli/commands.ts";
test("run distinguishes invalid case configuration from completed scientific outcomes", async () => {
  const code = await runCommands(
    [
      "run",
      "--case",
      "absent-case-fixture",
      "--mode",
      "replay",
      "--out",
      "unused-output-fixture",
    ],
    () => {},
  );
  assert.equal(code, 2);
});

test("package command validates its saved run before preparing local files", async () => {
  assert.equal(
    await runCommands(
      [
        "package",
        "--run",
        "absent-run-fixture",
        "--out",
        "unused-package-fixture",
      ],
      () => {},
    ),
    1,
  );
});
