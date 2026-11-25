import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";

export const MAX_SESSION_BYTES = 16 * 1024 * 1024;

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

export interface SessionWarning {
  lineNumber: number;
  reason: string;
  rawSha256: string;
  rawLength: number;
}

export interface UnifiedAgentEvent {
  type: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ParsedSessionRecord {
  lineNumber: number;
  event: UnifiedAgentEvent;
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

function isUnifiedAgentEvent(value: unknown): value is UnifiedAgentEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === "string" &&
    record.type.trim().length > 0 &&
    typeof record.data === "object" &&
    record.data !== null &&
    !Array.isArray(record.data)
  );
}

/**
 * Parses a newline-delimited JSON (JSONL) agent session log following the
 * GitHub Agentic Workflows Unified Agent Session Specification:
 * - Requires each canonical event to have a non-empty string `type` and object `data`.
 * - Emits a warning for every invalid JSONL line without aborting the file.
 * - Preserves all neighboring valid canonical event records intact.
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
      if (!isUnifiedAgentEvent(parsed)) {
        warnings.push({
          lineNumber,
          reason:
            "JSONL line does not match gh-aw unified event shape ({ type: string, data: object })",
          rawSha256: sha256(line),
          rawLength: Buffer.byteLength(line, "utf8"),
        });
        continue;
      }
      validRecords.push({
        lineNumber,
        event: parsed,
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
 * or zero valid canonical records are present.
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
      input.exitCode === null
        ? "Execution exit code is unknown (null); explicit exit code 0 required for publication"
        : `Non-zero exit code (${String(input.exitCode)})`,
    );
  }
  if (session.warnings.length > 0) {
    blockReasons.push(
      `${session.warnings.length} invalid JSONL line(s) detected (lines: ${session.warnings.map((w) => w.lineNumber).join(", ")})`,
    );
  }
  if (session.validRecords.length === 0) {
    blockReasons.push("No valid gh-aw unified JSONL session records observed");
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

/**
 * Reads a regular non-linked session file with strict bounded allocation
 * (maxBytes enforced on the open descriptor) and fatal UTF-8 validation.
 */
export function readSessionFileSafely(
  filePath: string,
  maxBytes: number = MAX_SESSION_BYTES,
): string {
  const resolved = resolve(filePath);
  const linkStat = lstatSync(resolved);
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
    throw new Error("Session file must be a regular non-linked file");
  }

  const fd = openSync(resolved, "r");
  try {
    const fdStat = fstatSync(fd);
    if (!fdStat.isFile()) {
      throw new Error("Session file descriptor is not a regular file");
    }
    if (fdStat.size > maxBytes) {
      throw new Error(
        `Session file exceeds ${maxBytes} byte limit (${fdStat.size} bytes)`,
      );
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const chunkSize = Math.min(65536, maxBytes + 1);
    const scratch = Buffer.allocUnsafe(chunkSize);

    for (;;) {
      const remainingAllowance = maxBytes + 1 - totalBytes;
      const toRead = Math.min(scratch.length, remainingAllowance);
      const bytesRead = readSync(fd, scratch, 0, toRead, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new Error(
          `Session file exceeded ${maxBytes} byte limit during read`,
        );
      }
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
    }

    const combined = Buffer.concat(chunks, totalBytes);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(combined);
    } catch {
      throw new Error("Session file contains invalid UTF-8 bytes");
    }
  } finally {
    closeSync(fd);
  }
}
