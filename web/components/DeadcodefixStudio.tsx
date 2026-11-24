"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Flame,
  GitCompare,
  ShieldCheck,
  Sparkles,
  Search,
  ExternalLink,
  Terminal,
  Trash2,
  Cpu,
  KeyRound,
  Loader2,
  AlertTriangle,
  GitPullRequest,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import { DEMO_CASES, type DemoCase } from "@/lib/demo-cases";

type TabId = "drift" | "patch" | "verifier" | "live-firecrawl" | "pr-retro";

interface LiveDevHit {
  id: string;
  kind: string;
  url: string;
  title: string;
  passages: string[];
  sha256: string;
}

interface LiveDevResponse {
  mode: "live-keyed" | "live-keyless";
  query: string;
  skillsOnly: boolean;
  retrievedAt: string;
  partial?: boolean;
  coverage?: Record<string, string> | null;
  hits: LiveDevHit[];
  receiptSha256: string;
}

interface LiveDriftResponse {
  mode: "live";
  url: string;
  tag: string;
  retrievedAt: string;
  changeStatus: string;
  previousScrapeAt: string | null;
  gitDiff: string | null;
  jsonDiff: Record<string, { previous: unknown; current: unknown }>;
  markdownExcerpt: string;
  bytesRetained: number;
  contentSha256: string;
  mapStatus?: "ok" | "failed";
  mapError?: string | null;
  mappedUrls: string[];
}

interface LiveLlmResponse {
  status: string;
  providerUsed: string;
  modelId: string;
  analysis: string;
  inputTokens: number;
  outputTokens: number;
  rawResponseSha256: string;
  latencyMs: number;
}

const PRESET_DEV_QUERIES = [
  {
    label: "AI SDK v6 tool inputSchema",
    query: "vercel ai sdk tool parameters renamed inputSchema stopWhen stepCountIs",
    skillsOnly: false,
  },
  {
    label: "Agent Skills (skills=only)",
    query: "code review coding standards pruning tdd skill",
    skillsOnly: true,
  },
  {
    label: "Pi / pstack Harnesses",
    query: "pi coding agent pstack harness tool loop",
    skillsOnly: false,
  },
  {
    label: "Firecrawl changeTracking",
    query: "firecrawl changeTracking git-diff json schema scrape",
    skillsOnly: false,
  },
];

