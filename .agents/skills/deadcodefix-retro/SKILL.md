---
name: deadcodefix-retro
description: Run a Software Factory retrospective on a deadcodefix upgrade run to prune CODING_STANDARDS.md sediment, promote flaky prose rules into deterministic CI checks, and improve future agent runs.
---

# deadcodefix-retro

Use this skill after a model/SDK upgrade or code-review cycle so you never leave the same review comment twice.

## Workflow

1. Run `node src/cli/main.ts retro --case <caseId>`.
2. Review the 5 environment-upgrade categories:
   - `coding-standards` — prune prose rules already enforced by `tsc`/`eslint`/`prettier`
   - `agents-md-pruning` — delete obsolete model/SDK prompt workarounds
   - `automated-checks` — promote recurring failures into deterministic tests/checks
   - `tool-economy` — pin upstream docs in Firecrawl `changeTracking` + Developer Index
   - `navigation` — keep adapter and test pointers current in `GLOSSARY.md`
3. Apply only the approved improvements in a separate focused commit.
