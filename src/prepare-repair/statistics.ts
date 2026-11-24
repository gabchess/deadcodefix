import type { ExperimentSpec } from "../design-comparison/contracts.ts";
import { validateExperiment } from "../design-comparison/schema.ts";
import type { RunReceipt } from "../run-comparison/index.ts";
export interface ArmSummary {
  planned: number;
  pass: number;
  fail: number;
  unknown: number;
  not_run: number;
  conservativeCompletion: number;
  interval: [number, number] | null;
}
export function summarizeMain(run: RunReceipt, candidate: unknown) {
  const validation = validateExperiment(candidate);
  if (!validation.valid) throw new Error("Invalid registered experiment");
  const spec = candidate as ExperimentSpec;
  if (run.caseId !== spec.caseId)
    throw new Error("Run case differs from registration");
  const seen = new Set<string>();
  for (const attempt of run.attempts) {
    if (seen.has(attempt.id)) throw new Error("Duplicate attempt ID");
    seen.add(attempt.id);
    if (
      !["smoke", "pilot", "main"].includes(attempt.phase) ||
      !spec.arms.some((a) => a.id === attempt.arm) ||
      !Number.isSafeInteger(attempt.replicate) ||
      attempt.replicate < 1 ||
      attempt.replicate > spec.phases[attempt.phase] ||
      attempt.id !== `${attempt.phase}-${attempt.replicate}-${attempt.arm}` ||
      !["pass", "fail", "unknown", "not_run"].includes(attempt.disposition)
    )
      throw new Error("Attempt differs from registered slot");
  }
  const arms: Record<string, ArmSummary> = {};
  for (const arm of spec.arms) {
    const summary: ArmSummary = {
      planned: spec.phases.main,
      pass: 0,
      fail: 0,
      unknown: 0,
      not_run: 0,
      conservativeCompletion: 0,
      interval: null,
    };
    for (let i = 1; i <= spec.phases.main; i++) {
      const found = run.attempts.find((a) => a.id === `main-${i}-${arm.id}`);
      summary[found?.disposition ?? "not_run"]++;
    }
    summary.conservativeCompletion = summary.pass / summary.planned;
    arms[arm.id] = summary;
  }
  const complete = Object.values(arms).every(
    (a) => a.unknown === 0 && a.not_run === 0,
  );
  if (complete) {
    const z = 1.959963984540054;
    for (const a of Object.values(arms)) {
      const p = a.pass / a.planned,
        n = a.planned,
        den = 1 + (z * z) / n,
        center = (p + (z * z) / (2 * n)) / den,
        half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
      a.interval = [Math.max(0, center - half), Math.min(1, center + half)];
    }
  }
  return {
    complete,
    arms,
    difference: complete
      ? arms.C.conservativeCompletion - arms.B.conservativeCompletion
      : null,
    interpretation: complete
      ? "Descriptive replay only; no live or confirmatory effect claim."
      : "Incomplete main comparison; no effect inference.",
  };
}
