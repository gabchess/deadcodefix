import { readFileSync, lstatSync } from "node:fs";
import { isUtf8 } from "node:buffer";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { validateExperiment } from "./schema.ts";
import type { ExperimentSpec } from "./contracts.ts";
import { validateRepair } from "./repair.ts";
import type { RepairManifest } from "./repair.ts";
import { prepareRepair } from "./prepare-repair.ts";
import { rejectLinkedPath } from "../inspect-repository/paths.ts";
export class ConfigurationError extends Error {}
export function loadCase(folder: string) {
  try {
    return loadCaseUnchecked(folder);
  } catch (error) {
    throw new ConfigurationError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}
function loadCaseUnchecked(folder: string) {
  rejectLinkedPath(folder);
  const read = (name: string) => {
    const path = join(folder, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
      throw new Error("Case file must be a bounded regular file");
    const bytes = readFileSync(path);
    if (!isUtf8(bytes)) throw new Error("Case inputs must be valid UTF-8");
    return bytes;
  };
  const parse = (bytes: Buffer): unknown =>
    JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  const raw = parse(read("experiment.json"));
  const validation = validateExperiment(raw);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  const experiment = raw as ExperimentSpec;
  if (
    typeof experiment.repository !== "string" ||
    experiment.repository.length === 0
  )
    throw new Error("repository: required path");
  const blobs = {
    task: read("task.md"),
    evidence: read("evidence.json"),
    verifier: read("verifier.json"),
    repair: read("repair.patch"),
  };
  for (const [name, bytes] of Object.entries(blobs)) {
    const field = (name + "Hash") as
      "taskHash" | "evidenceHash" | "verifierHash" | "repairHash";
    if (createHash("sha256").update(bytes).digest("hex") !== experiment[field])
      throw new Error(name + " hash mismatch");
  }
  const rawRepair = parse(read("repair.json"));
  const patch = blobs.repair.toString("utf8");
  const validRepair = validateRepair(rawRepair, patch);
  if (!validRepair.valid) throw new Error(validRepair.errors.join("; "));
  const manifest = rawRepair as RepairManifest;
  if (manifest.baseSHA !== experiment.repoSHA)
    throw new Error("Repair base differs from experiment");
  const repository = resolve(folder, experiment.repository);
  const prepared = prepareRepair({ repo: repository, manifest, patch });
  return {
    experiment,
    manifest,
    prepared,
    repository,
    task: blobs.task.toString("utf8"),
    evidence: parse(blobs.evidence),
    evidenceRaw: blobs.evidence.toString("utf8"),
    verifier: parse(blobs.verifier),
    patch,
  };
}
