import { runCli } from "./index.ts";
import { createOwnedCase } from "../adapters/create-owned-case.ts";
import { runOwnedCase, planOwnedCase } from "../adapters/run-owned-case.ts";
import { collectCaseEvidence } from "../collect-evidence/case.ts";
import {
  loadCase,
  ConfigurationError,
} from "../design-comparison/load-case.ts";
import { writeReport } from "../prepare-repair/saved-run.ts";
import { packageRun } from "../prepare-repair/package.ts";
import { HARNESS_UPGRADE_CASES } from "../harnesses/cases.ts";
import { buildPrDraft, buildRetroReport } from "../pr-retro/index.ts";
import {
  evaluateSessionPublicationGate,
  readSessionFileSafely,
} from "../session-log/jsonl.ts";
export async function runCommands(
  args: string[],
  write: (text: string) => void,
): Promise<number> {
  const [command, ...rest] = args;
  if (args.length === 1 && (command === "--help" || command === "help")) {
    write(`deadcodefix: Firecrawl-powered model-upgrade & dead-workaround verification
demo --out PATH
cases
pr --case CASE_ID [--dry-run] [--repo OWNER/REPO]
retro --case CASE_ID | --session PATH_TO_JSONL
drift --url HTTPS_URL [--tag TAG] [--query QUERY]
inspect --repo PATH --ref FULL_SHA
evidence --case PATH --mode replay
plan --case PATH
run --case PATH --mode replay --out PATH
report --run PATH
package --run PATH --out PATH

Replay uses recorded responses. It is not proof of live model improvement.
Read report outcomes separately from command exit codes.
0: completed operation; 1: failed qualification or check;
2: invalid configuration; 3: blocked authority or budget.
Live mode requires explicit FIRECRAWL_API_KEY and approved LLM spend caps.`);
    return 0;
  }
  if (command === "pr") {
    const options = new Map<string, string>();
    let dryRunFlag = false;
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i];
      if (token === "--dry-run") {
        if (dryRunFlag) {
          write(JSON.stringify({ error: "Duplicate --dry-run option" }));
          return 2;
        }
        dryRunFlag = true;
        continue;
      }
      if (
        (token === "--case" || token === "--repo") &&
        rest[i + 1] &&
        !rest[i + 1].startsWith("--") &&
        !options.has(token)
      ) {
        options.set(token, rest[i + 1]);
        i++;
        continue;
      }
      write(JSON.stringify({ error: `Invalid pr option: ${token}` }));
      return 2;
    }
    const caseId = options.get("--case");
    if (!caseId) {
      write(JSON.stringify({ error: "--case is required for pr" }));
      return 2;
    }
    try {
      const draft = buildPrDraft({
        caseId,
        targetRepo: options.get("--repo"),
      });
      write(JSON.stringify(draft, null, 2));
      return 0;
    } catch (error) {
      write(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return 2;
    }
  }
  if (command === "retro") {
    if (
      rest.length !== 2 ||
      (rest[0] !== "--case" && rest[0] !== "--session") ||
      !rest[1] ||
      rest[1].startsWith("--")
    ) {
      write(
        JSON.stringify({
          error: "Usage: retro --case CASE_ID | retro --session PATH_TO_JSONL",
        }),
      );
      return 2;
    }
    if (rest[0] === "--session") {
      try {
        const raw = readSessionFileSafely(rest[1]);
        const gate = evaluateSessionPublicationGate({
          stdout: raw,
          stderr: "",
          exitCode: 0,
        });
        write(JSON.stringify(gate, null, 2));
        return gate.publicationGate === "allowed" ? 0 : 1;
      } catch (error) {
        write(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return 1;
      }
    }
    try {
      write(JSON.stringify(buildRetroReport({ caseId: rest[1] }), null, 2));
      return 0;
    } catch (error) {
      write(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return 2;
    }
  }
  if (command === "cases" && rest.length === 0) {
    write(
      JSON.stringify(
        HARNESS_UPGRADE_CASES.map((c) => ({
          id: c.id,
          mode: "replay" as const,
          verificationKind: c.verificationKind,
          title: c.title,
          ecosystem: c.harnessEcosystem,
          targetUpgrade: c.targetUpgrade,
          tokensSavedPerTurn: c.tokensSavedPerTurn,
          armBPassed: c.checks.filter((ch) => ch.armBPassed).length,
          armCPassed: c.checks.filter((ch) => ch.armCPassed).length,
          totalChecks: c.checks.length,
        })),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "drift") {
    const options = new Map<string, string>();
    for (let i = 0; i < rest.length; i += 2) {
      if (
        !rest[i]?.startsWith("--") ||
        !rest[i + 1] ||
        rest[i + 1].startsWith("--") ||
        options.has(rest[i])
      ) {
        write(JSON.stringify({ error: "Invalid drift options" }));
        return 2;
      }
      options.set(rest[i], rest[i + 1]);
    }
    const url = options.get("--url");
    if (!url) {
      write(JSON.stringify({ error: "--url is required for drift" }));
      return 2;
    }
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      write(
        JSON.stringify({
          status: "blocked",
          reason:
            "FIRECRAWL_API_KEY not set. Add it to .env.local or environment.",
        }),
      );
      return 3;
    }
    try {
      const { buildLiveEvidenceBundle, createFirecrawlTransport } =
        await import("../firecrawl/drift.ts");
      const transport = createFirecrawlTransport(apiKey);
      const bundle = await buildLiveEvidenceBundle(transport, {
        caseId: options.get("--tag") ?? "live-cli-drift",
        docUrls: [url],
        developerQuery:
          options.get("--query") ?? `breaking change migration ${url}`,
        tag: options.get("--tag") ?? "deadcodefix-cli",
      });
      write(JSON.stringify(bundle, null, 2));
      return 0;
    } catch (error) {
      write(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return 1;
    }
  }
  if (
    !["demo", "run", "evidence", "report", "package", "plan"].includes(command)
  )
    return runCli(args, write);
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (
      !rest[i]?.startsWith("--") ||
      !rest[i + 1] ||
      rest[i + 1].startsWith("--") ||
      options.has(rest[i])
    ) {
      write(JSON.stringify({ error: "Invalid options" }));
      return 2;
    }
    options.set(rest[i], rest[i + 1]);
  }
  const allowed =
    command === "plan"
      ? ["--case"]
      : command === "package"
        ? ["--run", "--out"]
        : command === "report"
          ? ["--run"]
          : command === "demo"
            ? ["--out"]
            : command === "evidence"
              ? ["--case", "--mode"]
              : ["--case", "--mode", "--out"];
  if ([...options.keys()].some((k) => !allowed.includes(k))) {
    write(JSON.stringify({ error: "Unknown option" }));
    return 2;
  }
  if (command === "plan") {
    const folder = options.get("--case");
    if (!folder) {
      write(JSON.stringify({ error: "--case is required" }));
      return 2;
    }
    try {
      write(JSON.stringify(await planOwnedCase(folder), null, 2));
      return 0;
    } catch (error) {
      write(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return error instanceof ConfigurationError ? 2 : 1;
    }
  }
  if (command === "report" || command === "package") {
    if (
      !options.get("--run") ||
      (command === "package" && !options.get("--out"))
    ) {
      write(
        JSON.stringify({
          error: "--run is required; package also requires --out",
        }),
      );
      return 2;
    }
    try {
      write(
        JSON.stringify(
          command === "report"
            ? writeReport(options.get("--run")!)
            : packageRun(options.get("--run")!, options.get("--out")!),
          null,
          2,
        ),
      );
      return 0;
    } catch (error) {
      write(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return 1;
    }
  }
  if (command !== "demo" && options.get("--mode") === "live") {
    write(
      JSON.stringify({
        status: "blocked",
        reason: "Live isolation and spend are unqualified",
      }),
    );
    return 3;
  }
  const output = options.get("--out");
  if (
    (command !== "evidence" && !output) ||
    (command !== "demo" &&
      (!options.get("--case") || options.get("--mode") !== "replay"))
  ) {
    write(
      JSON.stringify({
        error:
          "Required options missing: use demo --out PATH or run --case PATH --mode replay --out PATH",
      }),
    );
    return 2;
  }
  try {
    if (command === "demo") {
      createOwnedCase(output!);
      write(
        JSON.stringify({ mode: "replay", case: output, status: "created" }),
      );
    } else if (command === "evidence") {
      const folder = options.get("--case")!;
      write(
        JSON.stringify(
          (await collectCaseEvidence(folder, loadCase(folder).evidence))
            .evidence,
          null,
          2,
        ),
      );
    } else
      write(
        JSON.stringify(
          await runOwnedCase(options.get("--case")!, output!),
          null,
          2,
        ),
      );
    return 0;
  } catch (error) {
    write(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return error instanceof ConfigurationError ? 2 : 1;
  }
}
