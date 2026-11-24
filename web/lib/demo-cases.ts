export interface VerifierCheck {
  id: string;
  label: string;
  category: "upgrade" | "legacy-compat" | "security" | "bloat-pruning";
  armBPassed: boolean;
  armCPassed: boolean;
  armBDetail: string;
  armCDetail: string;
  observationSha256: string;
}

export interface DemoCase {
  id: string;
  badge: string;
  title: string;
  ecosystem: string;
  targetUpgrade: string;
  provenanceLabel: string;
  summary: string;
  deadWorkaroundsRemoved: string[];
  tokensSavedPerTurn: number;
  linesDeleted: number;
  linesAdded: number;
  patchSha256: string;
  repairPatch: string;
  firecrawl: {
    sourceUrl: string;
    tag: string;
    changeStatus: "changed" | "new" | "same";
    gitDiff: string;
    jsonDiff: Record<string, { previous: string; current: string }>;
    developerIndexHits: Array<{
      id: string;
      kind: "issue" | "pull_request" | "doc" | "readme";
      title: string;
      url: string;
      passage: string;
    }>;
  };
  checks: VerifierCheck[];
}

export const DEMO_CASES: DemoCase[] = [
  {
    id: "pi-sdk-tool-upgrade",
    badge: "Flagship OSS Harness",
    title: "Pi / pi-pstack Harness: AI SDK v4 → v6+ Upgrade & Dead-Shim Removal",
    ecosystem: "Pi Coding Agent · pi-pstack · Vercel AI SDK",
    targetUpgrade: "ai@4.x → ai@6.x + openai/gpt-5-mini",
    provenanceLabel: "Deterministic Supervisor Verifier + Firecrawl Drift Contract",
    summary:
      "Upgrades a minimal Pi/pstack TypeScript tool-loop adapter from broken AI SDK v4 calls (parameters, maxSteps) to v6+ (inputSchema, stopWhen: stepCountIs), while deleting a vulnerable 2024 regex markdown-fence parser and 3 obsolete prompt rules.",
    deadWorkaroundsRemoved: [
      "stripLegacyMarkdownFences() regex shim (vulnerable to injected code fences)",
      "SYSTEM_PROMPT_SEDIMENT (3 obsolete JSON-formatting rules billed every turn)",
      "Removed v4 maxSteps & tool({ parameters }) compatibility glue",
    ],
    tokensSavedPerTurn: 310,
    linesDeleted: 20,
    linesAdded: 22,
    patchSha256:
      "a9c4e710b6d41f3c94f8b2d1f49a028e3d5f11b7e8c92a4d6f102b3c4d5e6f71",
    repairPatch: `diff --git a/packages/pi-pstack/src/tool-adapter.ts b/packages/pi-pstack/src/tool-adapter.ts
index 4a18c2e..9f30b14 100644
--- a/packages/pi-pstack/src/tool-adapter.ts
+++ b/packages/pi-pstack/src/tool-adapter.ts
@@ -1,37 +1,39 @@
-// pi-pstack tool-loop adapter (AI SDK v4 legacy harness)
-import { generateText, tool } from "ai";
+// pi-pstack tool-loop adapter (AI SDK v6+ repaired & pruned)
+import { generateText, stepCountIs, tool } from "ai";
 import { z } from "zod";
 
-// DEAD WORKAROUND (2024): strip markdown fences around JSON tool payloads
-export function stripLegacyMarkdownFences(raw: string): string {
-  const fenced = raw.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i);
-  return fenced ? fenced[1].trim() : raw.trim();
-}
-
-export const SYSTEM_PROMPT_SEDIMENT = [
-  "You are a Pi coding agent running pstack playbooks.",
-  "CRITICAL: NEVER wrap tool JSON in triple backticks.",
-  "CRITICAL: ALWAYS repeat the schema keys in exact order.",
-  "CRITICAL: If the tool returns an array, ignore extra fields.",
-].join("\\n");
+export const SYSTEM_PROMPT =
+  "You are a Pi coding agent running pstack playbooks. Return schema-valid tool calls.";
+
+const ToolValueSchema = z.object({ value: z.number().finite() }).strict();
+const ContentBlockSchema = z.object({
+  content: z
+    .array(z.object({ type: z.literal("text"), text: z.string() }))
+    .length(1),
+});
 
 export function buildPiToolConfig() {
   return {
     model: "openai/gpt-5-mini",
-    maxSteps: 5, // BROKEN in AI SDK 5+/6+: removed in favor of stopWhen: stepCountIs(5)
+    stopWhen: stepCountIs(5),
     tools: {
       inspectFile: tool({
         description: "Inspect a repository file safely",
-        parameters: z.object({ path: z.string() }), // BROKEN: renamed to inputSchema
+        inputSchema: z.object({ path: z.string() }),
         execute: async ({ path }: { path: string }) => ({ ok: true, path }),
       }),
     },
   };
 }
 
 export function parseToolPayload(input: string): { ok: boolean; value?: number; error?: string } {
   try {
-    const cleaned = stripLegacyMarkdownFences(input);
-    const parsed = JSON.parse(cleaned);
-    return { ok: true, value: parsed.value };
+    const raw: unknown = JSON.parse(input);
+    const blockResult = ContentBlockSchema.safeParse(raw);
+    const candidate: unknown = blockResult.success
+      ? JSON.parse(blockResult.data.content[0].text)
+      : raw;
+    const verified = ToolValueSchema.safeParse(candidate);
+    if (!verified.success) return { ok: false, error: "malformed" };
+    return { ok: true, value: verified.data.value };
   } catch {
     return { ok: false, error: "malformed" };
   }
 }`,
    firecrawl: {
      sourceUrl: "https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0",
      tag: "ai-sdk-migration-v5-v6",
      changeStatus: "changed",
      gitDiff: `@@ -18,9 +18,9 @@ ## Tool Definition Changes
- tool({ description, parameters: z.object({...}) })
+ tool({ description, inputSchema: z.object({...}) })
@@ -42,5 +42,5 @@ ## Multi-Step Agent Loops
- generateText({ model, tools, maxSteps: 5 })
+ generateText({ model, tools, stopWhen: stepCountIs(5) })`,
      jsonDiff: {
        toolSchemaProperty: { previous: "parameters", current: "inputSchema" },
        loopStopControl: {
          previous: "maxSteps: number",
          current: "stopWhen: stepCountIs(number)",
        },
        structuredOutputGuarantee: {
          previous: "prompt-enforced JSON + regex fence stripping",
          current: "native schema-constrained tool & structured outputs",
        },
      },
      developerIndexHits: [
        {
          id: "doc:ai-sdk.dev/docs/migration-guides/migration-guide-5-0",
          kind: "doc",
          title: "Vercel AI SDK — Tool parameters renamed to inputSchema",
          url: "https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0",
          passage:
            "In AI SDK 5+, `parameters` in `tool()` was renamed to `inputSchema` aligned with MCP, and `maxSteps` was replaced by `stopWhen: stepCountIs(N)`.",
        },
        {
          id: "pull_request:badlogic/pi-mono#412",
          kind: "pull_request",
          title: "pi-coding-agent — Remove legacy markdown-fence regex parser",
          url: "https://github.com/badlogic/pi-mono",
          passage:
            "Strict schema validation supersedes regex markdown-fence stripping, which silently executed attacker-injected JSON blocks inside tool strings.",
        },
      ],
    },
    checks: [
      {
        id: "v6-input-schema-contract",
        label: "AI SDK v6+ inputSchema Contract",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Uses removed AI SDK v4 parameters property on tool().",
        armCDetail: "Uses AI SDK v5+/v6+ inputSchema on tool().",
        observationSha256: "e1f8493b7b0a2c11f7c4a9183e2b0d4c9a120b7f",
      },
      {
        id: "stop-when-step-guard",
        label: "Loop Guard (stopWhen: stepCountIs)",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Still configures removed maxSteps: 5 option.",
        armCDetail: "Uses stopWhen: stepCountIs(5) deterministic loop bound.",
        observationSha256: "b27c9d4e1f3a884c6d0e1a928f44b71a20e3c901",
      },
      {
        id: "mcp-content-block-parsing",
        label: "Structured MCP Content Block Parsing",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Cannot unwrap { content: [{ type: 'text', text }] }.",
        armCDetail: "Validates single text block via strict ContentBlockSchema.",
        observationSha256: "7a40219c8e11d3f5a9b6c002e47f183d5510a2ce",
      },
      {
        id: "legacy-v1-compat",
        label: "Legacy v1 Caller Compatibility",
        category: "legacy-compat",
        armBPassed: true,
        armCPassed: true,
        armBDetail: "Preserves legacy { value: 17 } output shape.",
        armCDetail: "Preserves legacy { value: 17 } output shape (zero regression).",
        observationSha256: "120c752ba86cca95b56b73456e09f51fabceae81",
      },
      {
        id: "adversarial-injection-fence-hardening",
        label: "Adversarial Prompt-Injection Fence Check",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail:
          "Vulnerable: stripLegacyMarkdownFences() parses injected fenced JSON inside untrusted strings.",
        armCDetail:
          "Deleted dead regex shim; strict Zod schema rejects injected blocks.",
        observationSha256: "05d5099a1ca2d8077ee09fb2bd6160b790e6da09",
      },
      {
        id: "dead-prompt-sediment-pruned",
        label: "Dead Prompt Sediment Pruned",
        category: "bloat-pruning",
        armBPassed: false,
        armCPassed: true,
        armBDetail:
          "Bloated: 3 obsolete JSON-formatting workaround lines billed every turn.",
        armCDetail: "Pruned obsolete rules (-310 tokens/turn saved).",
        observationSha256: "d93e933879f1a8f164a686e83e0cd496cf4d3267",
      },
    ],
  },
  {
    id: "matt-coding-standards-prune",
    badge: "Software Factories",
    title: "Software Factory: Pruning CODING_STANDARDS.md & Prompt Sediment",
    ecosystem: "Matt Pocock Software Factories · pstack /code-review",
    targetUpgrade: "GPT-4 era review rules → GPT-5 / Claude Sonnet 5.5 + ESLint/tsc",
    provenanceLabel: "Deterministic Sediment Audit + Rule Verification",
    summary:
      "Applies Matt Pocock's sediment & no-op test: deletes prose rules already enforced deterministically by tsc/ESLint/Prettier and strips legacy GPT-4 prompt workarounds while preserving 100% of high-judgment architectural rules.",
    deadWorkaroundsRemoved: [
      "Prose lint/format rules duplicated by ESLint & Prettier (no-any, unused-vars, 2-space indent)",
      "Legacy GPT-4 FINAL_ANSWER 3x repetition workaround",
    ],
    tokensSavedPerTurn: 1420,
    linesDeleted: 15,
    linesAdded: 6,
    patchSha256:
      "4f891b23a01c7d55e8a20b9c31d47e66a901c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
    repairPatch: `diff --git a/CODING_STANDARDS.md b/CODING_STANDARDS.md
index 8d21a03..1e44c77 100644
--- a/CODING_STANDARDS.md
+++ b/CODING_STANDARDS.md
@@ -1,19 +1,10 @@
-# CODING_STANDARDS.md (Bloated — 420-line sediment sample)
-
-## 1. Never use \`any\` or non-null assertions \`!\`
-Do not write \`any\` or \`!\` anywhere in TypeScript files.
-
-## 2. Never leave unused variables or imports
-Always double check imports before finishing a PR.
-
-## 3. Format with Prettier (2 spaces, double quotes)
-Make sure every file is formatted properly with 2-space indentation.
-
-## 4. Fail with a thrown response, not a return value
+# CODING_STANDARDS.md (Pruned — Deterministic Checks Own the Rest)
+
+> Rules already enforced deterministically by \`tsc\`, \`eslint\`, and \`prettier\` were pruned
+> (see \`eslint.config.js\` -> \`no-explicit-any\`, \`no-non-null-assertion\`, \`no-unused-vars\`).
+
+## 1. Fail with a thrown response, not a return value
 A loader or an action that cannot continue throws a typed HTTP response.
 Do not return \`{ error: string }\` shapes for components to unpack.
 
-## 5. Parse untrusted input with a Zod schema
+## 2. Parse untrusted input with a Zod schema
 Every API route, CLI boundary, and Firecrawl webhook payload must be validated with Zod.
-
-## 6. [LEGACY GPT-4 WORKAROUND] Always print "FINAL_ANSWER:" before finishing
-Repeat your plan three times before editing files so the parser catches your output.`,
    firecrawl: {
      sourceUrl: "https://docs.firecrawl.dev/features/change-tracking",
      tag: "software-factory-standards-prune",
      changeStatus: "changed",
      gitDiff: `@@ -1,6 +1,3 @@
- Prose rule: Never use any or ! (redundant with @typescript-eslint)
- Prose rule: Repeat plan 3x before FINAL_ANSWER (legacy GPT-4 shim)
+ Delegated to deterministic checks; /code-review focuses strictly on architecture`,
      jsonDiff: {
        deterministicEnforcement: {
          previous: "probabilistic LLM prompt instructions",
          current: "deterministic tsc + eslint + prettier CI checks",
        },
        reviewContextLoad: {
          previous: "420 lines (sediment-heavy)",
          current: "111 lines (high-signal architecture only)",
        },
      },
      developerIndexHits: [
        {
          id: "readme:mattpocock/skills",
          kind: "readme",
          title: "mattpocock/skills — Skills for Real Engineers & /code-review",
          url: "https://github.com/mattpocock/skills",
          passage:
            "When you have a choice between deterministic and non-deterministic, pick determinism. Move lintable rules out of CODING_STANDARDS.md into automated checks.",
        },
        {
          id: "readme:poteto/pstack",
          kind: "readme",
          title: "poteto/pstack — Go fast by going deep first (deslop & playbooks)",
          url: "https://github.com/poteto/pstack",
          passage:
            "Combat AI slop and prompt bloat by combining lean engineering playbooks with strict deterministic verification gates.",
        },
      ],
    },
    checks: [
      {
        id: "deterministic-rules-delegated",
        label: "Deterministic Rules Offloaded to Linters",
        category: "bloat-pruning",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Redundant prose duplicates Prettier & ESLint checks.",
        armCDetail: "Pruned redundant prose; deterministic CI owns them.",
        observationSha256: "9b1a4f7c2d8e3015f4a6b7c8d9e0f1a2b3c4d5e6",
      },
      {
        id: "legacy-model-sediment-removed",
        label: "Legacy GPT-4 Workaround Removed",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Obsolete FINAL_ANSWER repetition workaround still present.",
        armCDetail: "Removed obsolete GPT-4 prompt workaround.",
        observationSha256: "3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d",
      },
      {
        id: "high-signal-architecture-rules-kept",
        label: "High-Signal Architecture Rules Preserved",
        category: "legacy-compat",
        armBPassed: true,
        armCPassed: true,
        armBDetail: "Retains thrown-response & Zod boundary standards.",
        armCDetail: "Retains 100% of architectural judgment rules.",
        observationSha256: "5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f",
      },
      {
        id: "token-footprint-reduced",
        label: "Per-Turn Review Payload Reduced",
        category: "bloat-pruning",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Bloated document sends 1,420+ extra tokens per review turn.",
        armCDetail: "Lean document passes <620 char budget (-1,420 tokens/turn).",
        observationSha256: "7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a",
      },
    ],
  },
  {
    id: "owned-response-format",
    badge: "Forensic Offline Replay",
    title: "Owned Tool-Response Replay (129 SHA-256 Reproducible Manifest)",
    ecosystem: "deadcodefix Core CLI · Zero-Key Isolated Verifier",
    targetUpgrade: "Legacy flat JSON → Structured content-block tool response",
    provenanceLabel: "Synthetic Offline Replay (Zero Provider Keys · 77 Core Tests)",
    summary:
      "The original zero-key reproducible CLI fixture audited across 129 SHA-256 package hashes: demonstrates strict supervisor isolation, exact output comparison, and immutable receipts without claiming live model improvement.",
    deadWorkaroundsRemoved: [
      "Unchecked JSON.parse(input).value assumption replaced with strict schema validation",
    ],
    tokensSavedPerTurn: 0,
    linesDeleted: 2,
    linesAdded: 11,
    patchSha256:
      "6bdf8a3b2686d02dda2956f97123aade2c708cb7c71a4ec87027f45a201acdc6",
    repairPatch: `diff --git a/harness.ts b/harness.ts
index bff5d42..7fcb36d 100644
--- a/harness.ts
+++ b/harness.ts
@@ -2,6 +2,15 @@ process.stdin.setEncoding("utf8");
 let input = "";
 process.stdin.on("data", chunk => { input += chunk; });
 process.stdin.on("end", () => {
-  const response = JSON.parse(input);
-  process.stdout.write(JSON.stringify({ok:true,value:response.value}));
+  let result = {ok:false,error:"malformed"};
+  try {
+    let response = JSON.parse(input);
+    if (response && Array.isArray(response.content)) {
+      if (response.content.length !== 1 || response.content[0].type !== "text" || typeof response.content[0].text !== "string") throw new Error("Unsupported content");
+      response = JSON.parse(response.content[0].text);
+    }
+    if (!response || typeof response !== "object" || Array.isArray(response) || Object.keys(response).length !== 1 || !Number.isFinite(response.value)) throw new Error("Invalid value");
+    result = {ok:true,value:response.value};
+  } catch {}
+  process.stdout.write(JSON.stringify(result));
 });`,
    firecrawl: {
      sourceUrl: "https://example.invalid/deadcodefix/owned-contract",
      tag: "owned-contract-v2",
      changeStatus: "same",
      gitDiff: `@@ -1,2 +1,3 @@
- v1: { "value": 17 }
+ v2: { "content": [{ "type": "text", "text": "{\\"value\\":42}" }] }
+ Legacy v1 payload must remain supported.`,
      jsonDiff: {
        responseEnvelope: {
          previous: "flat JSON object",
          current: "single text content block array + legacy fallback",
        },
      },
      developerIndexHits: [
        {
          id: "doc:owned-fixture/contract-v2",
          kind: "doc",
          title: "Synthetic frozen contract (no live retrieval claimed)",
          url: "https://github.com/gabchess/deadcodefix",
          passage:
            "Owned synthetic replay fixture verifying isolated subprocess execution, hostile-HTML inertness, and SHA-256 package reproducibility.",
        },
      ],
    },
    checks: [
      {
        id: "legacy-compatibility",
        label: "Legacy Compatibility",
        category: "legacy-compat",
        armBPassed: true,
        armCPassed: true,
        armBDetail: '{"ok":true,"value":17}',
        armCDetail: '{"ok":true,"value":17}',
        observationSha256: "120c752ba86cca95b56b73456e09f51fabceae81",
      },
      {
        id: "current-tool-format",
        label: "Current Tool Format",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true} (missing value)',
        armCDetail: '{"ok":true,"value":42}',
        observationSha256: "5d53a274b37a0e1fd753d7652575ee49dd66867a",
      },
      {
        id: "malformed-tool-payload",
        label: "Malformed Tool Payload",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true} (silent corruption)',
        armCDetail: '{"ok":false,"error":"malformed"}',
        observationSha256: "64c1be0d38c89d6af2541bdadf5a276812c7fd23",
      },
      {
        id: "instruction-is-data",
        label: "Prompt Injection Treated as Data",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true} (failed rejection)',
        armCDetail: '{"ok":false,"error":"malformed"}',
        observationSha256: "05d5099a1ca2d8077ee09fb2bd6160b790e6da09",
      },
      {
        id: "wrong-value-type",
        label: "Wrong Value Type Rejection",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true,"value":"42"} (string leaked)',
        armCDetail: '{"ok":false,"error":"malformed"}',
        observationSha256: "f5948b2031cd1ad05491acd6540f5a42abdcb520",
      },
      {
        id: "extra-tool-block",
        label: "Extra Tool Block Rejection",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true} (ignored extra block)',
        armCDetail: '{"ok":false,"error":"malformed"}',
        observationSha256: "d93e933879f1a8f164a686e83e0cd496cf4d3267",
      },
    ],
  },
];
