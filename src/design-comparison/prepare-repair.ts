import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepository } from "../inspect-repository/index.ts";
import { validateRepair, safeRepairPath } from "./repair.ts";
import type { RepairManifest } from "./repair.ts";
export interface PreparedRepair {
  treeHash: string;
  files: { path: string; mode: string; content: Buffer }[];
}
export function prepareRepair(input: {
  repo: string;
  manifest: RepairManifest;
  patch: string;
}): PreparedRepair {
  const validation = validateRepair(input.manifest, input.patch);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  inspectRepository({ repo: input.repo, ref: input.manifest.baseSHA });
  const tempRoot = tmpdir();
  const temp = mkdtempSync(join(tempRoot, "deadcodefix-index-"));
  const git = (cwd: string, args: string[], stdin?: Buffer | string) =>
    execFileSync(
      "git",
      [
        "--no-replace-objects",
        "--no-lazy-fetch",
        "-c",
        "core.hooksPath=" + join(temp, "no-hooks"),
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      { cwd, input: stdin, maxBuffer: 8 * 1024 * 1024, timeout: 10000 },
    );
  const entries = (cwd: string, tree: string) =>
    git(cwd, ["ls-tree", "-rz", "--full-tree", tree])
      .toString()
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t");
        const [mode, kind, hash] = line.slice(0, tab).split(" ");
        const path = line.slice(tab + 1);
        if (
          kind !== "blob" ||
          !["100644", "100755"].includes(mode) ||
          !safeRepairPath(path)
        )
          throw new Error("Unsupported tree entry");
        return { mode, hash, path };
      });
  try {
    git(temp, ["init", "-q"]);
    const original = entries(input.repo, input.manifest.baseSHA);
    for (const file of original) {
      const bytes = git(input.repo, ["cat-file", "blob", file.hash]);
      const hash = git(temp, ["hash-object", "-w", "--stdin"], bytes)
        .toString()
        .trim();
      git(temp, [
        "update-index",
        "--add",
        "--cacheinfo",
        file.mode,
        hash,
        file.path,
      ]);
    }
    const startingTree = git(temp, ["write-tree"]).toString().trim();
    const expectedBase = git(input.repo, [
      "rev-parse",
      input.manifest.baseSHA + "^{tree}",
    ])
      .toString()
      .trim();
    if (startingTree !== expectedBase)
      throw new Error("Base snapshot mismatch");
    git(
      temp,
      ["apply", "--cached", "--check", "--whitespace=error", "-"],
      input.patch,
    );
    git(temp, ["apply", "--cached", "--whitespace=error", "-"], input.patch);
    const treeHash = git(temp, ["write-tree"]).toString().trim();
    if (treeHash !== input.manifest.expectedResultTreeHash)
      throw new Error("Repair result tree mismatch");
    const changed = git(temp, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      startingTree,
      treeHash,
    ])
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const path of changed)
      if (
        !input.manifest.allowedPaths.includes(path) ||
        input.manifest.protectedPaths.some(
          (p) =>
            path.toLowerCase() === p.toLowerCase() ||
            path.toLowerCase().startsWith(p.toLowerCase() + "/"),
        )
      )
        throw new Error("Repair changes a forbidden path");
    return {
      treeHash,
      files: entries(temp, treeHash).map((file) => ({
        path: file.path,
        mode: file.mode,
        content: git(temp, ["cat-file", "blob", file.hash]),
      })),
    };
  } finally {
    if (!temp.startsWith(join(tempRoot, "deadcodefix-index-")))
      throw new Error("Temporary path escaped expected prefix");
    rmSync(temp, { recursive: true, force: true });
  }
}
