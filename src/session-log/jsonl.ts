import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX_SESSION_BYTES = 16 * 1024 * 1024;

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

export interface SessionWarning {
  lineNumber: number;
  reason: string;
  rawSha256: string;
  rawLength: number;
}

export interface ParsedSessionRecord {
  lineNumber: number;
  event: Record<string, unknown>;
  sha256: string;
}

export interface ParsedAgentSession {
  schemaVersion: 1;
  specification: "gh-aw-unified-agent-session-v1";
  totalLines: number;
  validRecords: ParsedSessionRecord[];
  warnings: SessionWarning[];
  rawSha256: string;
}

export interface PrivateExecutionRecord {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  stdoutSha256: string;
  stderrSha256: string;
  recordedAt: string;
}

export interface SessionPublicationGateResult {
  schemaVersion: 1;
  specification: "gh-aw-unified-agent-session-v1";
  publicationGate: "allowed" | "blocked";
  blockReasons: string[];
  session: ParsedAgentSession;
  privateRecord: PrivateExecutionRecord;
  gateSha256: string;
}

/**
 * Parses a newline-delimited JSON (JSONL) agent session log following the
 * GitHub Agentic Workflows Unified Agent Session Specification:
 * - Emits a warning for every invalid JSONL line without aborting the file.
 * - Preserves all neighboring valid JSON object records intact.
 */
export function parseAgentSessionJsonl(rawJsonl: string): ParsedAgentSession {
  const normalized = rawJsonl.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const validRecords: ParsedSessionRecord[] = [];
  const warnings: SessionWarning[] = [];
  let totalLines = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.trim().length === 0) continue;
    totalLines++;
    const lineNumber = idx + 1;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        warnings.push({
          lineNumber,
          reason: "JSONL line must decode to a JSON object record",
          rawSha256: sha256(line),
          rawLength: Buffer.byteLength(line, "utf8"),
        });
        continue;
      }
      validRecords.push({
        lineNumber,
        event: parsed as Record<string, unknown>,
        sha256: sha256(line),
      });
    } catch (error) {
      warnings.push({
        lineNumber,
        reason:
          error instanceof Error
            ? `Invalid JSONL line: ${error.message}`
            : "Invalid JSONL line",
        rawSha256: sha256(line),
        rawLength: Buffer.byteLength(line, "utf8"),
      });
    }
  }

  return {
    schemaVersion: 1,
    specification: "gh-aw-unified-agent-session-v1",
    totalLines,
    validRecords,
    warnings,
    rawSha256: sha256(rawJsonl),
  };
}

/**
 * Evaluates a normal command/session output through the publication gate.
 * Always retains raw stdout, stderr, and exitCode in `privateRecord` and
 * blocks publication whenever exitCode !== 0, invalid JSONL lines appear,
 * or zero valid records are present.
 */
export function evaluateSessionPublicationGate(input: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}): SessionPublicationGateResult {
  const session = parseAgentSessionJsonl(input.stdout);
  const blockReasons: string[] = [];

  if (input.exitCode !== 0) {
    blockReasons.push(
      `Non-zero or missing exit code (${String(input.exitCode)})`,
    );
  }
  if (session.warnings.length > 0) {
    blockReasons.push(
      `${session.warnings.length} invalid JSONL line(s) detected (lines: ${session.warnings.map((w) => w.lineNumber).join(", ")})`,
    );
  }
  if (session.validRecords.length === 0) {
    blockReasons.push("No valid JSONL session records observed");
  }

  const privateRecord: PrivateExecutionRecord = {
    stdout: input.stdout,
    stderr: input.stderr,
    exitCode: input.exitCode,
    stdoutSha256: sha256(input.stdout),
    stderrSha256: sha256(input.stderr),
    recordedAt: new Date().toISOString(),
  };

  const publicationGate: "allowed" | "blocked" =
    blockReasons.length === 0 ? "allowed" : "blocked";

  const core = {
    schemaVersion: 1 as const,
    specification: "gh-aw-unified-agent-session-v1" as const,
    publicationGate,
    blockReasons,
    session,
    privateRecord,
  };

  return {
    ...core,
    gateSha256: sha256(JSON.stringify(core)),
  };
}

export function readSessionFileSafely(filePath: string): string {
  const resolved = resolve(filePath);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Session file must be a regular non-linked file");
  }
  if (stat.size > MAX_SESSION_BYTES) {
    throw new Error(`Session file exceeds 16 MiB limit (${stat.size} bytes)`);
  }
  return readFileSync(resolved, "utf8");
}
