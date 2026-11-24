# deadcodefix

**Firecrawl-powered upgrade drift detection, dead-workaround pruning, and isolated B-vs-C verification for AI coding harnesses.**

When a model or AI SDK upgrades, teams accumulate two expensive problems:

1. **Broken harness contracts** (e.g., AI SDK `tool({ parameters })` → `inputSchema`, `maxSteps` → `stopWhen: stepCountIs(n)`).
2. **Dead workarounds & prompt sediment** — legacy regex fence strippers, defensive prompt rules, and redundant prose in `CODING_STANDARDS.md` that waste hundreds to thousands of tokens on every turn.

`deadcodefix` closes the loop with **Firecrawl v2** + **isolated supervisor verification**:

- **Firecrawl Change Tracking (`modes: ["git-diff", "json"]`):** detects exact doc & schema drift in official SDK/model migration guides.
- **Firecrawl Developer Index (`POST /v2/search/developer`):** searches primary GitHub issues, merged PRs, READMEs, and agent-skill files (`skills="only"`) with verbatim markdown passages.
- **Firecrawl Map + Structured Scrape:** discovers migration surfaces and freezes SHA-256-hashed `EvidencePacket` bundles.
- **Multi-Provider LLM Router:** Vercel AI Gateway primary → OpenAI direct fallback → OpenRouter fallback, with hard USD spend caps.
- **Isolated B-vs-C Supervisor Verification:** proves the upgrade passes, legacy compatibility is preserved, adversarial injections are blocked, and dead workarounds are safe to delete.

---

## Quick Start (CLI)

Requires Node.js 22+ and Git.

```bash
npm install
npm test
npm run check
```

List built-in open-source harness upgrade cases (Pi / `pi-pstack`, Matt Pocock Software Factories `CODING_STANDARDS.md` pruning):

```bash
node src/cli/main.ts cases
```

Run a live Firecrawl documentation drift + Developer Index scan (set `FIRECRAWL_API_KEY` in `.env.local`):

```bash
node src/cli/main.ts drift --url https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0 --tag ai-sdk-v6 --query "ai sdk tool inputSchema pi coding agent"
```

Run the zero-key reproducible offline replay pipeline:

```bash
mkdir artifacts
node src/cli/main.ts demo --out artifacts/case
node src/cli/main.ts evidence --case artifacts/case --mode replay
node src/cli/main.ts run --case artifacts/case --mode replay --out artifacts/run
node src/cli/main.ts report --run artifacts/run
```

---

## Interactive Web App (`web/`)

The Next.js Evidence Inspector & Live Firecrawl Drift Studio lives in `web/` and deploys directly to Vercel so judges can inspect every case, diff, verifier receipt, and run live Firecrawl Developer Index & Change Tracking scans with zero local installation.

```bash
cd web
npm install
npm run dev
```

---

## Architecture

| Path                      | Responsibility                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/firecrawl/`          | Firecrawl v2 Change Tracking (`git-diff` + `json`), Developer Index (`passages` + `skills="only"`), Map, SSRF guard   |
| `src/llm/`                | Multi-provider LLM router (Vercel AI Gateway → OpenAI → OpenRouter) with hard USD budget caps                         |
| `src/harnesses/`          | Real OSS harness upgrade & sediment-pruning cases (Pi / `pi-pstack`, Software Factories `CODING_STANDARDS.md`)        |
| `src/inspect-repository/` | Read-only Git object & tree pinning without executing target hooks                                                    |
| `src/collect-evidence/`   | Frozen SHA-256 `EvidencePacket` validation                                                                            |
| `src/design-comparison/`  | Experiment & exact `repair.patch` contract validation                                                                 |
| `src/run-comparison/`     | Immutable append-only attempt receipts, resume, and budget ledger                                                     |
| `src/verify-artifacts/`   | Isolated out-of-process supervisor checks                                                                             |
| `src/prepare-repair/`     | Reproducible HTML/Markdown reports and SHA-256 review packages                                                        |
| `web/`                    | Interactive Next.js Evidence Inspector & Live Firecrawl Drift Studio (Vercel)                                         |
| `.agents/skills/`         | Official Firecrawl agent skills (`firecrawl-build`, `firecrawl-developer-index`, `firecrawl-map`, `firecrawl-scrape`) |

## License

MIT — see [LICENSE](LICENSE).
