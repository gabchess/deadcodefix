import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertSafePublicUrl,
  buildLiveEvidenceBundle,
  mapDocumentationSite,
  searchDeveloperIndex,
  trackDocumentationDrift,
  type FirecrawlTransport,
} from "../src/firecrawl/drift.ts";

function createFakeTransport(
  overrides: Partial<FirecrawlTransport> = {},
): FirecrawlTransport {
  return {
    async scrapeWithChangeTracking({ url }) {
      const markdown =
        "# Migration Guide\n\n`tool({ parameters })` was renamed to `inputSchema`.\n`maxSteps` was replaced by `stopWhen: stepCountIs(5)`.";
      return {
        markdown,
        metadata: { sourceURL: url, url },
        changeTracking: {
          previousScrapeAt: "2026-11-20T12:00:00.000Z",
          changeStatus: "changed",
          visibility: "visible",
          diff: {
            text: "- parameters: z.object(...)\n+ inputSchema: z.object(...)",
          },
          json: {
            toolSchemaProperty: {
              previous: "parameters",
              current: "inputSchema",
            },
          },
        },
        json: {
          sdkOrHarness: "ai",
          versionRange: "4.x -> 6.x",
          breakingChanges: [
            {
              symbol: "tool.parameters",
              changeKind: "renamed",
              summary: "Renamed to inputSchema",
              migrationAction: "Replace parameters with inputSchema",
            },
          ],
          obsoleteWorkarounds: ["regex markdown fence stripper"],
        },
      };
    },
    async searchDeveloperIndex() {
      return {
        results: [
          {
            id: "issue:vercel/ai#101",
            url: "https://github.com/vercel/ai/issues/101",
            title: "tool parameters renamed to inputSchema",
            description: "Breaking change in AI SDK 5+",
            passages: [
              "Rename `parameters` to `inputSchema` in every `tool()` definition.",
            ],
            position: 1,
            category: "developer",
          },
          {
            id: "web:internal",
            url: "http://127.0.0.1/internal-secret",
            title: "Unsafe internal URL",
            description: "Must be dropped by SSRF guard",
            passages: [],
            position: 2,
            category: "developer",
          },
        ],
      };
    },
    async mapSite() {
      return {
        links: [
          "https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0",
          { url: "https://ai-sdk.dev/docs/reference/ai-sdk-core/tool" },
          "https://evil.example.org/phish",
        ],
      };
    },
    ...overrides,
  };
}

test("assertSafePublicUrl blocks private IPs, localhost, credentials, and non-allowlisted hosts", () => {
  assert.equal(
    assertSafePublicUrl("https://ai-sdk.dev/docs", ["ai-sdk.dev"]).hostname,
    "ai-sdk.dev",
  );
  for (const bad of [
    "http://ai-sdk.dev/docs",
    "https://localhost/admin",
    "https://127.0.0.1/secret",
    "https://169.254.169.254/latest/meta-data",
    "https://user:pass@ai-sdk.dev/docs",
    "https://ai-sdk.dev:8443/docs",
    "https://not-allowed.example.com/docs",
  ]) {
    assert.throws(() => assertSafePublicUrl(bad, ["ai-sdk.dev"]));
  }
});

test("trackDocumentationDrift hashes markdown bytes and extracts git-diff + json field diffs", async () => {
  const transport = createFakeTransport();
  const receipt = await trackDocumentationDrift(transport, {
    url: "https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0",
    tag: "ai-sdk-v6",
    allowedHosts: ["ai-sdk.dev"],
  });
  assert.equal(receipt.changeStatus, "changed");
  assert.match(receipt.gitDiff ?? "", /\+ inputSchema/);
  assert.deepEqual(receipt.jsonFieldDiffs.toolSchemaProperty, {
    previous: "parameters",
    current: "inputSchema",
  });
  assert.equal(receipt.extraction?.sdkOrHarness, "ai");
  const expectedSha = createHash("sha256")
    .update(
      "# Migration Guide\n\n`tool({ parameters })` was renamed to `inputSchema`.\n`maxSteps` was replaced by `stopWhen: stepCountIs(5)`.",
      "utf8",
    )
    .digest("hex");
  assert.equal(receipt.contentSha256, expectedSha);
});

test("trackDocumentationDrift fails closed when redirect finalUrl escapes allowlist", async () => {
  const transport = createFakeTransport({
    async scrapeWithChangeTracking() {
      return {
        markdown: "redirected",
        metadata: { url: "https://attacker.example.com/evil" },
      };
    },
  });
  await assert.rejects(
    () =>
      trackDocumentationDrift(transport, {
        url: "https://ai-sdk.dev/docs",
        tag: "redirect-check",
        allowedHosts: ["ai-sdk.dev"],
      }),
    /not in the allowed host list/,
  );
});

test("searchDeveloperIndex drops unsafe URLs and SHA-256 fingerprints valid hits", async () => {
  const hits = await searchDeveloperIndex(createFakeTransport(), {
    query: "ai sdk tool inputSchema pi coding agent",
    limit: 5,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "https://github.com/vercel/ai/issues/101");
  assert.match(hits[0].sha256, /^[a-f0-9]{64}$/);
});

test("mapDocumentationSite filters links to allowlisted hosts", async () => {
  const mapped = await mapDocumentationSite(createFakeTransport(), {
    url: "https://ai-sdk.dev/docs",
    search: "migration",
    allowedHosts: ["ai-sdk.dev"],
  });
  assert.equal(mapped.matchedUrls.length, 2);
  assert.ok(
    mapped.matchedUrls.every((u) => u.startsWith("https://ai-sdk.dev/")),
  );
});

test("buildLiveEvidenceBundle combines drift, map, and developer hits with bundle hash", async () => {
  const bundle = await buildLiveEvidenceBundle(createFakeTransport(), {
    caseId: "pi-sdk-tool-upgrade",
    docUrls: ["https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0"],
    mapSeedUrl: "https://ai-sdk.dev/docs",
    mapSearch: "migration",
    developerQuery: "vercel ai tool inputSchema",
    tag: "pi-v6",
    allowedHosts: ["ai-sdk.dev"],
  });
  assert.equal(bundle.mode, "live");
  assert.equal(bundle.driftReceipts.length, 1);
  assert.equal(bundle.developerHits.length, 1);
  assert.equal(bundle.mappedUrls.length, 2);
  assert.equal(bundle.omissions.length, 0);
  assert.match(bundle.bundleSha256, /^[a-f0-9]{64}$/);
});
