# Spec 0002: Human-Gated PR Drafts (`deadcodefix pr`) & Harness Retrospectives (`deadcodefix retro`)

Status: Approved for implementation (`T08`). Inspired by Matt Pocock's Software Factories (`/pr` + `/retro` + `Pruning CODING_STANDARDS.md`) and Dex Horthy's `show-me` visual PR discipline.

## 1. Problem

Detecting SDK drift and verifying a `repair.patch` is only half the maintenance loop:

1. Agents still write bloated, hard-to-review PR descriptions that hide **before/after evidence** and **merge danger**.
2. Once a repair lands, teams forget to feed the lessons back into their **agent environment** (`CODING_STANDARDS.md`, `AGENTS.md`, deterministic CI checks, and tool economy) — so agents repeat the same mistakes silently on future runs.

## 2. Requirements

### 2.1 Human-Gated `deadcodefix pr`

- Command: `deadcodefix pr --case <caseId> [--dry-run] [--repo owner/name]`
- **Dry-run by default:** Never creates a remote branch, pushes, or opens/merges a PR automatically. Always outputs a deterministic, inspectable `PrDraftBundle` (`mode: "dry-run"`, `requiresHumanApproval: true`, `title`, `branchName`, `bodyMarkdown`, `mergeDanger`, `ghCommand`, `draftSha256`).
- **Required PR body sections (Matt Pocock `/pr` contract):**
  1. `## Summary` — visual ASCII flow / concise diff-sketch (zero preamble).
  2. `## Evidence (Before -> After)` — explicit Arm B failing checks vs. Arm C passing checks, Firecrawl drift source + `changeStatus`, exact `repair.patch` SHA-256, and honest `verificationKind` / `mode` labeling.
  3. `## Merge Danger` — explicit **Door** (`Two-way` | `One-way`), **Blast Radius** (`Small` | `Medium` | `Large`), rationale, and recommended human review level.
  4. `## Human Gate` — explicit checklist confirming owner review before pushing or merging.
- **Validation & Safety:** Rejects unknown case IDs (exit `2`), validates optional `--repo` strictly against `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`, and sanitizes branch names (no shell injection).

### 2.2 Harness Retrospective `deadcodefix retro`

- Command: `deadcodefix retro --case <caseId>`
- Produces a structured `RetroReport` grounded in the case's drift signals, removed dead workarounds, and verifier results across **Matt Pocock's 5 Retro Categories**:
  1. `coding-standards` (rules to add or prune in `CODING_STANDARDS.md`)
  2. `agents-md-pruning` (prompt sediment removed from `AGENTS.md` / system prompts)
  3. `automated-checks` (deterministic `tsc`/`eslint`/`git apply --check`/Zod checks replacing prose rules)
  4. `tool-economy` (Firecrawl `changeTracking`, Developer Index `skills="only"`, payload token savings)
  5. `navigation` (exact file pointers so future agents locate adapters & tests in one hop)
- Outputs both structured JSON (`RetroReport` with `reportSha256`, `mode: "replay"`) and copy-paste Markdown.

### 2.3 Portable Agent Skills & Web Studio Surface

- Ship `.agents/skills/deadcodefix-pr/SKILL.md` and `.agents/skills/deadcodefix-retro/SKILL.md` inside the repository.
- Add **Tab 5 (`5. PR & Retro Generator`)** to the hosted Next.js Web Studio (`https://deadcodefix.vercel.app`) so judges can inspect the exact `/pr` draft (with `Merge Danger` Door + Blast Radius + one-click Copy Markdown) and `/retro` environment upgrades for every case without installing anything.

## 3. Acceptance Criteria (TDD)

- `buildPrDraft()` produces valid Markdown containing `## Summary`, `## Evidence`, `## Merge Danger` (`Door` + `Blast Radius`), `## Human Gate`, exact 64-char `patchSha256` and `draftSha256`, and never invokes `git push` or `gh pr create`.
- Invalid `--case` or hostile `--repo` (`; rm -rf /`) fails closed with exit `2`.
- `buildRetroReport()` emits actionable items across all 5 categories with deterministic `reportSha256` and honest `mode: "replay"` + `verificationKind` labeling.
- CLI `pr` and `retro` commands stay zero-dependency (compatible with offline execution).
- Full `npm test`, `npm run check`, `web/npm run build`, and CodeRabbit review pass cleanly.
