import { isDeepStrictEqual } from "node:util";
import type { RunAttempt } from "../run-comparison/index.ts";
import type { RawReference } from "../run-comparison/store.ts";
import type { FixtureVerifier } from "./index.ts";

export function validateRecordedVerdict(
  attempt: Pick<RunAttempt, "verification" | "disposition">,
  expectations: FixtureVerifier["checks"],
  readRaw?: (ref: RawReference) => string,
): void {
  const receipt = attempt.verification;
  if (!receipt) {
    if (attempt.disposition === "pass")
      throw new Error("Success disposition lacks a verifier verdict");
    return;
  }
  if (receipt.checks.length > expectations.length)
    throw new Error("Verifier check inventory differs");
  for (const [index, check] of receipt.checks.entries()) {
    const expected = expectations[index];
    if (!expected || check.id !== expected.id)
      throw new Error("Verifier check inventory differs");
    let passed = false;
    if (check.termination === "completed") {
      try {
        passed = isDeepStrictEqual(JSON.parse(check.stdout), expected.expected);
      } catch {
        /* Invalid JSON cannot pass an exact assertion. */
      }
    }
    if (check.passed !== passed)
      throw new Error(
        "Check verdict differs from recorded output and expectation",
      );
    if (readRaw && check.observation) {
      const raw = JSON.parse(readRaw(check.observation));
      if (
        raw.checkId !== check.id ||
        raw.artifactHash !== receipt.artifactHash ||
        raw.verifierHash !== receipt.verifierHash ||
        raw.observed.stdout !== check.stdout ||
        raw.observed.stderr !== check.stderr ||
        raw.observed.status !== check.termination
      )
        throw new Error("Verifier observation differs from receipt");
    } else if (
      readRaw &&
      (receipt.status === "pass" || receipt.status === "fail")
    )
      throw new Error("Completed verification lacks raw observation");
  }
  const completed = receipt.checks.filter(
    (check) =>
      check.termination === "completed" || check.termination === "failed",
  ).length;
  if (receipt.completedChecks !== completed)
    throw new Error("Verifier completed count differs from observations");
  if (receipt.status === "pass" || receipt.status === "fail") {
    if (!expectations.length || completed !== expectations.length)
      throw new Error("Completed verifier verdict lacks all expected checks");
    const derived = receipt.checks.every((check) => check.passed)
      ? "pass"
      : "fail";
    if (receipt.status !== derived)
      throw new Error("Verifier verdict differs from check results");
  }
  const disposition = receipt.status === "blocked" ? "unknown" : receipt.status;
  if (attempt.disposition !== disposition)
    throw new Error("Attempt disposition differs from verifier verdict");
}
