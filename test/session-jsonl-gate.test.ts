import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateSessionPublicationGate,
  parseAgentSessionJsonl,
} from "../src/session-log/jsonl.ts";
import { runCommands } from "../src/cli/commands.ts";

test("gh-aw JSONL parser warns on invalid line and preserves neighboring valid records", () => {
  const synthetic = [
    JSON.stringify({
      type: "session.start",
      id: "sess-1",
      ts: "2026-11-25T10:00:00Z",
    }),
    '{"type":"tool.output","broken": "unterminated newline',
    JSON.stringify({ type: "session.end", id: "sess-1", status: "completed" }),
  ].join("\n");

  const parsed = parseAgentSessionJsonl(synthetic);
  assert.equal(parsed.specification, "gh-aw-unified-agent-session-v1");
  assert.equal(parsed.totalLines, 3);
  assert.equal(parsed.validRecords.length, 2);
  assert.equal(parsed.validRecords[0].lineNumber, 1);
  assert.equal(parsed.validRecords[0].event.type, "session.start");
  assert.equal(parsed.validRecords[1].lineNumber, 3);
  assert.equal(parsed.validRecords[1].event.type, "session.end");

  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.warnings[0].lineNumber, 2);
  assert.match(parsed.warnings[0].reason, /Invalid JSONL line/);
  assert.match(parsed.warnings[0].rawSha256, /^[a-f0-9]{64}$/);
});

test("publication gate preserves stdout, stderr, and exitCode in private record and blocks on malformed output", () => {
  const malformedStdout = [
    JSON.stringify({ type: "turn.start", turn: 1 }),
    "{not-valid-json",
    JSON.stringify({ type: "turn.end", turn: 1 }),
  ].join("\n");
  const stderr = "Warning: tool subprocess returned truncated JSON chunk";

  const result = evaluateSessionPublicationGate({
    stdout: malformedStdout,
    stderr,
    exitCode: 1,
  });

  // 1. Publication gate blocks publishing
  assert.equal(result.publicationGate, "blocked");
  assert.ok(result.blockReasons.some((r) => /exit code/i.test(r)));
  assert.ok(result.blockReasons.some((r) => /invalid JSONL line/i.test(r)));

  // 2. Neighboring valid JSONL records are preserved
  assert.equal(result.session.validRecords.length, 2);
  assert.equal(result.session.warnings.length, 1);
  assert.equal(result.session.warnings[0].lineNumber, 2);

  // 3. Raw stdout, stderr, and exitCode remain intact in privateRecord
  assert.equal(result.privateRecord.stdout, malformedStdout);
  assert.equal(result.privateRecord.stderr, stderr);
  assert.equal(result.privateRecord.exitCode, 1);
  assert.match(result.privateRecord.stdoutSha256, /^[a-f0-9]{64}$/);
  assert.match(result.privateRecord.stderrSha256, /^[a-f0-9]{64}$/);
  assert.match(result.gateSha256, /^[a-f0-9]{64}$/);
});

test("CLI retro --session blocks malformed JSONL with exit 1 and allows clean JSONL with exit 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deadcodefix-session-"));
  try {
    const badPath = join(dir, "malformed.jsonl");
    writeFileSync(
      badPath,
      '{"type":"start"}\n{corrupt-line\n{"type":"end"}\n',
      "utf8",
    );
    const badOut: string[] = [];
    const badExit = await runCommands(["retro", "--session", badPath], (t) =>
      badOut.push(t),
    );
    assert.equal(badExit, 1);
    const badGate = JSON.parse(badOut.join("\n"));
    assert.equal(badGate.publicationGate, "blocked");
    assert.equal(badGate.session.validRecords.length, 2);
    assert.equal(badGate.session.warnings.length, 1);
    assert.equal(badGate.privateRecord.exitCode, 0);

    const goodPath = join(dir, "clean.jsonl");
    writeFileSync(
      goodPath,
      '{"type":"start"}\n{"type":"tool.call","name":"firecrawl"}\n{"type":"end"}\n',
      "utf8",
    );
    const goodOut: string[] = [];
    const goodExit = await runCommands(["retro", "--session", goodPath], (t) =>
      goodOut.push(t),
    );
    assert.equal(goodExit, 0);
    const goodGate = JSON.parse(goodOut.join("\n"));
    assert.equal(goodGate.publicationGate, "allowed");
    assert.equal(goodGate.session.validRecords.length, 3);
    assert.equal(goodGate.session.warnings.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
