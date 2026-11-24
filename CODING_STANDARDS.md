# Coding Standards

Following Matt Pocock's `/code-review` discipline, this file defines standards enforced during automated and human review:

1. **No `any`, no non-null `!` assertions:** Use `unknown` + Zod/runtime parsing at every untrusted boundary (Firecrawl responses, LLM outputs, CLI arguments, HTTP route inputs).
2. **Untrusted web/repo content is data only:** Never execute target repository hooks, git filters, or shell commands derived from scraped docs or candidate code.
3. **Immutable provenance everywhere:** Every Firecrawl retrieval (`scrape`, `changeTracking`, `map`, `search/developer`) and every verifier observation is SHA-256 hashed before verdicts are computed.
4. **Honest labeling & fail-closed boundaries:** Separate `replay` from `live` runs visibly in both CLI output and Web UI. Any verifier timeout, missing API key, or unverified claim fails closed as `unknown` or `blocked`.
5. **Single-responsibility domain modules:** Domain modules under `src/` never depend on Next.js UI code; the web app imports clean read/run contracts.
6. **Red-green TDD for core logic:** Every Firecrawl adapter, LLM fallback router, dead-workaround detector, and API route has automated tests covering both happy and adversarial paths.
