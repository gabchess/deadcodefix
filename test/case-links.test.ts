import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, renameSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { runOwnedCase } from "../src/adapters/run-owned-case.ts";
import { loadCase } from "../src/design-comparison/load-case.ts";

test("case qualification rejects linked roots and linked recording directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-case-links-"));
  try {
    const folder = join(root, "case");
    createOwnedCase(folder);
    const alias = join(root, "alias");
    symlinkSync(folder, alias, "junction");
    assert.throws(() => loadCase(alias), /link/i);
    const records = join(folder, "records");
    const outside = join(root, "records");
    assert.ok(records.startsWith(root) && outside.startsWith(root));
    renameSync(records, outside);
    symlinkSync(outside, records, "junction");
    await assert.rejects(runOwnedCase(folder, join(root, "run")), /link/i);
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-case-links-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
