---
name: deadcodefix-pr
description: Generate a human-gated dry-run Pull Request body for a deadcodefix harness upgrade & dead-workaround repair with Before/After evidence, Firecrawl drift citations, and Merge Danger (Door + Blast Radius).
---

# deadcodefix-pr

Use this skill when preparing a Pull Request for a model/SDK upgrade repair verified by `deadcodefix`.

## Workflow

1. Run `node src/cli/main.ts pr --case <caseId> --dry-run --repo <owner/name>`.
2. Inspect the generated `## Summary`, `## Evidence (Before -> After)`, and `## Merge Danger` (`Door` + `Blast Radius`).
3. Verify the exact `patchSha256` and confirm legacy compatibility checks remain green.
4. Present the draft to the human maintainer. **Never push or merge without explicit human approval.**
