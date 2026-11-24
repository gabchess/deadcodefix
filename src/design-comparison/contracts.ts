export type ArmId = "A" | "B" | "C";
export interface ExperimentSpec {
  schemaVersion: 1;
  caseId: string;
  repository: string;
  repoSHA: string;
  taskHash: string;
  evidenceHash: string;
  verifierHash: string;
  repairHash: string;
  primaryComparison: ["B", "C"];
  arms: {
    id: ArmId;
    model: { provider: string; id: string; snapshot: string };
    repair: boolean;
  }[];
  phases: { smoke: number; pilot: number; main: number };
  limits: {
    maxCallsPerAttempt: number;
    inputTokens: number;
    outputTokens: number;
    attemptMs: number;
    verifierMs: number;
    runMs: number;
    artifactBytes: number;
    retainedBytes: number;
    totalCapMicros: number;
    attemptCapMicros: number;
  };
}