export default function DeadcodefixStudio() {
  const [selectedId, setSelectedId] = useState<string>(DEMO_CASES[0].id);
  const [activeTab, setActiveTab] = useState<TabId>("drift");
  const [dailyTurns, setDailyTurns] = useState<number>(250);

  // Live Firecrawl Developer Index state
  const [devQuery, setDevQuery] = useState<string>(PRESET_DEV_QUERIES[0].query);
  const [skillsOnly, setSkillsOnly] = useState<boolean>(false);
  const [devLoading, setDevLoading] = useState<boolean>(false);
  const [devError, setDevError] = useState<string | null>(null);
  const [devResult, setDevResult] = useState<LiveDevResponse | null>(null);

  // Live Firecrawl Change Tracking state
  const [driftUrl, setDriftUrl] = useState<string>(
    "https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0",
  );
  const [driftTag, setDriftTag] = useState<string>("deadcodefix-hackbrasil");
  const [byokKey, setByokKey] = useState<string>("");
  const [driftLoading, setDriftLoading] = useState<boolean>(false);
  const [driftError, setDriftError] = useState<string | null>(null);
  const [driftResult, setDriftResult] = useState<LiveDriftResponse | null>(
    null,
  );

  // Live LLM Auditor state
  const [llmModel, setLlmModel] = useState<string>("openai/gpt-5-mini");
  const [llmLoading, setLlmLoading] = useState<boolean>(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmResult, setLlmResult] = useState<LiveLlmResponse | null>(null);
  const [copiedPr, setCopiedPr] = useState<boolean>(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Request-generation & abort guards (prevent stale out-of-order UI updates)
  const devReqIdRef = useRef<number>(0);
  const devAbortRef = useRef<AbortController | null>(null);
  const llmReqIdRef = useRef<number>(0);
  const llmAbortRef = useRef<AbortController | null>(null);

  const currentCase: DemoCase =
    DEMO_CASES.find((c) => c.id === selectedId) ?? DEMO_CASES[0];

  const armBPassed = currentCase.checks.filter((c) => c.armBPassed).length;
  const armCPassed = currentCase.checks.filter((c) => c.armCPassed).length;
  const totalChecks = currentCase.checks.length;
  const monthlyTokensSaved = currentCase.tokensSavedPerTurn * dailyTurns * 30;

  async function handleDevSearch(
    overrideQuery?: string,
    overrideSkillsOnly?: boolean,
  ) {
    const q = overrideQuery ?? devQuery;
    const sOnly = overrideSkillsOnly ?? skillsOnly;
    devAbortRef.current?.abort();
    const controller = new AbortController();
    devAbortRef.current = controller;
    const reqId = ++devReqIdRef.current;

    setDevLoading(true);
    setDevError(null);
    try {
      const res = await fetch("/api/firecrawl/developer-index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          limit: 6,
          skillsOnly: sOnly,
          byokApiKey: byokKey || undefined,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (reqId !== devReqIdRef.current) return;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDevResult(data as LiveDevResponse);
    } catch (err) {
      if (reqId !== devReqIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setDevError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (reqId === devReqIdRef.current) {
        setDevLoading(false);
      }
    }
  }

  async function handleLiveDriftScan() {
    setDriftLoading(true);
    setDriftError(null);
    try {
      const res = await fetch("/api/firecrawl/drift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: driftUrl,
          tag: driftTag,
          byokApiKey: byokKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDriftResult(data as LiveDriftResponse);
    } catch (err) {
      setDriftError(err instanceof Error ? err.message : "Drift scan failed");
    } finally {
      setDriftLoading(false);
    }
  }

  async function handleLiveLlmAudit() {
    llmAbortRef.current?.abort();
    const controller = new AbortController();
    llmAbortRef.current = controller;
    const reqId = ++llmReqIdRef.current;

    setLlmLoading(true);
    setLlmError(null);
    try {
      const res = await fetch("/api/llm/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseTitle: currentCase.title,
          diffText: currentCase.repairPatch,
          evidenceSummary: `${currentCase.firecrawl.sourceUrl}\n${currentCase.firecrawl.gitDiff}`,
          modelId: llmModel,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (reqId !== llmReqIdRef.current) return;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLlmResult(data as LiveLlmResponse);
    } catch (err) {
      if (reqId !== llmReqIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setLlmError(err instanceof Error ? err.message : "LLM audit failed");
    } finally {
      if (reqId === llmReqIdRef.current) {
        setLlmLoading(false);
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#090b10] text-slate-100">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#090b10]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg shadow-orange-500/20">
              <Flame className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold tracking-tight text-white">
                  deadcodefix
                </span>
                <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-orange-300">
                  Firecrawl v2 + AI Gateway
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Upgrade Drift Detection · Dead-Workaround Pruning · Isolated B-vs-C Verification
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-xs">
            <span className="hidden rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 font-mono text-emerald-300 sm:inline-flex">
              Hack Brasil 2026
            </span>
            <a
              href="https://github.com/gabchess/deadcodefix"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              <Terminal className="h-3.5 w-3.5" />
              GitHub CLI
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        {/* Hero Value Proposition */}
        <section className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div className="max-w-2xl space-y-2">
              <p className="font-mono text-xs uppercase tracking-wider text-orange-400">
                Zero-Install Judge Evidence Inspector
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Stop shipping dead prompt workarounds & broken SDK shims after a model upgrade.
              </h1>
              <p className="text-sm leading-relaxed text-slate-300">
                <strong>deadcodefix</strong> pairs{" "}
                <span className="text-orange-300">Firecrawl Change Tracking</span>{" "}
                (<code className="text-xs">git-diff</code> +{" "}
                <code className="text-xs">json</code>) and{" "}
                <span className="text-orange-300">Firecrawl Developer Index</span>{" "}
                with an isolated B-vs-C supervisor verifier so maintainers can upgrade AI harnesses
                (Pi, <code className="text-xs">pi-pstack</code>, Software Factories) and delete
                obsolete shims with SHA-256 proof.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("live-firecrawl")}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-400"
            >
              <Flame className="h-4 w-4" />
              Try Live Firecrawl Studio
            </button>
          </div>
        </section>

        {/* Case Selector Cards */}
        <section aria-label="Harness upgrade cases" className="grid gap-3 md:grid-cols-3">
          {DEMO_CASES.map((item) => {
            const active = item.id === currentCase.id;
            const bPass = item.checks.filter((c) => c.armBPassed).length;
            const cPass = item.checks.filter((c) => c.armCPassed).length;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  llmAbortRef.current?.abort();
                  llmReqIdRef.current++;
                  setSelectedId(item.id);
                  setLlmLoading(false);
                  setLlmResult(null);
                  setLlmError(null);
                }}
                className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
                  active
                    ? "border-orange-500/70 bg-orange-500/10 shadow-md shadow-orange-500/10"
                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-orange-300">
                      {item.badge}
                    </span>
                    <span className="font-mono text-xs text-emerald-400">
                      {bPass}/{item.checks.length} → {cPass}/{item.checks.length}
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold text-white">
                    {item.title}
                  </h2>
                  <p className="text-xs text-slate-400">{item.ecosystem}</p>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2.5 font-mono text-[11px] text-slate-400">
                  <span>{item.targetUpgrade}</span>
                  {item.tokensSavedPerTurn > 0 && (
                    <span className="text-emerald-400">
                      -{item.tokensSavedPerTurn} tok/turn
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </section>

        {/* Provenance & KPI Strip */}
        <section className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">Verified Pass Rate (B → C)</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white">
              <span className="text-rose-400">
                {armBPassed}/{totalChecks}
              </span>{" "}
              <span className="text-slate-500">→</span>{" "}
              <span className="text-emerald-400">
                {armCPassed}/{totalChecks}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Supervisor-owned hidden assertions
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">Dead Workarounds Pruned</p>
            <p className="mt-1 font-mono text-2xl font-bold text-orange-400">
              {currentCase.deadWorkaroundsRemoved.length}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              -{currentCase.linesDeleted} / +{currentCase.linesAdded} lines in exact patch
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">Prompt Bloat Cut / Turn</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">
              {currentCase.tokensSavedPerTurn > 0
                ? `-${currentCase.tokensSavedPerTurn}`
                : "0"}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {monthlyTokensSaved > 0
                ? `~${(monthlyTokensSaved / 1_000_000).toFixed(2)}M tokens saved / mo`
                : "Structural schema-hardening fixture"}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">Patch Provenance (SHA-256)</p>
            <p className="mt-2 truncate font-mono text-xs text-sky-300">
              {currentCase.patchSha256}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              {currentCase.provenanceLabel}
            </p>
          </div>
        </section>

        {/* Main Workspace Tabs */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70">
          <div
            role="tablist"
            className="flex flex-wrap gap-1 border-b border-slate-800 p-2"
          >
            {[
              { id: "drift" as const, label: "1. Firecrawl Drift Evidence", icon: Flame },
              { id: "patch" as const, label: "2. Exact Patch & Bloat Audit", icon: GitCompare },
              { id: "verifier" as const, label: "3. Isolated B-vs-C Verifier", icon: ShieldCheck },
              { id: "live-firecrawl" as const, label: "4. Live Firecrawl Studio", icon: Sparkles },
              { id: "pr-retro" as const, label: "5. PR & Retro Generator", icon: GitPullRequest },
            ].map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isSelected}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition sm:text-sm ${
                    isSelected
                      ? "bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/40"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="p-5">
            {/* TAB 1: FIRECRAWL DRIFT */}
            {activeTab === "drift" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-500/25 bg-orange-500/5 p-4">
                  <div>
                    <p className="font-mono text-xs text-orange-300">
                      firecrawl.scrape(url, &#123; formats: [&quot;markdown&quot;, &#123; type: &quot;changeTracking&quot;, modes: [&quot;git-diff&quot;, &quot;json&quot;] &#125;] &#125;)
                    </p>
                    <p className="mt-1 text-sm text-slate-200">
                      Source:{" "}
                      <code className="text-sky-300">
                        {currentCase.firecrawl.sourceUrl}
                      </code>{" "}
                      · Tag:{" "}
                      <code className="text-amber-300">
                        {currentCase.firecrawl.tag}
                      </code>
                    </p>
                  </div>
                  <span className="rounded-full border border-orange-400/40 bg-orange-500/20 px-3 py-1 font-mono text-xs font-semibold uppercase text-orange-200">
                    changeStatus: {currentCase.firecrawl.changeStatus}
                  </span>
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  {/* Unified git-diff */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Firecrawl Change Tracking · Unified git-diff
                    </h3>
                    <pre className="overflow-x-auto rounded-lg bg-[#0b0e15] p-3.5 text-xs leading-6">
                      {currentCase.firecrawl.gitDiff.split("\n").map((line, i) => (
                        <div
                          key={i}
                          className={
                            line.startsWith("+")
                              ? "bg-emerald-500/10 text-emerald-300"
                              : line.startsWith("-")
                                ? "bg-rose-500/10 text-rose-300"
                                : line.startsWith("@@")
                                  ? "text-sky-400"
                                  : "text-slate-300"
                          }
                        >
                          {line}
                        </div>
                      ))}
                    </pre>
                  </div>

                  {/* Structured JSON Field Diff */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Firecrawl Change Tracking · Structured JSON Field Diff
                    </h3>
                    <div className="space-y-2.5">
                      {Object.entries(currentCase.firecrawl.jsonDiff).map(
                        ([field, diff]) => (
                          <div
                            key={field}
                            className="rounded-lg border border-slate-800 bg-[#0b0e15] p-3 text-xs"
                          >
                            <div className="font-mono font-semibold text-sky-300">
                              {field}
                            </div>
                            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                              <div className="rounded bg-rose-500/10 px-2 py-1 text-rose-300">
                                <span className="font-mono text-[10px] uppercase opacity-75">
                                  previous:
                                </span>{" "}
                                {diff.previous}
                              </div>
                              <div className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-300">
                                <span className="font-mono text-[10px] uppercase opacity-75">
                                  current:
                                </span>{" "}
                                {diff.current}
                              </div>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                </div>

                {/* Developer Index Primary Sources */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <h3 className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Firecrawl Developer Index · Primary Issues, PRs & Docs
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {currentCase.firecrawl.developerIndexHits.map((hit) => (
                      <div
                        key={hit.id}
                        className="rounded-lg border border-slate-800 bg-[#0b0e15] p-3.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded bg-sky-500/15 px-2 py-0.5 font-mono text-[11px] text-sky-300">
                            {hit.kind}
                          </span>
                          <a
                            href={hit.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-orange-300 hover:underline"
                          >
                            Source <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <p className="mt-2 text-sm font-medium text-white">
                          {hit.title}
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                          {hit.passage}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: EXACT PATCH & BLOAT */}
            {activeTab === "patch" && (
              <div className="space-y-6">
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 lg:col-span-2">
                    <div className="mb-2 flex items-center gap-2 text-orange-300">
                      <Trash2 className="h-4 w-4" />
                      <h3 className="font-mono text-xs font-semibold uppercase tracking-wider">
                        Dead Workarounds & Prompt Sediment Removed
                      </h3>
                    </div>
                    <ul className="space-y-2 text-sm text-slate-200">
                      {currentCase.deadWorkaroundsRemoved.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-300">
                      Token Bloat Savings Calculator
                    </h3>
                    <label className="mt-3 block text-xs text-slate-400">
                      Agent turns / day:{" "}
                      <span className="font-mono text-white">{dailyTurns}</span>
                    </label>
                    <input
                      type="range"
                      min={25}
                      max={2000}
                      step={25}
                      value={dailyTurns}
                      onChange={(e) => setDailyTurns(Number(e.target.value))}
                      className="mt-2 w-full accent-orange-500"
                    />
                    <p className="mt-3 font-mono text-lg font-bold text-emerald-400">
                      {monthlyTokensSaved.toLocaleString()} tokens / mo
                    </p>
                    <p className="text-[11px] text-slate-400">
                      eliminated from every system-prompt & tool-schema payload
                    </p>
                  </div>
                </div>

                {/* Exact Unified Patch */}
                <div className="rounded-xl border border-slate-800 bg-[#0b0e15] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Exact Evaluated repair.patch
                    </h3>
                    <span className="font-mono text-[11px] text-slate-400">
                      SHA-256: {currentCase.patchSha256.slice(0, 16)}…
                    </span>
                  </div>
                  <pre className="overflow-x-auto text-xs leading-6">
                    {currentCase.repairPatch.split("\n").map((line, i) => (
                      <div
                        key={i}
                        className={
                          line.startsWith("+") && !line.startsWith("+++")
                            ? "bg-emerald-500/10 px-2 text-emerald-300"
                            : line.startsWith("-") && !line.startsWith("---")
                              ? "bg-rose-500/10 px-2 text-rose-300"
                              : line.startsWith("@@") || line.startsWith("diff")
                                ? "px-2 text-sky-400"
                                : "px-2 text-slate-300"
                        }
                      >
                        {line || " "}
                      </div>
                    ))}
                  </pre>
                </div>

                {/* Live Multi-Provider LLM Auditor */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-sky-300">
                        <Cpu className="h-4 w-4" />
                        Live Independent /code-review Audit (Vercel AI Gateway → OpenAI → OpenRouter)
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        Sends the Firecrawl diff + exact repair.patch to a fresh reviewer context.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={llmModel}
                        onChange={(e) => setLlmModel(e.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200"
                      >
                        <option value="openai/gpt-5-mini">openai/gpt-5-mini</option>
                        <option value="openai/gpt-5">openai/gpt-5</option>
                        <option value="anthropic/claude-sonnet-5.5">
                          anthropic/claude-sonnet-5.5
                        </option>
                      </select>
                      <button
                        type="button"
                        disabled={llmLoading}
                        onClick={handleLiveLlmAudit}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        {llmLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        Run Live Audit
                      </button>
                    </div>
                  </div>
                  {llmError && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{llmError}</span>
                    </div>
                  )}
                  {llmResult && (
                    <div className="mt-3 space-y-2 rounded-lg border border-emerald-500/30 bg-[#0b0e15] p-4 text-xs">
                      <div className="flex flex-wrap gap-3 font-mono text-[11px] text-emerald-300">
                        <span>provider: {llmResult.providerUsed}</span>
                        <span>model: {llmResult.modelId}</span>
                        <span>
                          tokens: {llmResult.inputTokens} in /{" "}
                          {llmResult.outputTokens} out
                        </span>
                        <span>{llmResult.latencyMs}ms</span>
                      </div>
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-200">
                        {llmResult.analysis}
                      </pre>
                      <p className="font-mono text-[10px] text-slate-500">
                        Response SHA-256: {llmResult.rawResponseSha256}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: ISOLATED B-VS-C VERIFIER */}
            {activeTab === "verifier" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 text-xs text-slate-300">
                  <strong>
                    {currentCase.verificationKind === "isolated-replay"
                      ? "Isolated Subprocess Replay:"
                      : "Static Contract Checks (Synthetic Replay):"}
                  </strong>{" "}
                  {currentCase.verificationKind === "isolated-replay"
                    ? "Candidate self-reported pass claims are ignored. Every check below executes inside a restricted subprocess and retains an immutable 64-character SHA-256 observation hash."
                    : "These checks verify exact static source contracts and git-apply patch integrity without executing untrusted target code on the host. Live behavioral verification requires an approved isolated sandbox."}
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-900/90 font-mono text-[11px] uppercase text-slate-400">
                      <tr>
                        <th className="p-3">Check & Category</th>
                        <th className="p-3">Arm B (Broken Upgrade)</th>
                        <th className="p-3">Arm C (Repaired & Pruned)</th>
                        <th className="p-3">Observation Hash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 bg-[#0b0e15]">
                      {currentCase.checks.map((ch) => (
                        <tr key={ch.id} className="align-top">
                          <td className="p-3">
                            <p className="font-semibold text-white">{ch.label}</p>
                            <span className="mt-1 inline-block rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                              {ch.category}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-start gap-2">
                              {ch.armBPassed ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                              ) : (
                                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                              )}
                              <span
                                className={
                                  ch.armBPassed ? "text-emerald-300" : "text-rose-200"
                                }
                              >
                                {ch.armBDetail}
                              </span>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="flex items-start gap-2">
                              {ch.armCPassed ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                              ) : (
                                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                              )}
                              <span className="text-emerald-200">
                                {ch.armCDetail}
                              </span>
                            </div>
                          </td>
                          <td className="p-3 font-mono text-[11px] text-slate-500">
                            {ch.observationSha256.slice(0, 14)}…
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 4: LIVE FIRECRAWL STUDIO */}
            {activeTab === "live-firecrawl" && (
              <div className="space-y-6">
                {/* Optional In-Memory BYOK Bar */}
                <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4">
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                    <div className="space-y-0.5">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-orange-200">
                        <KeyRound className="h-4 w-4" />
                        Optional BYOK Firecrawl Key (In-Memory Only — Never Stored)
                      </p>
                      <p className="text-xs text-slate-400">
                        Developer Index works <strong>keyless</strong> right now. Enter a{" "}
                        <code>fc-...</code> key (or configure <code>FIRECRAWL_API_KEY</code> on
                        Vercel) to unlock Pro rate limits + live{" "}
                        <code>changeTracking</code> & <code>map</code>.
                      </p>
                    </div>
                    <input
                      type="password"
                      placeholder="fc-... (optional BYOK)"
                      value={byokKey}
                      onChange={(e) => setByokKey(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white placeholder:text-slate-500 md:w-72"
                    />
                  </div>
                </div>

                {/* Live Panel A: Firecrawl Developer Index */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                        <Search className="h-4 w-4 text-orange-400" />
                        Live Firecrawl Developer Index (POST /v2/search/developer)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Searches 70M+ GitHub issues, merged PRs, docs, and agent-skill files (
                        <code>skills=&quot;only&quot;</code>) with verbatim markdown passages.
                      </p>
                    </div>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-2">
                    {PRESET_DEV_QUERIES.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setDevQuery(preset.query);
                          setSkillsOnly(preset.skillsOnly);
                          void handleDevSearch(preset.query, preset.skillsOnly);
                        }}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 transition hover:border-orange-500/50 hover:text-orange-200"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={devQuery}
                      onChange={(e) => setDevQuery(e.target.value)}
                      placeholder="Search SDK breaking changes, issues, PRs, or agent skills..."
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={skillsOnly}
                        onChange={(e) => setSkillsOnly(e.target.checked)}
                        className="accent-orange-500"
                      />
                      skills=&quot;only&quot;
                    </label>
                    <button
                      type="button"
                      disabled={devLoading}
                      onClick={() => void handleDevSearch()}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                    >
                      {devLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      Search Live
                    </button>
                  </div>

                  {devError && (
                    <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                      {devError}
                    </p>
                  )}

                  {devResult && (
                    <div className="mt-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-emerald-300">
                        <span>
                          mode: {devResult.mode} · {devResult.hits.length} primary sources
                        </span>
                        <span>receipt SHA-256: {devResult.receiptSha256.slice(0, 18)}…</span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {devResult.hits.map((hit) => (
                          <div
                            key={hit.sha256}
                            className="rounded-lg border border-slate-800 bg-[#0b0e15] p-3.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="rounded bg-orange-500/15 px-2 py-0.5 font-mono text-[11px] text-orange-300">
                                {hit.kind}
                              </span>
                              <a
                                href={hit.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline"
                              >
                                Open <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            <p className="mt-1.5 text-sm font-semibold text-white">
                              {hit.title}
                            </p>
                            {hit.passages[0] && (
                              <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-[11px] text-slate-300">
                                {hit.passages[0]}
                              </pre>
                            )}
                            <p className="mt-2 font-mono text-[10px] text-slate-500">
                              {hit.id} · sha256:{hit.sha256.slice(0, 12)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Live Panel B: Firecrawl Change Tracking + Map */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                    <Flame className="h-4 w-4 text-orange-400" />
                    Live Firecrawl Change Tracking (git-diff + json) & Site Map
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Scrapes any public HTTPS docs page with Firecrawl{" "}
                    <code>changeTracking</code> + maps sibling migration pages + hashes raw
                    bytes. Run twice on the same URL & tag to observe historical diff tracking.
                  </p>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <input
                      type="url"
                      value={driftUrl}
                      onChange={(e) => setDriftUrl(e.target.value)}
                      placeholder="https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0"
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white sm:col-span-2"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={driftTag}
                        onChange={(e) => setDriftTag(e.target.value)}
                        placeholder="tracking tag"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                      />
                      <button
                        type="button"
                        disabled={driftLoading}
                        onClick={() => void handleLiveDriftScan()}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                      >
                        {driftLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Flame className="h-3.5 w-3.5" />
                        )}
                        Scan Drift
                      </button>
                    </div>
                  </div>

                  {driftError && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{driftError}</span>
                    </div>
                  )}

                  {driftResult && (
                    <div className="mt-4 space-y-3 rounded-lg border border-emerald-500/30 bg-[#0b0e15] p-4 text-xs">
                      <div className="flex flex-wrap gap-3 font-mono text-[11px] text-emerald-300">
                        <span>changeStatus: {driftResult.changeStatus}</span>
                        <span>bytes: {driftResult.bytesRetained.toLocaleString()}</span>
                        <span>sha256: {driftResult.contentSha256.slice(0, 16)}…</span>
                        {driftResult.mapStatus === "failed" && (
                          <span className="text-amber-300">
                            mapStatus: failed ({driftResult.mapError ?? "partial success"})
                          </span>
                        )}
                      </div>
                      {driftResult.gitDiff && (
                        <pre className="max-h-48 overflow-auto rounded bg-slate-950 p-3 text-[11px] text-emerald-200">
                          {driftResult.gitDiff}
                        </pre>
                      )}
                      {driftResult.mappedUrls.length > 0 && (
                        <div>
                          <p className="font-mono text-[11px] uppercase text-slate-400">
                            Mapped Migration / Sibling URLs ({driftResult.mappedUrls.length})
                          </p>
                          <ul className="mt-1 space-y-1 font-mono text-[11px] text-sky-300">
                            {driftResult.mappedUrls.map((u) => (
                              <li key={u} className="truncate">
                                {u}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-[11px] text-slate-300">
                        {driftResult.markdownExcerpt}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: HUMAN-GATED PR & SOFTWARE FACTORY RETRO */}
            {activeTab === "pr-retro" && (() => {
              const isDocsOnly = currentCase.id === "matt-coding-standards-prune";
              const hasSecurity = currentCase.checks.some(
                (c) => c.category === "security",
              );
              const door = "Two-way";
              const blastRadius = isDocsOnly
                ? "Small"
                : hasSecurity
                  ? "Medium"
                  : "Small";
              const mergeRationale = isDocsOnly
                ? "Modifies review-policy markdown only; trivial to revert via git revert without runtime impact."
                : hasSecurity
                  ? "Updates tool schema parsing and removes legacy regex shim; easily reverted, but touches untrusted payload boundary."
                  : "Scoped adapter update with preserved legacy compatibility; cleanly reversible.";
              const reviewPriority = isDocsOnly
                ? "Low — fast human scan of kept architectural rules"
                : hasSecurity
                  ? "Medium — verify strict Zod boundary & legacy compatibility checks"
                  : "Low — confirm passing automated checks";
              const prTitle = `fix(${currentCase.id}): upgrade harness & prune ${currentCase.deadWorkaroundsRemoved.length} dead workaround(s)`;
              const checkRows = currentCase.checks
                .map(
                  (c) =>
                    `| \`${c.id}\` | ${c.armBPassed ? "PASS" : "FAIL"} | ${c.armCPassed ? "PASS" : "FAIL"} | \`${c.observationSha256.slice(0, 12)}\` |`,
                )
                .join("\n");
              const prunedList = currentCase.deadWorkaroundsRemoved
                .map((w) => `- Pruned: ${w}`)
                .join("\n");
              const prBody = [
                `## Summary`,
                ``,
                "```text",
                `Firecrawl Drift (${currentCase.firecrawl.changeStatus}) ──► ${currentCase.targetUpgrade}`,
                `  ├─ Pruned:   ${currentCase.deadWorkaroundsRemoved.length} dead workaround(s) (-${currentCase.tokensSavedPerTurn} tokens/turn)`,
                `  └─ Checks:   Arm B ${armBPassed}/${totalChecks} ──► Arm C ${armCPassed}/${totalChecks} (${currentCase.verificationKind}, replay)`,
                "```",
                ``,
                prunedList,
                ``,
                `## Evidence (Before → After)`,
                ``,
                `- **Provenance Mode:** \`replay\` (\`${currentCase.verificationKind}\`)`,
                `- **Firecrawl Source:** ${currentCase.firecrawl.sourceUrl} (tag: \`${currentCase.firecrawl.tag}\`, \`changeStatus: ${currentCase.firecrawl.changeStatus}\`)`,
                `- **Exact Patch SHA-256:** \`${currentCase.patchSha256}\``,
                `- **Before (Arm B — Unpatched Upgrade):** ${armBPassed}/${totalChecks} checks passed`,
                `- **After (Arm C — Repaired & Pruned):** ${armCPassed}/${totalChecks} checks passed`,
                ``,
                `| Check | Before (Arm B) | After (Arm C) | Digest |`,
                `| --- | --- | --- | --- |`,
                checkRows,
                ``,
                `## Merge Danger`,
                ``,
                `**Door:** ${door}`,
                ``,
                `**Blast Radius:** ${blastRadius}`,
                ``,
                mergeRationale,
                ``,
                `**Recommended Review Attention:** ${reviewPriority}`,
                ``,
                `## Human Gate`,
                ``,
                `- [ ] Maintainer inspected exact \`repair.patch\` (\`${currentCase.patchSha256.slice(0, 16)}...\`)`,
                `- [ ] Maintainer verified legacy compatibility check stays green`,
                `- [ ] Generated in \`--dry-run\` mode by \`deadcodefix pr\`; human approves creation & merge`,
              ].join("\n");

              const handleCopyPr = async () => {
                setCopyError(null);
                try {
                  if (!navigator.clipboard?.writeText) {
                    throw new Error("Clipboard API unavailable — copy manually from the box below.");
                  }
                  await navigator.clipboard.writeText(prBody);
                  setCopiedPr(true);
                  setTimeout(() => setCopiedPr(false), 2000);
                } catch (err) {
                  setCopiedPr(false);
                  setCopyError(
                    err instanceof Error
                      ? err.message
                      : "Clipboard permission denied — select and copy manually below.",
                  );
                }
              };

              const retroItems = [
                {
                  category: "coding-standards",
                  target: "CODING_STANDARDS.md",
                  title: "Delete prose rules already enforced by tsc / ESLint / Prettier",
                  why: "Reserve LLM /code-review context strictly for architectural judgment.",
                },
                {
                  category: "agents-md-pruning",
                  target: currentCase.id,
                  title: `Prune ${currentCase.deadWorkaroundsRemoved.length} obsolete workaround(s) (-${currentCase.tokensSavedPerTurn} tokens/turn)`,
                  why: "Stop paying per-turn token tax for old-model shims superseded by native SDK schemas.",
                },
                {
                  category: "automated-checks",
                  target: "test/harness-cases.test.ts",
                  title: "Promote breaking-change & git apply --check into CI gates",
                  why: "Deterministic checks beat probabilistic prompt reminders on every future upgrade.",
                },
                {
                  category: "tool-economy",
                  target: "src/firecrawl/drift.ts",
                  title: `Pin ${currentCase.firecrawl.tag} in Firecrawl changeTracking`,
                  why: "Turn upstream doc edits into automatic git-diff + JSON drift signals.",
                },
                {
                  category: "navigation",
                  target: "GLOSSARY.md",
                  title: "Keep domain glossary & adapter pointers updated",
                  why: "Helps fresh agent sessions land on the right files in one hop.",
                },
              ];

              return (
                <div className="space-y-6">
                  {/* Human-Gated PR Draft Card */}
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
                            deadcodefix pr --case {currentCase.id} --dry-run
                          </span>
                          <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 font-mono text-[11px] text-sky-300">
                            Door: {door}
                          </span>
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[11px] text-amber-300">
                            Blast Radius: {blastRadius}
                          </span>
                        </div>
                        <h3 className="text-base font-semibold text-white">
                          {prTitle}
                        </h3>
                        <p className="text-xs text-slate-400">
                          Human-gated dry-run PR draft following Matt Pocock&apos;s{" "}
                          <code>/pr</code> template (Summary sketch, Before/After evidence, Merge Danger).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopyPr()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-emerald-500/50 hover:text-white"
                      >
                        {copiedPr ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                            Copied Markdown
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Copy PR Body
                          </>
                        )}
                      </button>
                    </div>

                    {copyError && (
                      <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
                        {copyError}
                      </p>
                    )}

                    <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#0b0e15] p-4 text-xs leading-6 text-slate-200">
                      {prBody}
                    </pre>

                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-2 font-mono text-[11px] text-sky-300">
                      $ gh pr create --repo gabchess/deadcodefix --head deadcodefix/
                      {currentCase.id} --title &quot;{prTitle}&quot; --body-file pr-body.md
                    </div>
                  </div>

                  {/* Software Factory Retro Card */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                          <RefreshCw className="h-4 w-4 text-orange-400" />
                          Software Factory Retrospective (deadcodefix retro --case{" "}
                          {currentCase.id})
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-400">
                          &ldquo;Never leave the same review comment twice&rdquo; — feeds every
                          upgrade lesson back into the agent&apos;s environment across 5 categories.
                        </p>
                      </div>
                      <span className="rounded bg-orange-500/15 px-2.5 py-1 font-mono text-[11px] text-orange-300">
                        .agents/skills/deadcodefix-retro
                      </span>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {retroItems.map((r) => (
                        <div
                          key={r.category}
                          className="rounded-lg border border-slate-800 bg-[#0b0e15] p-3.5"
                        >
                          <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                            <span className="rounded bg-slate-800 px-2 py-0.5 text-orange-300">
                              {r.category}
                            </span>
                            <span className="text-slate-400">{r.target}</span>
                          </div>
                          <p className="mt-2 text-sm font-semibold text-white">
                            {r.title}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">
                            {r.why}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </main>
    </div>
  );
}
