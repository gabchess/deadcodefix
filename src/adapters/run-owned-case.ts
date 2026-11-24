import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadCase } from "../design-comparison/load-case.ts";
import { inspectRepository } from "../inspect-repository/index.ts";
import { rejectLinkedPath } from "../inspect-repository/paths.ts";
import { ownedFixture } from "./owned-fixture.ts";
import {
  verifyArtifact,
  fingerprintVerifier,
  type FixtureVerifier,
} from "../verify-artifacts/index.ts";
import { replayWorker } from "./replay-worker.ts";
import { runExperiment } from "../run-comparison/index.ts";
import { RunStore, qualifyInitialStorage } from "../run-comparison/store.ts";
import { collectCaseEvidence } from "../collect-evidence/case.ts";
import { applicationIdentity } from "./application-identity.ts";
import { validateRecordedVerdict } from "../verify-artifacts/recorded-verdict.ts";
const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
async function prepareOwnedCase(folder: string) {
  const loaded = loadCase(folder),
    fixture = ownedFixture();
  const inspection = inspectRepository({
    repo: loaded.repository,
    ref: loaded.experiment.repoSHA,
  });
  if (
    inspection.files.length !== 1 ||
    inspection.files[0].path !== "harness.ts" ||
    inspection.files[0].sha256 !== hash(fixture.baseline) ||
    loaded.prepared.files.length !== 1 ||
    loaded.prepared.files[0].path !== "harness.ts" ||
    loaded.prepared.files[0].content.toString() !== fixture.repaired ||
    loaded.task !== fixture.task
  )
    throw new Error("Replay supports only the qualified owned fixture");
  if (
    JSON.stringify(loaded.experiment.arms.map((a) => a.id)) !==
      JSON.stringify(["B", "C"]) ||
    loaded.experiment.arms.some((a) => a.model.provider !== "replay")
  )
    throw new Error("Owned replay requires B/C replay arms");
  if (
    !loaded.verifier ||
    typeof loaded.verifier !== "object" ||
    !("kind" in loaded.verifier) ||
    !("schemaVersion" in loaded.verifier) ||
    loaded.verifier.schemaVersion !== 1 ||
    loaded.verifier.kind !== "owned-response-format-v1"
  )
    throw new Error("Unknown verifier qualification");
  const records: Record<string, Buffer> = {};
  for (const arm of loaded.experiment.arms) {
    const path = join(folder, "records", arm.id + ".json");
    rejectLinkedPath(path);
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > loaded.experiment.limits.artifactBytes
    )
      throw new Error("Invalid replay record");
    records[arm.id] = readFileSync(path);
  }
  const qualification = {
    application: applicationIdentity(),
    node: process.version,
    checks: fixture.verifier.checks,
    sourceHashes: [...fixture.verifier.qualifiedHashes],
  };
  const collected = await collectCaseEvidence(folder, loaded.evidence);
  if (collected.evidence.caseId !== loaded.experiment.caseId)
    throw new Error("Evidence case identity differs from experiment");
  const registration = {
    experiment: loaded.experiment,
    repair: loaded.manifest,
    records: Object.fromEntries(
      Object.entries(records).map(([arm, raw]) => [arm, hash(raw)]),
    ),
    qualification,
    evidencePolicyHash: hash(collected.policyRaw),
    sourceStates: collected.evidence.sources.map((s) => ({
      hash: s.contentSha256,
      status: s.status,
    })),
  };
  const frozen = new Map<string, number>();
  for (const bytes of [
    loaded.patch,
    loaded.evidenceRaw,
    loaded.task,
    ...Object.values(records),
    ...collected.evidence.sources.flatMap((source) =>
      source.content === null ? [] : [source.content],
    ),
  ])
    frozen.set(hash(bytes), Buffer.byteLength(bytes));
  const slots =
    (["smoke", "pilot", "main"] as const).reduce(
      (sum, phase) => sum + loaded.experiment.phases[phase],
      0,
    ) * loaded.experiment.arms.length;
  // Reserve JSON escaping, observations, individual receipts and their summary copies.
  // Include both rehearsal artifacts and fixed record metadata for the owned verifier.
  const receiptReserve =
    (slots + 2) *
    (fixture.verifier.checks.length *
      (6 * fixture.verifier.maxBytes + 2048) *
      3 +
      8192);
  const metadataBytes = Buffer.byteLength(
    JSON.stringify({
      ...collected.evidence,
      caseId: loaded.experiment.caseId,
      patch: loaded.patch,
      sources: collected.evidence.sources.map((source) => ({
        ...source,
        content: null,
      })),
    }),
  );
  // HTML expands a byte by at most six; Markdown escaping needs at most seven.
  // Reserve both outputs plus fixed layout and bounded verifier output text.
  const reportReserve =
    14 * metadataBytes +
    65536 +
    slots *
      (fixture.verifier.checks.length *
        (12 * fixture.verifier.maxBytes + 2048) +
        8192);
  if (receiptReserve + 2 * metadataBytes > 16 * 1024 * 1024)
    throw new Error("Run receipt exceeds bounded readback capacity");
  qualifyInitialStorage(
    registration,
    loaded.experiment.limits.retainedBytes,
    loaded.experiment.limits.runMs,
    [...frozen.values()].reduce((sum, bytes) => sum + bytes, 0) +
      2 * metadataBytes +
      receiptReserve +
      reportReserve,
  );
  return { loaded, fixture, records, collected, registration };
}
function matchesOwnedRecording(
  arm: string,
  bytes: Buffer,
  fixture: ReturnType<typeof ownedFixture>,
) {
  return bytes.equals(
    Buffer.from(
      JSON.stringify({
        kind: "owned synthetic replay",
        files: {
          "harness.ts": arm === "B" ? fixture.baseline : fixture.repaired,
        },
      }),
    ),
  );
}
export async function planOwnedCase(folder: string) {
  const { loaded, fixture, records } = await prepareOwnedCase(folder);
  for (const [arm, bytes] of Object.entries(records))
    if (!matchesOwnedRecording(arm, bytes, fixture))
      throw new Error("Replay record does not match its qualified arm");
  return {
    status: "qualified-replay-inputs",
    caseId: loaded.experiment.caseId,
    repoSHA: loaded.experiment.repoSHA,
    repairTree: loaded.prepared.treeHash,
    qualification:
      "Input checks passed; execution still requires verifier rehearsal",
  };
}
export async function runOwnedCase(folder: string, output: string) {
  const { loaded, fixture, records, collected, registration } =
    await prepareOwnedCase(folder);
  const store = new RunStore(
    output,
    registration,
    loaded.experiment.limits.retainedBytes,
  );
  try {
    for (const [arm, bytes] of Object.entries(records)) {
      if (!matchesOwnedRecording(arm, bytes, fixture)) {
        const retained = store.saveRaw(
          JSON.stringify({
            kind: "rejected-replay-input",
            arm,
            encoding: "base64",
            sha256: hash(bytes),
            bytes: bytes.toString("base64"),
          }),
        );
        throw new Error(
          "Replay record does not match its qualified arm; original bytes retained at " +
            retained.path,
        );
      }
    }
    const runDeadline = store.getRunDeadline(loaded.experiment.limits.runMs);
    const durableVerifier: FixtureVerifier = {
      ...fixture.verifier,
      persistObservation: (value) => store.saveRaw(JSON.stringify(value)),
    };
    let rehearsalRef = store.readRehearsal();
    const rehearse = (source: string) => {
      const remaining = Math.min(
        loaded.experiment.limits.verifierMs,
        runDeadline - Date.now(),
      );
      return verifyArtifact(
        { files: { "harness.ts": source } },
        {
          ...durableVerifier,
          timeoutMs: Math.max(1, remaining),
          deadline: runDeadline,
        },
      );
    };
    const rehearsal = rehearsalRef
      ? JSON.parse(store.readRaw(rehearsalRef))
      : Date.now() >= runDeadline
        ? {
            status: "not_run",
            reason: "Original run deadline expired before verifier rehearsal",
          }
        : {
            correct: rehearse(fixture.repaired),
            broken: rehearse(fixture.baseline),
          };
    const skippedRehearsal = rehearsal.status === "not_run";
    if (skippedRehearsal && Date.now() < runDeadline)
      throw new Error("Skipped rehearsal requires an expired run deadline");
    const qualifiedRehearsal =
      !skippedRehearsal &&
      rehearsal.correct.status === "pass" &&
      rehearsal.broken.status === "fail";
    for (const receipt of skippedRehearsal
      ? []
      : [rehearsal.correct, rehearsal.broken]) {
      if (
        receipt.verifierHash !== fingerprintVerifier(durableVerifier) ||
        !["pass", "fail", "unknown", "blocked"].includes(receipt.status)
      )
        throw new Error("Invalid saved verifier rehearsal");
      validateRecordedVerdict(
        {
          verification: receipt,
          disposition:
            receipt.status === "blocked" ? "unknown" : receipt.status,
        },
        durableVerifier.checks,
        (ref) => store.readRaw(ref),
      );
    }
    rehearsalRef ??= store.publishRehearsal(rehearsal);
    const patch = store.saveRaw(loaded.patch);
    const evidence = store.saveRaw(loaded.evidenceRaw);
    const task = store.saveRaw(loaded.task);
    const sources = collected.evidence.sources.map(
      ({ content, ...source }) => ({
        ...source,
        artifact: content === null ? null : store.saveRaw(content),
      }),
    );
    const run = await runExperiment(
      loaded.experiment,
      async (input, control) => {
        if (!qualifiedRehearsal)
          throw new Error("Verifier rehearsal unavailable");
        if (control.signal.aborted) throw new Error("Attempt cancelled");
        const raw = records[input.arm].toString("utf8");
        return replayWorker(
          { raw, rawHash: hash(raw), maxBytes: input.limits.artifactBytes },
          (text) => store.saveRaw(text).path,
        );
      },
      fixture.verifier,
      store,
      qualifiedRehearsal
        ? ""
        : "Verifier rehearsal did not qualify; no candidate attempts executed",
    );
    const summary = {
      ...run,
      repoSHA: loaded.experiment.repoSHA,
      repairTree: loaded.prepared.treeHash,
      patch,
      evidence,
      task,
      sources,
      omissions: [
        ...collected.evidence.omissions,
        ...(skippedRehearsal
          ? ["Verifier rehearsal not run: original run deadline expired."]
          : []),
      ],
      rehearsal: rehearsalRef,
      oldModel: "unavailable",
      interpretation:
        "Owned synthetic replay only. No live model effect was measured.",
    };
    store.publishSummary(summary);
    return summary;
  } finally {
    store.close();
  }
}
