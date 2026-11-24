import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
export interface OwnedProcessResult {
  status: "completed" | "failed" | "unknown" | "blocked";
  stdout: string;
  stderr: string;
}
export function executeOwnedArtifact(input: {
  source: string;
  qualifiedHashes: ReadonlySet<string>;
  timeoutMs: number;
  maxBytes: number;
  input?: string;
}): OwnedProcessResult {
  const hash = createHash("sha256").update(input.source).digest("hex");
  if (!input.qualifiedHashes.has(hash))
    return {
      status: "blocked",
      stdout: "",
      stderr: "Artifact is outside supervisor-owned fixture qualification",
    };
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs <= 0 ||
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes <= 0
  )
    throw new Error("Finite execution limits required");
  // Only hash-qualified owned fixtures may use this defense-in-depth route.
  // Node permissions do not qualify arbitrary production code as sandboxed.
  const result = spawnSync(
    process.execPath,
    ["--permission", "--input-type=commonjs", "--eval", input.source],
    {
      encoding: "utf8",
      input: input.input ?? "",
      timeout: input.timeoutMs,
      maxBuffer: input.maxBytes,
      env: {
        SystemRoot: process.env.SystemRoot ?? "",
        PATH: "",
        NODE_NO_WARNINGS: "1",
      },
      windowsHide: true,
    },
  );
  return {
    status: result.error
      ? "unknown"
      : result.status === 0
        ? "completed"
        : "failed",
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
