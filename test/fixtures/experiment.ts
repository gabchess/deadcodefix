export function experimentFixture() {
  return {
    schemaVersion: 1,
    caseId: "owned-model-upgrade",
    repoSHA: "a".repeat(40),
    taskHash: "b".repeat(64),
    evidenceHash: "c".repeat(64),
    verifierHash: "d".repeat(64),
    repairHash: "e".repeat(64),
    primaryComparison: ["B", "C"],
    arms: [
      {
        id: "A",
        model: { provider: "replay", id: "old", snapshot: "owned-v1" },
        repair: false,
      },
      {
        id: "B",
        model: { provider: "replay", id: "new", snapshot: "owned-v2" },
        repair: false,
      },
      {
        id: "C",
        model: { provider: "replay", id: "new", snapshot: "owned-v2" },
        repair: true,
      },
    ],
    phases: { smoke: 1, pilot: 2, main: 4 },
    limits: {
      maxCallsPerAttempt: 1,
      inputTokens: 1000,
      outputTokens: 1000,
      attemptMs: 1000,
      verifierMs: 1000,
      runMs: 30000,
      artifactBytes: 1048576,
      retainedBytes: 10485760,
      totalCapMicros: 0,
      attemptCapMicros: 0,
    },
  };
}
