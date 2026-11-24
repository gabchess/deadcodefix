import { loadCase } from "../design-comparison/load-case.ts";
import { inspectRepository } from "../inspect-repository/index.ts";
export function runCli(args: string[], write: (text: string) => void): number {
  const [command, ...rest] = args;
  const emit = (value: unknown) => write(JSON.stringify(value, null, 2));
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (
      !rest[i]?.startsWith("--") ||
      !rest[i + 1] ||
      rest[i + 1].startsWith("--") ||
      options.has(rest[i])
    ) {
      emit({ error: "Invalid command options" });
      return 2;
    }
    options.set(rest[i], rest[i + 1]);
  }
  const allowed =
    command === "inspect"
      ? ["--repo", "--ref"]
      : command === "plan"
        ? ["--case"]
        : null;
  if (allowed && [...options.keys()].some((key) => !allowed.includes(key))) {
    emit({ error: "Unknown option" });
    return 2;
  }
  if (options.get("--mode") === "live") {
    emit({
      status: "blocked",
      reason: "Live capability, budget and isolation are not qualified",
    });
    return 3;
  }
  if (command === "inspect") {
    const repo = options.get("--repo");
    const ref = options.get("--ref");
    if (!repo || !ref) {
      emit({ error: "--repo and --ref are required" });
      return 2;
    }
    try {
      emit(inspectRepository({ repo, ref }));
      return 0;
    } catch (error) {
      emit({ error: error instanceof Error ? error.message : String(error) });
      return 1;
    }
  }
  if (command === "plan") {
    const folder = options.get("--case");
    if (!folder) {
      emit({ error: "--case is required" });
      return 2;
    }
    try {
      const loaded = loadCase(folder);
      emit({
        status: "validated-inputs",
        caseId: loaded.experiment.caseId,
        repoSHA: loaded.experiment.repoSHA,
        repairTree: loaded.prepared.treeHash,
        qualification: "Execution requires verifier rehearsal",
      });
      return 0;
    } catch (error) {
      emit({ error: error instanceof Error ? error.message : String(error) });
      return 2;
    }
  }
  emit({ error: "Unknown command" });
  return 2;
}
