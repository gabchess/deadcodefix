import { lstatSync, readFileSync } from "node:fs";
import { isUtf8 } from "node:buffer";
import { join, resolve } from "node:path";
import { collectEvidence } from "./index.ts";
import { rejectLinkedPath } from "../inspect-repository/paths.ts";
export async function collectCaseEvidence(folder: string, packet: unknown) {
  const root = resolve(folder);
  rejectLinkedPath(root);
  const read = (relative: string, maxBytes: number) => {
    const parts = relative.split("/");
    if (
      parts.some(
        (p) =>
          !p || p === "." || p === ".." || p.includes("\\") || p.includes(":"),
      )
    )
      throw new Error("Unsafe evidence path");
    let path = root;
    for (const part of parts) {
      path = join(path, part);
      if (lstatSync(path).isSymbolicLink())
        throw new Error("Evidence links are not permitted");
    }
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error("Evidence file exceeds byte limit or is not regular");
    const bytes = readFileSync(path);
    if (!isUtf8(bytes)) throw new Error("Evidence must be valid UTF-8");
    return bytes.toString("utf8");
  };
  const policyRaw = read("evidence-policy.json", 8192);
  const policy = JSON.parse(policyRaw) as {
    allowedHosts: string[];
    expectedVersion: string;
  };
  if (
    !Array.isArray(policy.allowedHosts) ||
    policy.allowedHosts.length > 5 ||
    policy.allowedHosts.some(
      (h) => typeof h !== "string" || h !== h.toLowerCase(),
    ) ||
    typeof policy.expectedVersion !== "string"
  )
    throw new Error("Invalid evidence policy");
  const evidence = await collectEvidence(
    {
      mode: "replay",
      packet,
      allowedHosts: policy.allowedHosts,
      expectedVersion: policy.expectedVersion,
    },
    async (path, max) => read(path, max),
  );
  return { evidence, policyRaw };
}
