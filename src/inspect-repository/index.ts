import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";
import { resolve, sep } from "node:path";
import { rejectLinkedPath } from "./paths.ts";
function matchesCleanWorkingFile(blob: Buffer, current: Buffer): boolean {
  if (blob.equals(current)) return true;
  if (blob.includes(0) || blob.includes(13)) return false;
  let newlines = 0;
  for (let i = 0; i < blob.length; i++) {
    if (blob[i] === 10) newlines++;
  }
  if (newlines === 0 || current.length !== blob.length + newlines) return false;
  const crlf = Buffer.allocUnsafe(blob.length + newlines);
  let out = 0;
  for (let i = 0; i < blob.length; i++) {
    const byte = blob[i];
    if (byte === 10) crlf[out++] = 13;
    crlf[out++] = byte;
  }
  return crlf.equals(current);
}

export interface RepositorySnapshot {
  repoSHA: string;
  files: { path: string; sha256: string }[];
  candidates: { path: string; reason: string }[];
}
export function inspectRepository(input: {
  repo: string;
  ref: string;
}): RepositorySnapshot {
  if (!/^[a-f0-9]{40}$/.test(input.ref))
    throw new Error("Inspection requires a full commit ID");
  rejectLinkedPath(input.repo);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "--no-replace-objects",
        "--no-lazy-fetch",
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      { cwd: input.repo, maxBuffer: 8 * 1024 * 1024, timeout: 10000 },
    );
  const repoSHA = git("rev-parse", "--verify", input.ref + "^{commit}")
    .toString()
    .trim();
  const cleanError = () =>
    new Error(
      "Inspection requires a clean checkout with byte-identical tracked files",
    );
  if (git("rev-parse", "HEAD").toString().trim() !== repoSHA)
    throw cleanError();
  // Object/index commands avoid status, diff filters, hooks and target configuration execution.
  if (
    git("diff-index", "--cached", "--name-only", repoSHA, "--").length ||
    git("ls-files", "--others", "--exclude-standard", "-z").length
  )
    throw cleanError();
  const root = resolve(input.repo);
  const entries = git("ls-tree", "-rz", "--full-tree", repoSHA)
    .toString()
    .split("\0")
    .filter(Boolean);
  const files = entries.map((entry) => {
    const tab = entry.indexOf("\t");
    const meta = entry.slice(0, tab);
    const path = entry.slice(tab + 1);
    const [mode, kind, object] = meta.split(" ");
    if (kind !== "blob" || !["100644", "100755"].includes(mode))
      throw new Error("Only regular tracked files are supported");
    const target = resolve(root, path);
    if (!target.startsWith(root + sep))
      throw new Error("Tracked path escapes repository");
    let current: Buffer;
    try {
      let ancestor = root;
      for (const part of path.split("/")) {
        ancestor = resolve(ancestor, part);
        if (lstatSync(ancestor).isSymbolicLink()) throw cleanError();
      }
      if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink())
        throw cleanError();
      current = readFileSync(target);
    } catch {
      throw cleanError();
    }
    const blob = git("cat-file", "blob", object);
    if (!matchesCleanWorkingFile(blob, current)) throw cleanError();
    return { path, sha256: createHash("sha256").update(blob).digest("hex") };
  });
  const candidates = files
    .filter((file) => /(?:harness|prompt|model|AGENTS|CLAUDE)/i.test(file.path))
    .map((file) => ({
      path: file.path,
      reason:
        "Inspect for upgrade relevance; filename match does not establish obsolete code",
    }));
  return { repoSHA, files, candidates };
}
