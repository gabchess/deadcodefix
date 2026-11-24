import { isDeepStrictEqual } from "node:util";
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function validateExperiment(input: unknown): ValidationResult {
  if (!record(input) || input.schemaVersion !== 1)
    return { valid: false, errors: ["Unsupported schemaVersion: expected 1"] };
  const errors: string[] = [];
  const reject = (field: string, condition: boolean, reason: string) => {
    if (!condition) errors.push(field + ": " + reason);
  };
  reject(
    "caseId",
    typeof input.caseId === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.caseId),
    "use a bounded identifier",
  );
  reject(
    "repoSHA",
    typeof input.repoSHA === "string" && /^[a-f0-9]{40}$/.test(input.repoSHA),
    "expected full commit ID",
  );
  for (const field of [
    "taskHash",
    "evidenceHash",
    "verifierHash",
    "repairHash",
  ])
    reject(
      field,
      typeof input[field] === "string" && /^[a-f0-9]{64}$/.test(input[field]),
      "expected SHA256",
    );
  const arms = input.arms;
  if (!Array.isArray(arms) || arms.length < 2 || arms.length > 3)
    errors.push("arms: require B/C with optional A");
  else {
    const ids = new Set<unknown>();
    for (const arm of arms) {
      if (!record(arm)) {
        errors.push("arms: expected arm object");
        continue;
      }
      reject(
        "arms",
        typeof arm.id === "string" &&
          ["A", "B", "C"].includes(arm.id) &&
          !ids.has(arm.id),
        "invalid or duplicate arm ID",
      );
      ids.add(arm.id);
      reject(
        "arms",
        arm.repair === (arm.id === "C"),
        "only C applies the repair",
      );
      const model = arm.model;
      reject(
        "arms",
        record(model) &&
          ["provider", "id", "snapshot"].every(
            (k) => typeof model[k] === "string" && model[k].trim().length > 0,
          ),
        "model identity required",
      );
    }
    reject("arms", ids.has("B") && ids.has("C"), "B/C required");
    const b = arms.find((a) => record(a) && a.id === "B"),
      c = arms.find((a) => record(a) && a.id === "C");
    if (record(b) && record(c))
      reject(
        "arms",
        isDeepStrictEqual(b.model, c.model),
        "B/C must use identical model configuration",
      );
  }
  reject(
    "primaryComparison",
    Array.isArray(input.primaryComparison) &&
      input.primaryComparison.length === 2 &&
      input.primaryComparison[0] === "B" &&
      input.primaryComparison[1] === "C",
    "expected B/C",
  );
  if (!record(input.phases)) errors.push("phases: required");
  else
    for (const name of ["smoke", "pilot", "main"])
      reject(
        "phases",
        Number.isSafeInteger(input.phases[name]) &&
          Number(input.phases[name]) > 0,
        "positive integer counts required",
      );
  if (!record(input.limits)) errors.push("limits: required");
  else {
    for (const name of [
      "maxCallsPerAttempt",
      "inputTokens",
      "outputTokens",
      "attemptMs",
      "verifierMs",
      "runMs",
      "artifactBytes",
      "retainedBytes",
    ])
      reject(
        "limits",
        Number.isSafeInteger(input.limits[name]) &&
          Number(input.limits[name]) > 0,
        name + " must be a positive integer",
      );
    for (const name of ["totalCapMicros", "attemptCapMicros"])
      reject(
        "limits",
        Number.isSafeInteger(input.limits[name]) &&
          Number(input.limits[name]) >= 0,
        name + " must be nonnegative integer money",
      );
    for (const name of ["attemptMs", "verifierMs", "runMs"])
      reject(
        "limits",
        Number(input.limits[name]) <= 2147483647,
        name + " exceeds supported timer range",
      );
  }
  if (record(input.phases) && Array.isArray(arms))
    reject(
      "phases",
      ["smoke", "pilot", "main"].reduce(
        (n, k) => n + Number((input.phases as Record<string, unknown>)[k]),
        0,
      ) *
        arms.length <=
        10000,
      "prototype supports at most 10000 total slots",
    );
  return { valid: errors.length === 0, errors };
}
