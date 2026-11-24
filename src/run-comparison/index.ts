import type { ArmId, ExperimentSpec } from "../design-comparison/contracts.ts";
import { validateRecordedVerdict } from "../verify-artifacts/recorded-verdict.ts";
import { validateExperiment } from "../design-comparison/schema.ts";
import type { ReplayResult } from "../adapters/replay-worker.ts";
import {
  verifyArtifact,
  type FixtureVerifier,
  type VerificationReceipt,
} from "../verify-artifacts/index.ts";
export type Phase = "smoke" | "pilot" | "main";
export interface WorkerInput {
  id: string;
  phase: Phase;
  arm: ArmId;
  replicate: number;
  repoSHA: string;
  taskHash: string;
  evidenceHash: string;
  repairHash: string | null;
  model: ExperimentSpec["arms"][number]["model"];
  limits: ExperimentSpec["limits"];
}
export interface AttemptControl {
  signal: AbortSignal;
  deadline: number;
}
export type WorkerExecutor = (
  input: WorkerInput,
  control: AttemptControl,
) => Promise<ReplayResult>;
export interface RunAttempt {
  id: string;
  phase: Phase;
  arm: ArmId;
  replicate: number;
  startedAt: string;
  endedAt: string;
  disposition: "pass" | "fail" | "unknown" | "not_run";
  reason: string;
  rawPath: string | null;
  rawHash: string | null;
  verification: VerificationReceipt | null;
  usage?: {
    mode: "replay";
    providerCalls: 0;
    reservedMicros: 0;
    chargedMicros: 0;
    providerBill: "not-applicable";
    tokens: "not-applicable";
  };
}
export interface RunReceipt {
  schemaVersion: 1;
  mode: "replay";
  caseId: string;
  attempts: RunAttempt[];
}
export interface RunJournal {
  readRaw?(ref: import("./store.ts").RawReference): string;
  getRunDeadline?(durationMs: number): number;
  saveRaw?(text: string): import("./store.ts").RawReference;
  beginAttempt(id: string, startedAt?: string): boolean;
  readStartedAt(id: string): string;
  readAttempt(id: string): RunAttempt | null;
  completeAttempt(receipt: RunAttempt): void;
}
export async function runExperiment(
  candidate: unknown,
  execute: WorkerExecutor,
  verifier: FixtureVerifier,
  journal?: RunJournal,
  initialStopReason = "",
): Promise<RunReceipt> {
  const validation = validateExperiment(candidate);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  const spec = structuredClone(candidate) as ExperimentSpec;
  const runDeadline =
    journal?.getRunDeadline?.(spec.limits.runMs) ??
    Date.now() + spec.limits.runMs;
  let stopped = initialStopReason;
  const receipt: RunReceipt = {
    schemaVersion: 1,
    mode: "replay",
    caseId: spec.caseId,
    attempts: [],
  };
  for (const phase of ["smoke", "pilot", "main"] as const) {
    for (let replicate = 0; replicate < spec.phases[phase]; replicate++) {
      const arms = [...spec.arms].sort((a, b) => (a.id < b.id ? -1 : 1));
      if (replicate % 2 === 1) arms.reverse();
      for (const arm of arms) {
        const id = `${phase}-${replicate + 1}-${arm.id}`;
        const previous = journal?.readAttempt(id);
        if (previous) {
          validateRecordedVerdict(
            previous,
            verifier.checks,
            journal?.readRaw ? (ref) => journal.readRaw!(ref) : undefined,
          );
          if (
            previous.phase !== phase ||
            previous.arm !== arm.id ||
            previous.replicate !== replicate + 1
          )
            throw new Error("Stored slot identity differs from registration");
          receipt.attempts.push(previous);
          if (previous.disposition === "unknown")
            stopped = "Stopped after unresolved attempt " + id;
          continue;
        }
        const attempt: RunAttempt = {
          id,
          phase,
          arm: arm.id,
          replicate: replicate + 1,
          startedAt: new Date().toISOString(),
          endedAt: "",
          disposition: "unknown",
          reason: "",
          rawPath: null,
          rawHash: null,
          verification: null,
          usage: {
            mode: "replay",
            providerCalls: 0,
            reservedMicros: 0,
            chargedMicros: 0,
            providerBill: "not-applicable",
            tokens: "not-applicable",
          },
        };
        if (journal && !journal.beginAttempt(id, attempt.startedAt)) {
          attempt.startedAt = journal.readStartedAt(id);
          attempt.reason =
            "Interrupted attempt; automatic replay is prohibited";
          attempt.endedAt = new Date().toISOString();
          stopped = "Stopped after unresolved attempt " + id;
          journal.completeAttempt(attempt);
          receipt.attempts.push(attempt);
          continue;
        }
        if (stopped || Date.now() >= runDeadline) {
          attempt.disposition = "not_run";
          attempt.reason = stopped || "Run deadline exceeded";
          attempt.endedAt = attempt.startedAt;
          journal?.completeAttempt(attempt);
          receipt.attempts.push(attempt);
          continue;
        }
        const controller = new AbortController();
        const deadline = Math.min(
          runDeadline,
          Date.now() + spec.limits.attemptMs,
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const expired = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => {
                controller.abort();
                reject(new Error("Worker deadline exceeded"));
              },
              Math.max(1, deadline - Date.now()),
            );
          });
          const result = await Promise.race([
            expired,
            execute(
              {
                id,
                phase,
                arm: arm.id,
                replicate: replicate + 1,
                repoSHA: spec.repoSHA,
                taskHash: spec.taskHash,
                evidenceHash: spec.evidenceHash,
                repairHash: arm.repair ? spec.repairHash : null,
                model: { ...arm.model },
                limits: { ...spec.limits },
              },
              { signal: controller.signal, deadline },
            ),
          ]);
          clearTimeout(timer);
          attempt.rawPath = result.rawPath;
          attempt.rawHash = result.rawHash;
          if (result.termination === "malformed" || !result.artifact) {
            attempt.disposition = "fail";
            attempt.reason = "Malformed replay response";
          } else {
            const remainingRunMs = runDeadline - Date.now();
            if (remainingRunMs <= 0)
              throw new Error("Run deadline exceeded before verification");
            attempt.verification = verifyArtifact(result.artifact, {
              ...verifier,
              deadline: runDeadline,
              persistObservation: journal?.saveRaw
                ? (value) => journal.saveRaw!(JSON.stringify(value))
                : verifier.persistObservation,
              timeoutMs: Math.min(
                verifier.timeoutMs,
                spec.limits.verifierMs,
                remainingRunMs,
              ),
            });
            attempt.disposition =
              attempt.verification.status === "blocked"
                ? "unknown"
                : attempt.verification.status;
            attempt.reason = attempt.verification.reason;
          }
        } catch (error) {
          attempt.reason =
            error instanceof Error ? error.message : String(error);
        } finally {
          clearTimeout(timer);
          controller.abort();
        }
        if (attempt.disposition === "unknown")
          stopped = "Stopped after unresolved attempt " + id;
        attempt.endedAt = new Date().toISOString();
        journal?.completeAttempt(attempt);
        receipt.attempts.push(attempt);
      }
    }
  }
  return receipt;
}
