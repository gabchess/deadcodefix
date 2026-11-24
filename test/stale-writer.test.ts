import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { RunStore } from "../src/run-comparison/store.ts";
test("a stopped writer can be resumed while a living writer retains exclusive access", () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-stale-"));
  try {
    const folder = join(root, "run");
    const script = `import {RunStore} from ${JSON.stringify(pathToFileURL(resolve("src/run-comparison/store.ts")).href)};const store=new RunStore(${JSON.stringify(folder)},{task:"frozen"},8192);store.beginAttempt("main-1-B");`;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.equal(child.status, 0, child.stderr);
    const locks = join(folder, "writers");
    for (const name of readdirSync(locks)) writeFileSync(join(locks, name), "");
    const resumed = new RunStore(folder, { task: "frozen" }, 8192);
    assert.equal(resumed.beginAttempt("main-1-B"), false);
    for (const name of readdirSync(locks)) writeFileSync(join(locks, name), "");
    assert.throws(
      () => new RunStore(folder, { task: "frozen" }, 8192),
      /Another writer is active/i,
    );
    resumed.close();
    const reopened = new RunStore(folder, { task: "frozen" }, 8192);
    reopened.close();
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-stale-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
