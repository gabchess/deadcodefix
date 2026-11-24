import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { replayWorker } from "../src/adapters/replay-worker.ts";

test("replay preserves raw bytes before parsing and never accepts a recorded verdict", async () => {
  const raw = JSON.stringify({
    files: { "harness.cjs": "owned source" },
    status: "pass",
  });
  const rawHash = createHash("sha256").update(raw).digest("hex");
  const saved: string[] = [];
  const result = await replayWorker(
    { raw, rawHash, maxBytes: 1024 },
    (text) => {
      saved.push(text);
      return "raw/receipt.json";
    },
  );
  assert.deepEqual(saved, [raw]);
  assert.equal(result.mode, "replay");
  assert.equal(result.termination, "completed");
  assert.deepEqual(result.artifact, {
    files: { "harness.cjs": "owned source" },
  });
  assert.equal(result.rawPath, "raw/receipt.json");
  assert.equal("status" in result, false);
  const bad = "broken tool response";
  const corrupt = await replayWorker(
    {
      raw: bad,
      rawHash: createHash("sha256").update(bad).digest("hex"),
      maxBytes: 1024,
    },
    (text) => {
      saved.push(text);
      return "raw/bad.txt";
    },
  );
  assert.equal(corrupt.termination, "malformed");
  assert.equal(corrupt.artifact, null);
  assert.equal(saved[1], bad);
});
