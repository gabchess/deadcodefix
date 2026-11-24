import { createHash } from "node:crypto";
import { safeRepairPath } from "../design-comparison/repair.ts";
import type { ArtifactSnapshot } from "../verify-artifacts/index.ts";
export interface ReplayResult {
  mode: "replay";
  termination: "completed" | "malformed";
  artifact: ArtifactSnapshot | null;
  rawPath: string;
  rawHash: string;
  usage: { calls: 0; chargedMicros: 0; uncertain: false };
}
export async function replayWorker(
  input: { raw: string; rawHash: string; maxBytes: number },
  persistRaw: (raw: string) => string | Promise<string>,
): Promise<ReplayResult> {
  if (
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes <= 0 ||
    Buffer.byteLength(input.raw) > input.maxBytes
  )
    throw new Error("Replay byte limit exceeded or invalid");
  const rawHash = createHash("sha256").update(input.raw).digest("hex");
  if (rawHash !== input.rawHash) throw new Error("Replay hash mismatch");
  const rawPath = await persistRaw(input.raw);
  const result: ReplayResult = {
    mode: "replay",
    termination: "malformed",
    artifact: null,
    rawPath,
    rawHash,
    usage: { calls: 0, chargedMicros: 0, uncertain: false },
  };
  try {
    const parsed: unknown = JSON.parse(input.raw);
    if (typeof parsed !== "object" || parsed === null || !("files" in parsed))
      return result;
    const files = parsed.files;
    if (typeof files !== "object" || files === null || Array.isArray(files))
      return result;
    const entries = Object.entries(files);
    if (
      entries.length === 0 ||
      entries.some(
        ([path, content]) =>
          !safeRepairPath(path) || typeof content !== "string",
      )
    )
      return result;
    result.artifact = { files: Object.fromEntries(entries) };
    result.termination = "completed";
  } catch {
    /* Raw bytes remain available for malformed payload review. */
  }
  return result;
}
