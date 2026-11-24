import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  existsSync,
  renameSync,
  realpathSync,
} from "node:fs";
import { join, resolve, dirname, sep, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readSavedRun } from "./saved-run.ts";
import { buildReport } from "./index.ts";
import { inspectRepository } from "../inspect-repository/index.ts";
import { safeRepairPath } from "../design-comparison/repair.ts";
import { applicationIdentity } from "../adapters/application-identity.ts";
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
function canonicalOutput(path: string): string {
  let ancestor = path;
  let existing: string | undefined;
  for (;;) {
    try {
      if (lstatSync(ancestor).isSymbolicLink())
        throw new Error("Linked package output path");
      existing ??= ancestor;
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (!existing) throw new Error("Missing package output ancestor");
  return resolve(realpathSync(existing), relative(existing, path));
}
export function packageRun(
  runFolder: string,
  output: string,
  sourceRepo = fileURLToPath(new URL("../../", import.meta.url)),
) {
  const saved = readSavedRun(runFolder),
    destination = resolve(output);
  const normalize = (path: string) =>
    process.platform === "win32" ? path.toLowerCase() : path;
  const canonicalDestination = normalize(canonicalOutput(destination));
  const canonicalRun = normalize(realpathSync(saved.root));
  if (
    canonicalDestination === canonicalRun ||
    canonicalDestination.startsWith(canonicalRun + sep)
  )
    throw new Error("Package destination must be outside the saved run");
  const revision = execFileSync(
    "git",
    [
      "--no-replace-objects",
      "--no-lazy-fetch",
      "-C",
      sourceRepo,
      "rev-parse",
      "HEAD",
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  ).trim();
  const source = inspectRepository({ repo: sourceRepo, ref: revision });
  const registration = JSON.parse(
    readFileSync(join(saved.root, "registration.json"), "utf8"),
  );
  const identity = registration.registration?.qualification?.application;
  try {
    if (!identity || identity.sha256 !== applicationIdentity(sourceRepo).sha256)
      throw new Error("Different producer");
  } catch {
    throw new Error(
      "Package application source identity differs from the run producer",
    );
  }
  for (const file of identity.files) {
    if (
      !source.files.some(
        (tracked) =>
          tracked.path === file.path && tracked.sha256 === file.sha256,
      )
    )
      throw new Error(
        "Application source identity is not tracked at this revision",
      );
  }
  const files = new Map<string, Buffer>();
  let total = 0;
  const add = (path: string, content: Buffer | string) => {
    if (!safeRepairPath(path)) throw new Error("Unsafe package path");
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    total += bytes.length;
    if (total > 64 * 1024 * 1024)
      throw new Error("Package byte limit exceeded");
    files.set(path, bytes);
  };
  const read = (path: string) => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
      throw new Error("Unsafe package input or byte limit");
    return readFileSync(path);
  };
  for (const file of source.files) {
    const bytes = read(join(sourceRepo, file.path));
    if (hash(bytes) !== file.sha256)
      throw new Error("Source changed during packaging");
    add("source/" + file.path, bytes);
  }
  for (const name of readdirSync(join(saved.root, "objects"))) {
    if (!/^[a-f0-9]{64}\.txt$/.test(name))
      throw new Error("Unexpected object filename");
    const path = "objects/" + name;
    add("run/" + path, saved.readRaw({ path, sha256: name.slice(0, 64) }));
  }
  for (const name of [
    "registration.json",
    "deadline.json",
    "rehearsal.json",
    "summary.json",
    ...saved.run.attempts.flatMap((a) => [
      a.id + ".started.json",
      a.id + ".complete.json",
    ]),
  ])
    add("run/" + name, read(join(saved.root, name)));
  const report = buildReport(saved.run, saved.experiment, saved.readRaw);
  add("run/report.html", report.html);
  add("run/report.md", report.markdown);
  add("repair.patch", report.patch);
  add(
    "README.md",
    `# deadcodefix local review package\n\nOpen [the replay report](run/report.html) and inspect [the exact patch](repair.patch). Keep the adjacent object files with the report.\n\nUse source revision ${revision}. Verify each file against manifest.json before review. The manifest excludes its own bytes.\n\nTreat the results as owned synthetic replay. Live model improvement has not been measured.\n\nFollow [REPRODUCE.md](REPRODUCE.md) to check the source and rebuild the report. Check [SUBMISSION.md](SUBMISSION.md) before any outward action.\n`,
  );
  add(
    "REPRODUCE.md",
    `# Reproduce\n\nUse Node.js 26.12.1 and Git. Open a terminal in source/.\n\nInstall pinned dependencies:\n\n\`\`\`sh\nnpm ci\n\`\`\`\n\nRun the checks:\n\n\`\`\`sh\nnpm test\nnpm run check\n\`\`\`\n\nRebuild the saved report without executing the candidate again:\n\n\`\`\`sh\nnode src/cli/main.ts report --run ../run\n\`\`\`\n\nCompare the report files with their manifest hashes. Follow source/README.md to create a separate fresh replay case. Keep its newly generated fixture revision separate from the original saved case.\n\nSource revision: ${revision}. The source directory contains tracked files without Git history.\n`,
  );
  add(
    "DEMO.md",
    `# Demonstrate the repair\n\nOpen run/report.html. Point out the replay label before describing results.\n\nRead the baseline failure and repaired outcome in the main table. Open a raw response and its supervisor checks.\n\nInspect the frozen source version and exact patch. Show that the legacy compatibility check remains required.\n\nExplain that an absent old model prevents upgrade-regression attribution. Keep synthetic replay separate from a live model-effect claim.\n`,
  );
  add(
    "RIGHTS.md",
    `# Review provenance\n\nInspect the bundled owned fixture and synthetic source text before distribution. Preserve their provenance labels.\n\nReview source/package-lock.json and dependency notices when distributing development dependencies. No model-provider responses or scraped provider documentation are required for the bundled replay.\n\nSelect a publication license for the project source before release. This local package does not select that license or grant rights to unrelated material.\n`,
  );
  add(
    "SUBMISSION.md",
    `# Prepare external submission\n\nKeep this package local until the owner approves the destination and publication.\n\n- Confirm the named event or recipient and its current requirements.\n- Approve the repository visibility, source license and exact release revision.\n- Check every demo link without signing in.\n- Approve the outward description and any video before upload.\n- Record the final submitted values and receipt after an authorized send.\n\nStatus: local review package. No repository creation, deployment, upload or submission has been performed by this command.\n`,
  );
  const manifest = {
    schemaVersion: 1,
    mode: "replay",
    sourceRevision: revision,
    fixtureRevision: saved.run.repoSHA,
    caseId: saved.run.caseId,
    files: [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, bytes]) => ({
        path,
        sha256: hash(bytes),
        bytes: bytes.length,
      })),
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  if (existsSync(destination)) {
    const stat = lstatSync(destination);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Unsafe existing package");
    if (read(join(destination, "manifest.json")).toString() !== manifestText)
      throw new Error("Existing package differs from this revision or run");
    const allowedFiles = new Set([
      "manifest.json",
      ...manifest.files.map((file) => file.path),
    ]);
    const allowedDirectories = new Set<string>();
    for (const file of allowedFiles) {
      const parts = file.split("/");
      for (let i = 1; i < parts.length; i++)
        allowedDirectories.add(parts.slice(0, i).join("/"));
    }
    const inspectInventory = (relative: string) => {
      for (const name of readdirSync(join(destination, relative))) {
        const entry = relative ? relative + "/" + name : name;
        const entryStat = lstatSync(join(destination, entry));
        if (entryStat.isSymbolicLink()) throw new Error("Linked package path");
        if (entryStat.isDirectory() && allowedDirectories.has(entry))
          inspectInventory(entry);
        else if (!entryStat.isFile() || !allowedFiles.has(entry))
          throw new Error("Unlisted package entry: " + entry);
      }
    };
    inspectInventory("");
    for (const file of manifest.files) {
      let path = destination;
      for (const part of file.path.split("/")) {
        path = join(path, part);
        if (lstatSync(path).isSymbolicLink())
          throw new Error("Linked package path");
      }
      if (hash(read(path)) !== file.sha256)
        throw new Error("Package hash mismatch");
    }
  } else {
    mkdirSync(dirname(destination), { recursive: true });
    const staged = destination + ".partial-" + randomUUID();
    mkdirSync(staged);
    for (const [path, bytes] of files) {
      const target = join(staged, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: "wx" });
    }
    writeFileSync(join(staged, "manifest.json"), manifestText, { flag: "wx" });
    renameSync(staged, destination);
  }
  return {
    status: "prepared",
    mode: "replay",
    directory: destination,
    manifest: join(destination, "manifest.json"),
    sourceRevision: revision,
  };
}
