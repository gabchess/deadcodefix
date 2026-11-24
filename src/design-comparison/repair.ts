import { createHash } from "node:crypto";
import type { ValidationResult } from "./schema.ts";
export interface RepairManifest {
  baseSHA: string;
  patchSha256: string;
  expectedResultTreeHash: string;
  allowedPaths: string[];
  protectedPaths: string[];
  authorKind: "maintainer" | "assisted" | "fixture";
}
export function safeRepairPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_./-]+$/.test(value) &&
    !value.startsWith("/") &&
    value
      .split("/")
      .every(
        (p) =>
          p !== "" &&
          p !== "." &&
          p !== ".." &&
          p.toLowerCase() !== ".git" &&
          !p.endsWith(".") &&
          !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
      )
  );
}
export function validateRepair(
  input: unknown,
  patch: string,
): ValidationResult {
  if (typeof input !== "object" || input === null)
    return { valid: false, errors: ["repair: expected object"] };
  const x = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const field of ["baseSHA", "expectedResultTreeHash"])
    if (typeof x[field] !== "string" || !/^[a-f0-9]{40}$/.test(x[field]))
      errors.push(field + ": expected full Git object ID");
  if (x.patchSha256 !== createHash("sha256").update(patch).digest("hex"))
    errors.push("patchSha256: mismatch");
  for (const field of ["allowedPaths", "protectedPaths"])
    if (!Array.isArray(x[field]) || !x[field].every(safeRepairPath))
      errors.push(field + ": expected portable relative paths");
  if (!Array.isArray(x.allowedPaths) || x.allowedPaths.length === 0)
    errors.push("allowedPaths: empty");
  if (!["maintainer", "assisted", "fixture"].includes(String(x.authorKind)))
    errors.push("authorKind: invalid");
  if (
    patch.includes("GIT binary patch") ||
    patch.includes("Binary files ") ||
    patch.includes("120000") ||
    Buffer.byteLength(patch) > 2 * 1024 * 1024
  )
    errors.push(
      "patch: unsupported binary, symbolic link or oversized content",
    );
  const paths = patch
    .split("\n")
    .filter((line) => line.startsWith("--- ") || line.startsWith("+++ "))
    .map((line) => line.slice(4))
    .filter((path) => path !== "/dev/null")
    .map((path) => (/^[ab]\//.test(path) ? path.slice(2) : ""));
  if (paths.length === 0) errors.push("patch: no text paths");
  for (const path of paths) {
    if (!safeRepairPath(path)) errors.push("patch: unsafe path");
    if (!Array.isArray(x.allowedPaths) || !x.allowedPaths.includes(path))
      errors.push("patch: path outside allowedPaths");
    if (
      Array.isArray(x.protectedPaths) &&
      x.protectedPaths.some(
        (p) =>
          typeof p === "string" &&
          (path.toLowerCase() === p.toLowerCase() ||
            path.toLowerCase().startsWith(p.toLowerCase() + "/")),
      )
    )
      errors.push("patch: protected path");
  }
  return { valid: errors.length === 0, errors };
}
