import { createHash } from "node:crypto";
import {
  HARNESS_UPGRADE_CASES,
  type HarnessUpgradeCase,
} from "../harnesses/cases.ts";

export type MergeDoor = "Two-way" | "One-way";
export type BlastRadius = "Small" | "Medium" | "Large";

export interface MergeDangerAssessment {
  door: MergeDoor;
  blastRadius: BlastRadius;
  rationale: string;
  reviewPriority: string;
}

export interface PrDraftBundle {
  schemaVersion: 1;
  mode: "dry-run";
  evidenceMode: "replay";
  verificationKind: HarnessUpgradeCase["verificationKind"];
  requiresHumanApproval: true;
  caseId: string;
  targetRepo: string;
  branchName: string;
  title: string;
  patchSha256: string;
  mergeDanger: MergeDangerAssessment;
  ghCommand: string;
  bodyMarkdown: string;
  draftSha256: string;
}

export type RetroCategory =
  | "coding-standards"
  | "agents-md-pruning"
  | "automated-checks"
  | "tool-economy"
  | "navigation";

export interface RetroRecommendation {
  category: RetroCategory;
  action:
    | "add-check"
    | "prune-rule"
    | "update-standard"
    | "optimize-tooling"
    | "add-pointer";
  title: string;
  rationale: string;
  targetFile: string;
}

export interface RetroReport {
  schemaVersion: 1;
  mode: "replay";
  verificationKind: HarnessUpgradeCase["verificationKind"];
  caseId: string;
  headline: string;
  tokensSavedPerTurn: number;
  recommendations: RetroRecommendation[];
  markdown: string;
  reportSha256: string;
}

const SAFE_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

export function getHarnessCaseById(caseId: string): HarnessUpgradeCase {
  const found = HARNESS_UPGRADE_CASES.find((c) => c.id === caseId);
  if (!found) {
    const valid = HARNESS_UPGRADE_CASES.map((c) => c.id).join(", ");
    throw new Error(`Unknown case "${caseId}". Available cases: ${valid}`);
  }
  return found;
}

export function validateRepoSlug(repo: string): string {
  const trimmed = repo.trim();
  if (!SAFE_REPO_PATTERN.test(trimmed) || trimmed.includes("..")) {
    throw new Error(
      `Invalid repository slug "${repo}". Expected "owner/repo".`,
    );
  }
  return trimmed;
}

export function assessMergeDanger(
  item: HarnessUpgradeCase,
): MergeDangerAssessment {
  const hasSecurityCheck = item.checks.some((c) => c.category === "security");
  const isDocsOnly = item.patchFilePath.endsWith(".md");

  if (isDocsOnly) {
    return {
      door: "Two-way",
      blastRadius: "Small",
      rationale:
        "Modifies review-policy markdown only; trivial to revert via git revert without runtime impact.",
      reviewPriority: "Low — fast human scan of kept architectural rules",
    };
  }

  return {
    door: "Two-way",
    blastRadius: hasSecurityCheck ? "Medium" : "Small",
    rationale: hasSecurityCheck
      ? "Updates tool schema parsing and removes legacy regex shim; easily reverted, but touches untrusted payload boundary."
      : "Scoped adapter update with preserved legacy compatibility; cleanly reversible.",
    reviewPriority: hasSecurityCheck
      ? "Medium — verify strict Zod boundary & legacy compatibility checks"
      : "Low — confirm passing automated checks",
  };
}

