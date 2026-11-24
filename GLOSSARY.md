# Domain Glossary

Canonical terminology for `deadcodefix` (aligned via `/grill-with-docs`). Use these exact terms consistently across CLI, code, docs, and UI.

- **Harness:** The wrapper around an LLM (system prompts, tool schemas, response parsers, retry/compatibility shims, and agent skills) that connects a model to a codebase or workflow.
- **Drift Signal:** A concrete change detected by **Firecrawl** — either a documentation diff from `changeTracking` (`git-diff` / `json` field diff) or an upstream breakage/workaround report from Firecrawl's **Developer Index** (GitHub issues & PRs).
- **Evidence Packet:** An immutable, SHA-256-hashed bundle of frozen official documentation, Firecrawl `changeTracking` diffs, and Developer Index references collected _before_ running any candidate comparison.
- **Dead Workaround:** Compatibility code, response-parsing shims, or defensive prompt instructions that were written for an older model/SDK version and are now obsolete, conflicting, or redundant after an upgrade.
- **Repair Patch:** A minimal, exact unified diff (`repair.patch`) that fixes broken upgrade paths and/or removes verified dead workarounds while preserving required legacy compatibility.
- **Arm (A / B / C):**
  - **Arm A (Baseline Old):** Previous model/SDK + original harness (optional when old model is unavailable).
  - **Arm B (Broken Upgrade):** New model/SDK + original harness (reproduces the failure or dead-workaround overhead).
  - **Arm C (Repaired):** New model/SDK + supplied Repair Patch.
- **Supervisor Verifier:** An isolated, out-of-process check runner that holds hidden assertions, records raw stdout/stderr observations with SHA-256 hashes, and never trusts self-reported candidate pass claims.
- **Run Receipt:** An immutable, append-only record of a single attempt (`smoke`, `pilot`, or `main`) capturing arm, timestamps, disposition (`pass` | `fail` | `unknown` | `not_run`), provider usage, and observation hashes.
