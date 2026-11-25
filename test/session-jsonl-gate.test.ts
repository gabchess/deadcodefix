import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateSessionPublicationGate,
  parseAgentSessionJsonl,
  readSessionFileSafely,
} from "../src/session-log/jsonl.ts";
import { runCommands } from "../src/cli/commands.ts";

test("gh-aw JSONL parser warns on invalid line and non-canonical objects while preserving neighboring valid events", () => {
  const synthetic = [
    JSON.stringify({
      type: "session.start",
      data: { id: "sess-1", ts: "2026-11-25T10:00:00Z" },
    }),
    '{"type":"tool.output","broken": "unterminated newline',
    "{}",
    JSON.stringify({
      type: "session.end",
      data: { id: "sess-1", status: "completed" },
    }),
  ].join("\n");

  const parsed = parseAgentSessionJsonl(synthetic);
  assert.equal(parsed.specification, "gh-aw-unified-agent-session-v1");
  assert.equal(parsed.totalLines, 4);
  assert.equal(parsed.validRecords.length, 2);
  assert.equal(parsed.validRecords[0].lineNumber, 1);
  assert.equal(parsed.validRecords[0].event.type, "session.start");
  assert.equal(parsed.validRecords[1].lineNumber, 4);
  assert.equal(parsed.validRecords[1].event.type, "session.end");

  assert.equal(parsed.warnings.length, 2);
  assert.equal(parsed.warnings[0].lineNumber, 2);
  assert.match(parsed.warnings[0].reason, /Invalid JSONL line/);
  assert.equal(parsed.warnings[1].lineNumber, 3);
  assert.match(parsed.warnings[1].reason, /gh-aw unified event shape/);
  assert.match(parsed.warnings[0].rawSha256, /^[a-f0-9]{64}$/);
});

test("publication gate preserves stdout, stderr, and exitCode in private record and blocks on malformed output or non-canonical JSON", () => {
  const malformedStdout = [
    JSON.stringify({ type: "turn.start", data: { turn: 1 } }),
    "{not-valid-json",
    JSON.stringify({ type: "turn.end", data: { turn: 1 } }),
  ].join("\n");
  const stderr = "Warning: tool subprocess returned truncated JSON chunk";

  const result = evaluateSessionPublicationGate({
    stdout: malformedStdout,
    stderr,
    exitCode: 1,
  });

  assert.equal(result.publicationGate, "blocked");
  assert.ok(result.blockReasons.some((r) => /exit code/i.test(r)));
  assert.ok(result.blockReasons.some((r) => /invalid JSONL line/i.test(r)));
  assert.equal(result.session.validRecords.length, 2);
  assert.equal(result.session.warnings.length, 1);
  assert.equal(result.privateRecord.stdout, malformedStdout);
  assert.equal(result.privateRecord.stderr, stderr);
  assert.equal(result.privateRecord.exitCode, 1);
  assert.match(result.privateRecord.stdoutSha256, /^[a-f0-9]{64}$/);
  assert.match(result.privateRecord.stderrSha256, /^[a-f0-9]{64}$/);
  assert.match(result.gateSha256, /^[a-f0-9]{64}$/);

  // Bare {} without canonical { type: string, data: object } must also fail closed
  const emptyObjGate = evaluateSessionPublicationGate({
    stdout: "{}\n",
    stderr: "",
    exitCode: 0,
  });
  assert.equal(emptyObjGate.publicationGate, "blocked");
  assert.equal(emptyObjGate.session.validRecords.length, 0);
  assert.equal(emptyObjGate.session.warnings.length, 1);
});

test("readSessionFileSafely rejects invalid UTF-8 bytes and enforces bounded byte reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "deadcodefix-utf8-"));
  try {
    const badUtf8 = join(dir, "invalid-utf8.jsonl");
    writeFileSync(
      badUtf8,
      Buffer.concat([
        Buffer.from('{"type":"start","data":{"v":"'),
        Buffer.from([0xff]),
        Buffer.from('"}}\n'),
      ]),
    );
    assert.throws(() => readSessionFileSafely(badUtf8), /invalid UTF-8/i);

    const oversized = join(dir, "oversized.jsonl");
    writeFileSync(
      oversized,
      JSON.stringify({ type: "start", data: { pad: "x".repeat(256) } }) + "\n",
      "utf8",
    );
    assert.throws(() => readSessionFileSafely(oversized, 64), /byte limit/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI retro --session blocks when exit code is omitted (unknown), allows only with explicit --exit-code 0 and canonical JSONL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deadcodefix-session-"));
  try {
    const goodPath = join(dir, "clean.jsonl");
    writeFileSync(
      goodPath,
      [
        JSON.stringify({ type: "session.start", data: { id: "s1" } }),
        JSON.stringify({ type: "tool.call", data: { name: "firecrawl" } }),
        JSON.stringify({ type: "session.end", data: { status: "ok" } }),
      ].join("\n") + "\n",
      "utf8",
    );

    // Omitting --exit-code leaves exitCode=null -> must fail closed (exit 1)
    const unknownOut: string[] = [];
    const unknownExit = await runCommands(
      ["retro", "--session", goodPath],
      (t) => unknownOut.push(t),
    );
    assert.equal(unknownExit, 1);
    const unknownGate = JSON.parse(unknownOut.join("\n"));
    assert.equal(unknownGate.publicationGate, "blocked");
    assert.equal(unknownGate.privateRecord.exitCode, null);

    // Providing explicit --exit-code 0 with canonical JSONL -> allowed (exit 0)
    const allowedOut: string[] = [];
    const allowedExit = await runCommands(
      ["retro", "--session", goodPath, "--exit-code", "0"],
      (t) => allowedOut.push(t),
    );
    assert.equal(allowedExit, 0);
    const allowedGate = JSON.parse(allowedOut.join("\n"));
    assert.equal(allowedGate.publicationGate, "allowed");
    assert.equal(allowedGate.session.validRecords.length, 3);
    assert.equal(allowedGate.privateRecord.exitCode, 0);

    // Malformed line even with --exit-code 0 -> blocked (exit 1), neighboring records preserved
    const badPath = join(dir, "malformed.jsonl");
    writeFileSync(
      badPath,
      '{"type":"session.start","data":{}}\n{corrupt-line\n{"type":"session.end","data":{}}\n',
      "utf8",
    );
    const badOut: string[] = [];
    const badExit = await runCommands(
      ["retro", "--session", badPath, "--exit-code", "0"],
      (t) => badOut.push(t),
    );
    assert.equal(badExit, 1);
    const badGate = JSON.parse(badOut.join("\n"));
    assert.equal(badGate.publicationGate, "blocked");
    assert.equal(badGate.session.validRecords.length, 2);
    assert.equal(badGate.session.warnings.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
