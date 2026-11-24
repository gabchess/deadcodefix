import {
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { buildReport, type ReportRun } from "./index.ts";
import { RunStore, type RawReference } from "../run-comparison/store.ts";
import { summarizeMain } from "./statistics.ts";
import type { ExperimentSpec } from "../design-comparison/contracts.ts";
import type { EvidencePacket } from "../collect-evidence/index.ts";
import { isDeepStrictEqual } from "node:util";
import { validateRecordedVerdict } from "../verify-artifacts/recorded-verdict.ts";
import type { FixtureVerifier } from "../verify-artifacts/index.ts";
export function readSavedRun(folder: string) {
  const root = resolve(folder);
  for (const path of [root, join(root, "objects")]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Unsafe run directory");
  }
  const read = (name: string) => {
    const path = join(root, name),
      stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
      throw new Error("Unsafe run file or byte limit");
    const bytes = readFileSync(path);
    if (!isUtf8(bytes)) throw new Error("Saved run file must be valid UTF-8");
    return bytes.toString("utf8");
  };
  const readRaw = (ref: RawReference) => {
    if (
      !ref ||
      !/^[a-f0-9]{64}$/.test(ref.sha256) ||
      ref.path !== `objects/${ref.sha256}.txt`
    )
      throw new Error("Invalid artifact reference");
    const text = read(ref.path);
    if (createHash("sha256").update(text).digest("hex") !== ref.sha256)
      throw new Error("Artifact hash mismatch");
    return text;
  };
  const envelope = JSON.parse(read("registration.json")) as {
    schemaVersion: number;
    retainedBytes: number;
    createdAt: number;
    registration: {
      experiment: ExperimentSpec;
      repair: { expectedResultTreeHash: string };
      records: Record<string, string>;
      sourceStates: { hash: string; status: string }[];
      qualification: { checks: FixtureVerifier["checks"] };
    };
  };
  if (
    envelope.schemaVersion !== 1 ||
    !Number.isSafeInteger(envelope.retainedBytes) ||
    envelope.retainedBytes < 1
  )
    throw new Error("Invalid run registration");
  const summaryRef: RawReference = JSON.parse(read("summary.json"));
  const run: ReportRun = JSON.parse(readRaw(summaryRef));
  if (
    run.schemaVersion !== 1 ||
    run.mode !== "replay" ||
    !Array.isArray(run.attempts) ||
    !Array.isArray(run.sources) ||
    !Array.isArray(run.omissions) ||
    run.omissions.some((s) => typeof s !== "string")
  )
    throw new Error("Invalid saved run schema");
  const experiment = envelope.registration.experiment;
  const deadline = JSON.parse(read("deadline.json"));
  if (
    !Number.isSafeInteger(envelope.createdAt) ||
    envelope.createdAt < 0 ||
    deadline.startedAt !== envelope.createdAt ||
    deadline.durationMs !== experiment.limits.runMs ||
    !Number.isSafeInteger(deadline.deadline) ||
    deadline.deadline !== envelope.createdAt + experiment.limits.runMs
  )
    throw new Error("Saved deadline differs from registration");
  summarizeMain(run, experiment);
  if (
    run.repoSHA !== experiment.repoSHA ||
    run.repairTree !== envelope.registration.repair.expectedResultTreeHash ||
    run.patch.sha256 !== experiment.repairHash ||
    run.evidence.sha256 !== experiment.evidenceHash ||
    run.task.sha256 !== experiment.taskHash
  )
    throw new Error("Saved run differs from registered inputs");
  for (const ref of [run.patch, run.evidence, run.task, run.rehearsal])
    readRaw(ref);
  if (!isDeepStrictEqual(JSON.parse(read("rehearsal.json")), run.rehearsal))
    throw new Error("Rehearsal pointer differs from summary");
  const rehearsal = JSON.parse(readRaw(run.rehearsal));
  const qualified =
    rehearsal.correct?.status === "pass" && rehearsal.broken?.status === "fail";
  if (rehearsal.status !== "not_run") {
    for (const receipt of [rehearsal.correct, rehearsal.broken]) {
      if (
        !receipt ||
        !["pass", "fail", "unknown", "blocked"].includes(receipt.status)
      )
        throw new Error("Invalid saved rehearsal outcome");
      validateRecordedVerdict(
        {
          verification: receipt,
          disposition:
            receipt.status === "blocked" ? "unknown" : receipt.status,
        },
        envelope.registration.qualification.checks,
        readRaw,
      );
    }
  }
  if (
    !qualified &&
    run.attempts.some((attempt) => attempt.disposition !== "not_run")
  )
    throw new Error("Unqualified rehearsal cannot support executed slots");
  const packet: EvidencePacket = JSON.parse(
    readRaw(run.evidence).replace(/^\uFEFF/, ""),
  );
  if (
    packet.caseId !== run.caseId ||
    packet.sources.length !== run.sources.length ||
    envelope.registration.sourceStates.length !== run.sources.length
  )
    throw new Error("Source metadata differs from frozen packet");
  for (const [index, source] of run.sources.entries()) {
    const { artifact, status, ...metadata } = source;
    const registered = envelope.registration.sourceStates[index];
    if (
      !isDeepStrictEqual(metadata, packet.sources[index]) ||
      registered.hash !== source.contentSha256 ||
      registered.status !== status ||
      (status === "available" && !artifact)
    )
      throw new Error("Source metadata differs from frozen packet");
    if (source.artifact) {
      if (source.artifact.sha256 !== source.contentSha256)
        throw new Error("Source hash differs from packet");
      readRaw(source.artifact);
    }
  }
  for (const attempt of run.attempts) {
    const started = JSON.parse(read(attempt.id + ".started.json"));
    if (
      started.id !== attempt.id ||
      started.startedAt !== attempt.startedAt ||
      typeof started.startedAt !== "string" ||
      !Number.isFinite(Date.parse(started.startedAt))
    )
      throw new Error("Started marker differs from its slot");
    validateRecordedVerdict(
      attempt,
      envelope.registration.qualification.checks,
      readRaw,
    );
    for (const check of attempt.verification?.checks ?? []) {
      if (check.observation) {
        const observation = JSON.parse(readRaw(check.observation));
        if (
          observation.checkId !== check.id ||
          observation.artifactHash !== attempt.verification!.artifactHash ||
          observation.verifierHash !== attempt.verification!.verifierHash ||
          observation.observed.stdout !== check.stdout ||
          observation.observed.stderr !== check.stderr ||
          observation.observed.status !== check.termination
        )
          throw new Error("Verifier observation differs from receipt");
      } else if (
        attempt.verification?.status === "pass" ||
        attempt.verification?.status === "fail"
      )
        throw new Error("Completed verification lacks raw observation");
    }
    const ref: RawReference = JSON.parse(read(attempt.id + ".complete.json"));
    if (readRaw(ref) !== JSON.stringify(attempt))
      throw new Error("Summary differs from slot receipt");
    if (attempt.rawPath || attempt.rawHash) {
      if (
        !attempt.rawPath ||
        !attempt.rawHash ||
        attempt.rawHash !== envelope.registration.records[attempt.arm]
      )
        throw new Error("Raw response differs from registered arm");
      const raw = readRaw({ path: attempt.rawPath, sha256: attempt.rawHash });
      if (attempt.verification) {
        const artifact = JSON.parse(raw);
        const artifactHash = createHash("sha256")
          .update(
            JSON.stringify(
              Object.entries(artifact.files).sort(([a], [b]) =>
                a.localeCompare(b),
              ),
            ),
          )
          .digest("hex");
        if (attempt.verification.artifactHash !== artifactHash)
          throw new Error("Verified artifact differs from recorded response");
      }
    } else if (attempt.verification)
      throw new Error("Verification lacks its recorded response");
  }
  return {
    run,
    experiment,
    readRaw,
    root,
    cap: envelope.retainedBytes,
    registration: envelope.registration,
  };
}
export function writeReport(folder: string) {
  const initial = readSavedRun(folder);
  const writer = new RunStore(initial.root, initial.registration, initial.cap);
  try {
    const saved = readSavedRun(folder),
      report = buildReport(saved.run, saved.experiment, saved.readRaw);
    const used = (path: string): number =>
      readdirSync(path).reduce((total, name) => {
        const child = join(path, name),
          stat = lstatSync(child);
        if (stat.isSymbolicLink())
          throw new Error("Links are not allowed in report storage");
        return total + (stat.isDirectory() ? used(child) : stat.size);
      }, 0);
    for (const [name, content] of [
      ["report.html", report.html],
      ["report.md", report.markdown],
    ] as const) {
      const destination = join(saved.root, name);
      if (existsSync(destination)) {
        const stat = lstatSync(destination);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error("Unsafe report destination");
        if (readFileSync(destination).equals(Buffer.from(content))) continue;
      }
      if (used(saved.root) + Buffer.byteLength(content) > saved.cap)
        throw new Error("Report retained byte limit exceeded");
      const temporary = join(saved.root, "report-partial-" + randomUUID());
      try {
        writeFileSync(temporary, content, { flag: "wx" });
        renameSync(temporary, destination);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
    }
    return {
      status: "written",
      mode: "replay",
      html: join(saved.root, "report.html"),
      markdown: join(saved.root, "report.md"),
    };
  } finally {
    writer.close();
  }
}
