import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { RawReference } from "../run-comparison/store.ts";
import {
  executeOwnedArtifact,
  type OwnedProcessResult,
} from "./owned-process.ts";
export interface ArtifactSnapshot {
  files: Record<string, string>;
}
export interface FixtureVerifier {
  entry: string;
  qualifiedHashes: ReadonlySet<string>;
  checks: { id: string; input: unknown; expected: unknown }[];
  protectedHashes: Record<string, string>;
  timeoutMs: number;
  deadline?: number;
  maxBytes: number;
  persistObservation?: (value: VerifierObservation) => RawReference;
}
export interface VerifierObservation {
  checkId: string;
  artifactHash: string;
  verifierHash: string | null;
  observed: OwnedProcessResult;
}
export interface VerificationReceipt {
  status: "pass" | "fail" | "unknown" | "blocked";
  artifactHash: string;
  verifierHash: string | null;
  completedChecks: number;
  checks: {
    id: string;
    passed: boolean;
    stdout: string;
    stderr: string;
    termination: OwnedProcessResult["status"];
    observation: RawReference | null;
  }[];
  reason: string;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function fingerprintVerifier(verifier: FixtureVerifier): string {
  return hash(
    JSON.stringify({
      schemaVersion: 1,
      entry: verifier.entry,
      checks: verifier.checks,
      protectedHashes: Object.fromEntries(
        Object.entries(verifier.protectedHashes).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ),
      qualifiedHashes: [...verifier.qualifiedHashes].sort(),
    }),
  );
}
export function verifyArtifact(
  snapshot: ArtifactSnapshot,
  verifier: FixtureVerifier,
): VerificationReceipt {
  const files = { ...snapshot.files };
  const receipt: VerificationReceipt = {
    status: "unknown",
    artifactHash: hash(
      JSON.stringify(
        Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
    completedChecks: 0,
    verifierHash: null,
    checks: [],
    reason: "",
  };
  const finish = (status: VerificationReceipt["status"], reason: string) => ({
    ...receipt,
    status,
    reason,
  });
  try {
    receipt.verifierHash = fingerprintVerifier(verifier);
    if (
      verifier.checks.length === 0 ||
      new Set(verifier.checks.map((c) => c.id)).size !== verifier.checks.length
    )
      return finish("unknown", "Verifier requires nonempty unique checks");
    for (const [path, expected] of Object.entries(verifier.protectedHashes))
      if (typeof files[path] !== "string" || hash(files[path]) !== expected)
        return finish("fail", "Protected file changed: " + path);
    const source = files[verifier.entry];
    if (typeof source !== "string")
      return finish("fail", "Missing entry artifact");
    const started = Date.now();
    for (const check of verifier.checks) {
      const now = Date.now();
      const remaining = Math.min(
        verifier.timeoutMs - (now - started),
        (verifier.deadline ?? Infinity) - now,
      );
      if (remaining <= 0)
        return finish("unknown", "Verifier deadline exceeded");
      const observed = executeOwnedArtifact({
        source,
        qualifiedHashes: verifier.qualifiedHashes,
        input: JSON.stringify(check.input),
        timeoutMs: remaining,
        maxBytes: verifier.maxBytes,
      });
      const row = {
        id: check.id,
        passed: false,
        stdout: observed.stdout,
        stderr: observed.stderr,
        termination: observed.status,
        observation:
          verifier.persistObservation?.({
            checkId: check.id,
            artifactHash: receipt.artifactHash,
            verifierHash: receipt.verifierHash,
            observed,
          }) ?? null,
      };
      receipt.checks.push(row);
      if (observed.status === "blocked")
        return finish("blocked", observed.stderr);
      if (observed.status === "unknown")
        return finish("unknown", "Candidate execution interrupted");
      let passed = false;
      if (observed.status === "completed") {
        try {
          passed = isDeepStrictEqual(
            JSON.parse(observed.stdout),
            check.expected,
          );
        } catch {
          passed = false;
        }
      }
      row.passed = passed;
      receipt.completedChecks++;
    }
    return finish(
      receipt.checks.every((c) => c.passed) ? "pass" : "fail",
      "Exact supervisor assertions; candidate pass claims ignored",
    );
  } catch (error) {
    return finish(
      "unknown",
      "Verifier error: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
