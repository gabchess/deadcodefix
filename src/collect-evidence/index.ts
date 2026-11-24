import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { safeRepairPath } from "../design-comparison/repair.ts";
export interface EvidenceSource {
  url: string;
  finalUrl: string;
  retrievedAt: string;
  declaredVersion: string;
  contentSha256: string;
  storedPath: string;
  excerpt: string;
  method: string;
}
export interface EvidencePacket {
  schemaVersion: 1;
  packetId: string;
  caseId: string;
  sources: EvidenceSource[];
  omissions: string[];
  allowanceId: string | null;
}
export interface CollectedEvidence extends Omit<EvidencePacket, "sources"> {
  sources: (EvidenceSource & {
    content: string | null;
    status: "available" | "unknown";
  })[];
  mode: "replay";
}
export interface EvidenceRequest {
  mode: "replay" | "live";
  packet: unknown;
  allowedHosts: string[];
  expectedVersion: string;
  deadlineMs?: number;
}
function parsePacket(value: unknown): EvidencePacket {
  if (!value || typeof value !== "object")
    throw new Error("Invalid evidence packet");
  const p = value as EvidencePacket;
  if (
    p.schemaVersion !== 1 ||
    typeof p.packetId !== "string" ||
    !p.packetId ||
    typeof p.caseId !== "string" ||
    !p.caseId ||
    !Array.isArray(p.sources) ||
    p.sources.length > 5 ||
    !Array.isArray(p.omissions) ||
    p.omissions.some((s) => typeof s !== "string") ||
    (p.allowanceId !== null && typeof p.allowanceId !== "string")
  )
    throw new Error("Invalid evidence schema or page limit");
  for (const s of p.sources) {
    if (
      s &&
      typeof s === "object" &&
      ["status", "content", "artifact"].some((key) => Object.hasOwn(s, key))
    )
      throw new Error("Source metadata contains a reserved derived field");
    if (
      !s ||
      typeof s !== "object" ||
      [
        "url",
        "finalUrl",
        "retrievedAt",
        "declaredVersion",
        "contentSha256",
        "storedPath",
        "excerpt",
        "method",
      ].some((k) => typeof s[k as keyof EvidenceSource] !== "string") ||
      !safeRepairPath(s.storedPath) ||
      !s.storedPath.startsWith("sources/") ||
      !/^[a-f0-9]{64}$/.test(s.contentSha256) ||
      !Number.isFinite(Date.parse(s.retrievedAt))
    )
      throw new Error("Invalid source metadata");
  }
  return structuredClone(p);
}
function checkUrl(text: string, hosts: string[]) {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Invalid source URL");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    isIP(host.replace(/^\[|\]$/g, "")) ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    !hosts.includes(host)
  )
    throw new Error("Source URL or host is not allowed");
}
export async function collectEvidence(
  request: EvidenceRequest,
  readText: (path: string, maxBytes: number) => Promise<string>,
): Promise<CollectedEvidence> {
  if (request.mode !== "replay")
    throw new Error(
      "Live retrieval blocked: approved allowance and actual fetch-boundary DNS/redirect controls are unqualified",
    );
  const packet = parsePacket(request.packet);
  const deadlineMs = request.deadlineMs ?? 30000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30000)
    throw new Error("Invalid evidence deadline");
  if (
    !request.expectedVersion ||
    !Array.isArray(request.allowedHosts) ||
    request.allowedHosts.length === 0
  )
    throw new Error("Expected version and allowed hosts required");
  const result: CollectedEvidence = { ...packet, mode: "replay", sources: [] };
  for (const source of packet.sources) {
    checkUrl(source.url, request.allowedHosts);
    checkUrl(source.finalUrl, request.allowedHosts);
    let content: string;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      content = await Promise.race([
        readText(source.storedPath, 2 * 1024 * 1024),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Evidence read deadline exceeded")),
            deadlineMs,
          );
        }),
      ]);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        result.sources.push({ ...source, status: "unknown", content: null });
        result.omissions.push("Unavailable stored source: " + source.url);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (Buffer.byteLength(content) > 2 * 1024 * 1024)
      throw new Error("Source byte limit exceeded");
    if (
      createHash("sha256").update(content).digest("hex") !==
      source.contentSha256
    )
      throw new Error("Source content hash mismatch");
    const status =
      source.declaredVersion === request.expectedVersion
        ? "available"
        : "unknown";
    if (status === "unknown")
      result.omissions.push("Source version mismatch: " + source.url);
    result.sources.push({ ...source, content, status });
  }
  return result;
}
