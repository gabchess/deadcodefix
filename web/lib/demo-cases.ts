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
  verificationKind: "static-contract" | "isolated-replay";
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
    verificationKind: "static-contract",
    title: "Pi / pi-pstack Harness: AI SDK v4 → v6+ Upgrade & Dead-Shim Removal",
    ecosystem: "Pi Coding Agent · pi-pstack · Vercel AI SDK",
    targetUpgrade: "ai@4.x → ai@6.x + openai/gpt-5-mini",
    provenanceLabel: "Synthetic Replay · Static Contract Checks + Git-Verified Patch",
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
      "c425c9292b5611dd74f093c4cbda87926ddf90faa33560a756788766b1c789ca",
    repairPatch: `diff --git a/tool-adapter.ts b/tool-adapter.ts
index 373c9ea..6f9fd25 100644
--- a/tool-adapter.ts
+++ b/tool-adapter.ts
@@ -1,28 +1,25 @@
-// pi-pstack tool-loop adapter (AI SDK v4 legacy harness)
-import { generateText, tool } from "ai";
+// pi-pstack tool-loop adapter (AI SDK v6+ repaired & pruned)
+import { generateText, stepCountIs, tool } from "ai";
 import { z } from "zod";
 
-// DEAD WORKAROUND (2024): strip markdown fences around JSON tool payloads
-export function stripLegacyMarkdownFences(raw: string): string {
-  const fenced = raw.match(/\\\`\\\`\\\`(?:json)?\\s*([\\s\\S]*?)\\\`\\\`\\\`/i);
-  return fenced ? fenced[1].trim() : raw.trim();
-}
+export const SYSTEM_PROMPT =
+  "You are a Pi coding agent running pstack playbooks. Return schema-valid tool calls.";
 
-export const SYSTEM_PROMPT_SEDIMENT = [
-  "You are a Pi coding agent running pstack playbooks.",
-  "CRITICAL: NEVER wrap tool JSON in triple backticks.",
-  "CRITICAL: ALWAYS repeat the schema keys in exact order.",
-  "CRITICAL: If the tool returns an array, ignore extra fields.",
-].join("\\n");
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
@@ -31,9 +28,14 @@ export function buildPiToolConfig() {
 
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
`,
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
          id: "doc:vercel/ai/packages/harness-pi/README.md",
          kind: "doc",
          title: "AI SDK — Pi Harness (@ai-sdk/harness-pi using inputSchema)",
          url: "https://github.com/vercel/ai/blob/04a8f3837e7cf350358f2a084507445ab3e15f11/packages/harness-pi/README.md",
          passage:
            "HarnessV1 adapter backed by @earendil-works/pi-coding-agent. Defines tools with tool({ description, inputSchema: z.object(...), execute }).",
        },
        {
          id: "doc:ai-sdk.dev/docs/migration-guides/migration-guide-5-0",
          kind: "doc",
          title: "Vercel AI SDK — Tool parameters renamed to inputSchema",
          url: "https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0",
          passage:
            "In AI SDK 5+, `parameters` in `tool()` was renamed to `inputSchema` aligned with MCP, and `maxSteps` was replaced by `stopWhen: stepCountIs(N)`.",
        },
      ],
    },
    checks: [
      {
        id: "v6-input-schema-contract",
        label: "AI SDK v6+ inputSchema Contract (Static)",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Still uses removed AI SDK v4 parameters property.",
        armCDetail: "Uses AI SDK v5+/v6+ inputSchema on tool().",
        observationSha256:
          "c172322f537083b689091317ede6c26e1b3129aec639d5e1acef8b08eddfac85",
      },
      {
        id: "stop-when-step-guard",
        label: "Loop Guard stopWhen: stepCountIs (Static)",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Still uses removed maxSteps option.",
        armCDetail: "Uses stopWhen: stepCountIs(5) loop guard.",
        observationSha256:
          "11d495868718faea3e52f19a60c8dee8e46ac70a05c808b17d7befb0a4b9f580",
      },
      {
        id: "mcp-content-block-parsing",
        label: "Structured MCP Content Block Schema (Static)",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Fails to unwrap structured text content blocks.",
        armCDetail: "Handles structured MCP content blocks cleanly.",
        observationSha256:
          "832ca8f31f83f97c1b22aec91b1aaaebc2b64403abea1cd969b63cf5581cadad",
      },
      {
        id: "legacy-v1-compat",
        label: "Legacy v1 Caller Compatibility (Static)",
        category: "legacy-compat",
        armBPassed: true,
        armCPassed: true,
        armBDetail: "Preserves legacy { value: 17 } payload compatibility.",
        armCDetail: "Preserves legacy { value: 17 } payload compatibility.",
        observationSha256:
          "d5bbeb09b2ba4a65456eb50178371491a1e547890f7eea3558a2271b47dc726a",
      },
      {
        id: "adversarial-injection-fence-hardening",
        label: "Dead Regex Fence Shim Removal (Static)",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail:
          "Vulnerable: regex fence extractor executes attacker-injected fenced JSON inside strings.",
        armCDetail:
          "Removed dead regex fence shim; strict Zod schema rejects injected blocks.",
        observationSha256:
          "3e1967e08b46587abef4823738e3510c37381d45fbb5ec82d2debc4b3bfce7b7",
      },
      {
        id: "dead-prompt-sediment-pruned",
        label: "Dead Prompt Sediment Pruned (Static)",
        category: "bloat-pruning",
        armBPassed: false,
        armCPassed: true,
        armBDetail:
          "Bloated: 3 obsolete prompt workaround lines still billed on every turn.",
        armCDetail: "Pruned obsolete prompt workarounds (-310 tokens/turn).",
        observationSha256:
          "c08f1933744742aa752ae8d6a8edf753fde3e0ff0dc8c14847560e9b76e0b7f5",
      },
    ],
  },
  {
    id: "matt-coding-standards-prune",
    badge: "Software Factories",
    verificationKind: "static-contract",
    title: "Software Factory: Pruning CODING_STANDARDS.md & Prompt Sediment",
    ecosystem: "Matt Pocock Software Factories · pstack /code-review",
    targetUpgrade:
      "GPT-4 era review rules → GPT-5 / Claude Sonnet 5.5 + ESLint/tsc",
    provenanceLabel: "Synthetic Replay · Static Sediment Checks + Git-Verified Patch",
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
      "341666166da8f152d2b01c2f8b9005741c7efa29a9f2003e0fb97b304f0bfcb1",
    repairPatch: `diff --git a/CODING_STANDARDS.md b/CODING_STANDARDS.md
index 6d45936..2301eca 100644
--- a/CODING_STANDARDS.md
+++ b/CODING_STANDARDS.md
@@ -1,20 +1,11 @@
-# CODING_STANDARDS.md (Bloated — 420-line sediment sample)
+# CODING_STANDARDS.md (Pruned — Deterministic Checks Own the Rest)
 
-## 1. Never use \`any\` or non-null assertions \`!\`
-Do not write \`any\` or \`!\` anywhere in TypeScript files.
+> Rules already enforced deterministically by \`tsc\`, \`eslint\`, and \`prettier\` were pruned
+> (see \`eslint.config.js\` -> \`no-explicit-any\`, \`no-non-null-assertion\`, \`no-unused-vars\`).
 
-## 2. Never leave unused variables or imports
-Always double check imports before finishing a PR.
-
-## 3. Format with Prettier (2 spaces, double quotes)
-Make sure every file is formatted properly with 2-space indentation.
-
-## 4. Fail with a thrown response, not a return value
+## 1. Fail with a thrown response, not a return value
 A loader or an action that cannot continue throws a typed HTTP response.
 Do not return \`{ error: string }\` shapes for components to unpack.
 
-## 5. Parse untrusted input with a Zod schema
+## 2. Parse untrusted input with a Zod schema
 Every API route, CLI boundary, and Firecrawl webhook payload must be validated with Zod.
-
-## 6. [LEGACY GPT-4 WORKAROUND] Always print "FINAL_ANSWER:" before finishing
-Repeat your plan three times before editing files so the parser catches your output.
`,
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
        label: "Deterministic Rules Offloaded to Linters (Static)",
        category: "bloat-pruning",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Redundant prose duplicates Prettier/ESLint checks.",
        armCDetail:
          "Redundant lint/format prose pruned; deterministic tooling owns them.",
        observationSha256:
          "dc057bd4ec762153e01f22e81245ee283ce0c7fdaf6bafb1ba2223993fb1d9f5",
      },
      {
        id: "legacy-model-sediment-removed",
        label: "Legacy GPT-4 Workaround Removed (Static)",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Obsolete GPT-4 prompt workaround still present.",
        armCDetail: "Removed obsolete GPT-4 workaround rule.",
        observationSha256:
          "0a19e8e7b960dc452bcb35922f4b232f9048cf1e470ea66cdbfd1ccff87aaf7c",
      },
      {
        id: "high-signal-architecture-rules-kept",
        label: "High-Signal Architecture Rules Preserved (Static)",
        category: "legacy-compat",
        armBPassed: true,
        armCPassed: true,
        armBDetail:
          "Preserved core architectural judgment rules for /code-review.",
        armCDetail:
          "Preserved core architectural judgment rules for /code-review.",
        observationSha256:
          "f041266e3b48e8e3cd6c2b1f285d631d4759fc13114119da953198e5566c6538",
      },
      {
        id: "token-footprint-reduced",
        label: "Per-Turn Review Payload Reduced (Static)",
        category: "bloat-pruning",
        armBPassed: false,
        armCPassed: true,
        armBDetail: "Bloated document sends 1,420+ extra tokens per turn.",
        armCDetail: "Document size passes <620 char budget (-1,420 tokens/turn).",
        observationSha256:
          "c933797cf1c75801fab673e7e1c0f9e803a7e18d7b9c11126306246eb210d4ee",
      },
    ],
  },
  {
    id: "owned-response-format",
    badge: "Forensic Offline Replay",
    verificationKind: "isolated-replay",
    title: "Owned Tool-Response Replay (129 SHA-256 Reproducible Manifest)",
    ecosystem: "deadcodefix Core CLI · Zero-Key Isolated Verifier",
    targetUpgrade: "Legacy flat JSON → Structured content-block tool response",
    provenanceLabel:
      "Synthetic Offline Replay (Zero Provider Keys · 77 Core Isolated Tests)",
    summary:
      "The original zero-key reproducible CLI fixture audited across 129 SHA-256 package hashes: demonstrates strict out-of-process supervisor isolation, exact output comparison, and immutable receipts without claiming live model improvement.",
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
        label: "Legacy Compatibility (Isolated Subprocess)",
        category: "legacy-compat",
        armBPassed: true,
        armCPassed: true,
        armBDetail: '{"ok":true,"value":17}',
        armCDetail: '{"ok":true,"value":17}',
        observationSha256:
          "120c752ba86cca95b56b73456e09f51fabceae81cf30a3c5e6cc68fa3c861eb3",
      },
      {
        id: "current-tool-format",
        label: "Current Tool Format (Isolated Subprocess)",
        category: "upgrade",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true} (missing value)',
        armCDetail: '{"ok":true,"value":42}',
        observationSha256:
          "5d53a274b37a0e1fd753d7652575ee49dd66867af08c6e828825097dc8f25476",
      },
      {
        id: "malformed-tool-payload",
        label: "Malformed Tool Payload (Isolated Subprocess)",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true} (silent corruption)',
        armCDetail: '{"ok":false,"error":"malformed"}',
        observationSha256:
          "64c1be0d38c89d6af2541bdadf5a276812c7fd23716af6fc6708f9c93b753536",
      },
      {
        id: "instruction-is-data",
        label: "Prompt Injection Treated as Data (Isolated Subprocess)",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true} (failed rejection)',
        armCDetail: '{"ok":false,"error":"malformed"}',
        observationSha256:
          "05d5099a1ca2d8077ee09fb2bd6160b790e6da09a43b3fc58718486efc5e579c",
      },
      {
        id: "wrong-value-type",
        label: "Wrong Value Type Rejection (Isolated Subprocess)",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true,"value":"42"} (string leaked)',
        armCDetail: '{"ok":false,"error":"malformed"}',
        observationSha256:
          "f5948b2031cd1ad05491acd6540f5a42abdcb520a1add762135a862353e4163d",
      },
      {
        id: "extra-tool-block",
        label: "Extra Tool Block Rejection (Isolated Subprocess)",
        category: "security",
        armBPassed: false,
        armCPassed: true,
        armBDetail: '{"ok":true} (ignored extra block)',
        armCDetail: '{"ok":false,"error":"malformed"}',
        observationSha256:
          "d93e933879f1a8f164a686e83e0cd496cf4d3267190ffcbc74d4cca46499d5da",
      },
    ],
  },
];
