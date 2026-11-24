import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executeOwnedArtifact } from "../src/verify-artifacts/owned-process.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
test("executes a qualified owned artifact with bounded output and no verifier filesystem access", () => {
  const good = "process.stdout.write(JSON.stringify({value:42}));";
  const result = executeOwnedArtifact({
    source: good,
    qualifiedHashes: new Set([hash(good)]),
    timeoutMs: 1000,
    maxBytes: 1024,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.stdout, '{"value":42}');
  const hostile =
    'require("node:fs").readFileSync(process.env.USERPROFILE+"/secret");';
  assert.equal(
    executeOwnedArtifact({
      source: hostile,
      qualifiedHashes: new Set([hash(good)]),
      timeoutMs: 1000,
      maxBytes: 1024,
    }).status,
    "blocked",
  );
  const denied = executeOwnedArtifact({
    source: hostile,
    qualifiedHashes: new Set([hash(hostile)]),
    timeoutMs: 1000,
    maxBytes: 1024,
  });
  assert.equal(denied.status, "failed");
  assert.match(denied.stderr, /ERR_ACCESS_DENIED/);
  const hang = "while(true){}";
  assert.equal(
    executeOwnedArtifact({
      source: hang,
      qualifiedHashes: new Set([hash(hang)]),
      timeoutMs: 100,
      maxBytes: 1024,
    }).status,
    "unknown",
  );
});

test("passes only task input to the isolated owned process", () => {
  const source =
    'let input="";process.stdin.on("data",x=>input+=x);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({value:JSON.parse(input).value+1})));';
  const result = executeOwnedArtifact({
    source,
    qualifiedHashes: new Set([hash(source)]),
    timeoutMs: 1000,
    maxBytes: 1024,
    input: '{"value":41}',
  });
  assert.equal(result.stdout, '{"value":42}');
});