export function buildPrDraft(input: {
  caseId: string;
  targetRepo?: string;
}): PrDraftBundle {
  const item = getHarnessCaseById(input.caseId);
  const targetRepo = validateRepoSlug(
    input.targetRepo ?? "gabchess/deadcodefix",
  );
  const branchName = `deadcodefix/${item.id}`;
  const patchSha256 = sha256(item.repairPatch);
  const mergeDanger = assessMergeDanger(item);
  const armBPass = item.checks.filter((c) => c.armBPassed).length;
  const armCPass = item.checks.filter((c) => c.armCPassed).length;
  const total = item.checks.length;

  const title = `fix(${item.id}): upgrade harness & prune ${item.deadWorkaroundsRemoved.length} dead workaround(s)`;

  const checkRows = item.checks
    .map(
      (c) =>
        `| \`${c.id}\` | ${c.armBPassed ? "PASS" : "FAIL"} | ${c.armCPassed ? "PASS" : "FAIL"} | \`${c.observationSha256.slice(0, 12)}\` |`,
    )
    .join("\n");

  const prunedList = item.deadWorkaroundsRemoved
    .map((w) => `- Pruned: ${w}`)
    .join("\n");

  const bodyMarkdown = [
    `## Summary`,
    ``,
    "```text",
    `Firecrawl Drift (${item.firecrawlDrift.changeStatus}) ──► ${item.targetUpgrade}`,
    `  ├─ Repaired: ${item.patchFilePath} (-${item.linesDeleted} / +${item.linesAdded} lines)`,
    `  ├─ Pruned:   ${item.deadWorkaroundsRemoved.length} dead workaround(s) (-${item.tokensSavedPerTurn} tokens/turn)`,
    `  └─ Checks:   Arm B ${armBPass}/${total} ──► Arm C ${armCPass}/${total} (${item.verificationKind}, ${item.mode})`,
    "```",
    ``,
    prunedList,
    ``,
    `## Evidence (Before → After)`,
    ``,
    `- **Provenance Mode:** \`${item.mode}\` (\`${item.verificationKind}\` — static contract verification; live behavioral isolation runs separately)`,
    `- **Firecrawl Source:** ${item.firecrawlDrift.sourceUrl} (tag: \`${item.firecrawlDrift.tag}\`, \`changeStatus: ${item.firecrawlDrift.changeStatus}\`)`,
    `- **Exact Patch SHA-256:** \`${patchSha256}\``,
    `- **Before (Arm B — Unpatched Upgrade):** ${armBPass}/${total} checks passed`,
    `- **After (Arm C — Repaired & Pruned):** ${armCPass}/${total} checks passed`,
    ``,
    `| Check | Before (Arm B) | After (Arm C) | Digest |`,
    `| --- | --- | --- | --- |`,
    checkRows,
    ``,
    `## Merge Danger`,
    ``,
    `**Door:** ${mergeDanger.door}`,
    ``,
    `**Blast Radius:** ${mergeDanger.blastRadius}`,
    ``,
    `${mergeDanger.rationale}`,
    ``,
    `**Recommended Review Attention:** ${mergeDanger.reviewPriority}`,
    ``,
    `## Human Gate`,
    ``,
    `- [ ] Maintainer inspected exact \`repair.patch\` (\`${patchSha256.slice(0, 16)}...\`)`,
    `- [ ] Maintainer verified legacy compatibility check stays green`,
    `- [ ] Generated in \`--dry-run\` mode by \`deadcodefix pr\`; human approves creation & merge`,
  ].join("\n");

  const ghCommand = `gh pr create --repo ${targetRepo} --head ${branchName} --title ${JSON.stringify(title)} --body-file pr-body.md`;

  const draftCore = {
    schemaVersion: 1 as const,
    mode: "dry-run" as const,
    evidenceMode: "replay" as const,
    verificationKind: item.verificationKind,
    requiresHumanApproval: true as const,
    caseId: item.id,
    targetRepo,
    branchName,
    title,
    patchSha256,
    mergeDanger,
    ghCommand,
    bodyMarkdown,
  };

  return {
    ...draftCore,
    draftSha256: sha256(JSON.stringify(draftCore)),
  };
}

export function buildRetroReport(input: { caseId: string }): RetroReport {
  const item = getHarnessCaseById(input.caseId);

  const recommendations: RetroRecommendation[] = [
    {
      category: "coding-standards",
      action: "prune-rule",
      title: "Delete prose rules already enforced by tsc/ESLint/Prettier",
      rationale:
        "Never pay probabilistic LLM review tokens for rules a deterministic linter catches every single time.",
      targetFile: "CODING_STANDARDS.md",
    },
    {
      category: "agents-md-pruning",
      action: "prune-rule",
      title: `Remove ${item.deadWorkaroundsRemoved.length} obsolete workaround(s) (-${item.tokensSavedPerTurn} tokens/turn)`,
      rationale: `Dead workarounds (${item.deadWorkaroundsRemoved[0] ?? "legacy shims"}) silently bloat every turn and can conflict with newer model/SDK contracts.`,
      targetFile: item.patchFilePath,
    },
    {
      category: "automated-checks",
      action: "add-check",
      title: "Promote breaking-change & patch checks into CI gates",
      rationale:
        "Pair git apply --check and strict Zod schema tests with CodeRabbit review so future upgrades fail loudly instead of silently.",
      targetFile: "test/harness-cases.test.ts",
    },
    {
      category: "tool-economy",
      action: "optimize-tooling",
      title:
        "Track upstream docs with Firecrawl changeTracking + Developer Index",
      rationale: `Pin ${item.firecrawlDrift.sourceUrl} under tag "${item.firecrawlDrift.tag}" so future SDK changes trigger an automatic git-diff + JSON drift signal instead of manual hunting.`,
      targetFile: "src/firecrawl/drift.ts",
    },
    {
      category: "navigation",
      action: "add-pointer",
      title: "Keep glossary & adapter entrypoints indexed in README/GLOSSARY",
      rationale:
        "Agents lose context exploring scattered folders; pointing directly to src/firecrawl, src/llm, and src/harnesses cuts search turns.",
      targetFile: "GLOSSARY.md",
    },
  ];

  const headline = `Retro for ${item.id}: convert upgrade lessons into durable environment upgrades (-${item.tokensSavedPerTurn} tokens/turn)`;

  const markdown = [
    `# Harness Retro: ${item.title}`,
    ``,
    `> Mode: \`replay\` (\`${item.verificationKind}\`) · Philosophy: *Never leave the same review comment twice — land every lesson in the repo.*`,
    ``,
    ...recommendations.map(
      (r, idx) =>
        `### ${idx + 1}. [${r.category}] ${r.title}\n- **Action:** \`${r.action}\` → \`${r.targetFile}\`\n- **Why:** ${r.rationale}\n`,
    ),
  ].join("\n");

  const core = {
    schemaVersion: 1 as const,
    mode: "replay" as const,
    verificationKind: item.verificationKind,
    caseId: item.id,
    headline,
    tokensSavedPerTurn: item.tokensSavedPerTurn,
    recommendations,
    markdown,
  };

  return {
    ...core,
    reportSha256: sha256(JSON.stringify(core)),
  };
}
