import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { Firecrawl } from "firecrawl";

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

const MAX_RETAINED_BYTES = 2 * 1024 * 1024;
const MAX_PAGES_PER_RUN = 20;

export const BreakingChangeItemSchema = z.object({
  symbol: z.string(),
  changeKind: z.enum([
    "renamed",
    "removed",
    "deprecated",
    "behavior_changed",
    "native_replacement",
  ]),
  summary: z.string(),
  migrationAction: z.string(),
});

export const DocDriftExtractionSchema = z.object({
  sdkOrHarness: z.string(),
  versionRange: z.string(),
  breakingChanges: z.array(BreakingChangeItemSchema),
  obsoleteWorkarounds: z.array(z.string()),
});

export type DocDriftExtraction = z.infer<typeof DocDriftExtractionSchema>;

export const ChangeTrackingResultSchema = z.object({
  previousScrapeAt: z.string().nullable().optional(),
  changeStatus: z.enum(["new", "same", "changed", "removed"]),
  visibility: z.enum(["visible", "hidden"]).optional(),
  diff: z
    .object({
      text: z.string(),
    })
    .optional(),
  json: z
    .record(
      z.string(),
      z.object({
        previous: z.unknown(),
        current: z.unknown(),
      }),
    )
    .optional(),
});

export interface DocDriftReceipt {
  schemaVersion: 1;
  url: string;
  finalUrl: string;
  retrievedAt: string;
  tag: string;
  mode: "live" | "replay";
  changeStatus: "new" | "same" | "changed" | "removed" | "unavailable";
  previousScrapeAt: string | null;
  gitDiff: string | null;
  jsonFieldDiffs: Record<string, { previous: unknown; current: unknown }>;
  markdownExcerpt: string;
  contentSha256: string;
  bytesRetained: number;
  extraction: DocDriftExtraction | null;
}

export interface DeveloperDriftHit {
  id: string;
  kind: "doc" | "issue" | "pull_request" | "readme" | "web";
  url: string;
  title: string;
  description: string;
  passages: string[];
  category: "developer";
  position: number;
  sha256: string;
}

export interface SiteMapReceipt {
  baseUrl: string;
  retrievedAt: string;
  matchedUrls: string[];
  sha256: string;
}

export interface FirecrawlEvidenceBundle {
  schemaVersion: 1;
  bundleId: string;
  caseId: string;
  createdAt: string;
  mode: "live" | "replay";
  driftReceipts: DocDriftReceipt[];
  developerHits: DeveloperDriftHit[];
  mappedUrls: string[];
  omissions: string[];
  bundleSha256: string;
}

export interface FirecrawlTransport {
  scrapeWithChangeTracking(input: {
    url: string;
    tag: string;
    prompt: string;
    schema: Record<string, unknown>;
  }): Promise<{
    markdown?: string;
    metadata?: { sourceURL?: string; url?: string; title?: string };
    changeTracking?: unknown;
    json?: unknown;
  }>;
  searchDeveloperIndex(input: {
    query: string;
    limit: number;
    types?: ReadonlyArray<"doc" | "issue" | "pull_request" | "readme">;
    skillsOnly?: boolean;
    passages?: number;
  }): Promise<{
    results?: Array<{
      id?: string;
      url?: string;
      title?: string;
      description?: string;
      passages?: string[];
      position?: number;
      category?: string;
    }>;
  }>;
  mapSite(input: { url: string; search?: string; limit: number }): Promise<{
    links?: Array<string | { url?: string }>;
  }>;
}

export function assertSafePublicUrl(
  rawUrl: string,
  allowedHosts?: readonly string[],
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  const host = parsed.hostname.toLowerCase();
  const bareHost = host.replace(/^\[|\]$/g, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    isIP(bareHost) !== 0 ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".arpa")
  ) {
    throw new Error(`Unsafe or non-public URL rejected: ${rawUrl}`);
  }
  if (allowedHosts && allowedHosts.length > 0) {
    const normalizedAllowed = allowedHosts.map((h) => h.toLowerCase());
    const matches = normalizedAllowed.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
    if (!matches) {
      throw new Error(`Host ${host} is not in the allowed host list`);
    }
  }
  return parsed;
}

export const DRIFT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    sdkOrHarness: { type: "string" },
    versionRange: { type: "string" },
    breakingChanges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          changeKind: {
            type: "string",
            enum: [
              "renamed",
              "removed",
              "deprecated",
              "behavior_changed",
              "native_replacement",
            ],
          },
          summary: { type: "string" },
          migrationAction: { type: "string" },
        },
        required: ["symbol", "changeKind", "summary", "migrationAction"],
      },
    },
    obsoleteWorkarounds: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "sdkOrHarness",
    "versionRange",
    "breakingChanges",
    "obsoleteWorkarounds",
  ],
};

export function createFirecrawlTransport(apiKey: string): FirecrawlTransport {
  if (!apiKey || apiKey.trim().length < 5) {
    throw new Error(
      "Missing FIRECRAWL_API_KEY. Set it in .env.local or pass a key at runtime.",
    );
  }
  const client = new Firecrawl({ apiKey: apiKey.trim() });

  return {
    async scrapeWithChangeTracking({ url, tag, prompt, schema }) {
      const response = await client.scrape(url, {
        formats: [
          "markdown",
          {
            type: "json",
            prompt,
            schema,
          } as unknown as "json",
          {
            type: "changeTracking",
            modes: ["git-diff", "json"],
            prompt,
            schema,
            tag,
          } as unknown as "changeTracking",
        ],
      });
      return {
        markdown:
          typeof response.markdown === "string" ? response.markdown : undefined,
        metadata: response.metadata as
          { sourceURL?: string; url?: string; title?: string } | undefined,
        changeTracking: (response as { changeTracking?: unknown })
          .changeTracking,
        json: (response as { json?: unknown }).json,
      };
    },

    async searchDeveloperIndex({ query, limit, types, skillsOnly, passages }) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey.trim().length > 0) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
      }
      const body: Record<string, unknown> = {
        query,
        k: limit,
        passages: passages ?? 2,
      };
      if (types && types.length > 0) body.types = [...types];
      if (skillsOnly) body.skills = "only";

      const res = await fetch("https://api.firecrawl.dev/v2/search/developer", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        throw new Error(`Firecrawl Developer Index HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        results?: Array<{
          id?: string;
          url?: string;
          title?: string;
          description?: string;
          passages?: Array<string | { text?: string; markdown?: string }>;
        }>;
        data?: Array<{
          id?: string;
          url?: string;
          title?: string;
          description?: string;
          passages?: Array<string | { text?: string; markdown?: string }>;
        }>;
      };
      const items = data.results ?? data.data ?? [];
      return {
        results: items.map((item, idx) => ({
          id: item.id,
          url: item.url,
          title: item.title,
          description: item.description,
          passages: (item.passages ?? [])
            .map((p) =>
              typeof p === "string" ? p : (p.markdown ?? p.text ?? ""),
            )
            .filter((p) => p.length > 0),
          position: idx + 1,
          category: "developer",
        })),
      };
    },

    async mapSite({ url, search, limit }) {
      const result = await client.map(url, { search, limit });
      return {
        links: Array.isArray(result.links)
          ? (result.links as Array<string | { url?: string }>)
          : [],
      };
    },
  };
}

export async function trackDocumentationDrift(
  transport: FirecrawlTransport,
  input: {
    url: string;
    tag: string;
    prompt?: string;
    allowedHosts?: readonly string[];
  },
): Promise<DocDriftReceipt> {
  const safeUrl = assertSafePublicUrl(input.url, input.allowedHosts);
  const prompt =
    input.prompt ??
    "Extract SDK/harness breaking changes, renamed or removed parameters, and legacy workarounds that are now obsolete.";

  const raw = await transport.scrapeWithChangeTracking({
    url: safeUrl.toString(),
    tag: input.tag,
    prompt,
    schema: DRIFT_JSON_SCHEMA,
  });

  const markdown = typeof raw.markdown === "string" ? raw.markdown : "";
  const bytesRetained = Buffer.byteLength(markdown, "utf8");
  if (bytesRetained > MAX_RETAINED_BYTES) {
    throw new Error(
      `Retained documentation exceeds 2 MiB limit (${bytesRetained} bytes)`,
    );
  }

  const finalUrlCandidate =
    raw.metadata?.url ?? raw.metadata?.sourceURL ?? safeUrl.toString();
  const safeFinalUrl = assertSafePublicUrl(
    finalUrlCandidate,
    input.allowedHosts,
  );

  const parsedTracking = ChangeTrackingResultSchema.safeParse(
    raw.changeTracking,
  );
  const parsedExtraction = DocDriftExtractionSchema.safeParse(raw.json);

  return {
    schemaVersion: 1,
    url: safeUrl.toString(),
    finalUrl: safeFinalUrl.toString(),
    retrievedAt: new Date().toISOString(),
    tag: input.tag,
    mode: "live",
    changeStatus: parsedTracking.success
      ? parsedTracking.data.changeStatus
      : "unavailable",
    previousScrapeAt: parsedTracking.success
      ? (parsedTracking.data.previousScrapeAt ?? null)
      : null,
    gitDiff:
      parsedTracking.success && parsedTracking.data.diff?.text
        ? parsedTracking.data.diff.text
        : null,
    jsonFieldDiffs:
      parsedTracking.success && parsedTracking.data.json
        ? parsedTracking.data.json
        : {},
    markdownExcerpt: markdown.slice(0, 1200),
    contentSha256: sha256(markdown),
    bytesRetained,
    extraction: parsedExtraction.success ? parsedExtraction.data : null,
  };
}

function inferHitKind(id: string | undefined): DeveloperDriftHit["kind"] {
  if (!id) return "doc";
  if (id.startsWith("issue:")) return "issue";
  if (id.startsWith("pull_request:")) return "pull_request";
  if (id.startsWith("readme:")) return "readme";
  if (id.startsWith("web:")) return "web";
  return "doc";
}

export async function searchDeveloperIndex(
  transport: FirecrawlTransport,
  input: {
    query: string;
    limit?: number;
    types?: ReadonlyArray<"doc" | "issue" | "pull_request" | "readme">;
    skillsOnly?: boolean;
    passages?: number;
  },
): Promise<DeveloperDriftHit[]> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const raw = await transport.searchDeveloperIndex({
    query: input.query.trim(),
    limit,
    types: input.types,
    skillsOnly: input.skillsOnly,
    passages: input.passages ?? 2,
  });
  const hits: DeveloperDriftHit[] = [];
  for (const [idx, item] of (raw.results ?? []).entries()) {
    if (!item.url) continue;
    try {
      const safe = assertSafePublicUrl(item.url);
      const title = (item.title ?? safe.toString()).trim();
      const passages = (item.passages ?? []).slice(0, 3);
      const description = (
        item.description ??
        passages[0]?.slice(0, 280) ??
        ""
      ).trim();
      const id = item.id ?? `doc:${safe.hostname}${safe.pathname}`;
      hits.push({
        id,
        kind: inferHitKind(id),
        url: safe.toString(),
        title,
        description,
        passages,
        category: "developer",
        position: item.position ?? idx + 1,
        sha256: sha256(
          `${id}\n${safe.toString()}\n${title}\n${passages.join("\n")}`,
        ),
      });
    } catch {
      // Drop any unsafe or malformed URL returned by upstream search
    }
  }
  return hits;
}

export async function mapDocumentationSite(
  transport: FirecrawlTransport,
  input: {
    url: string;
    search?: string;
    limit?: number;
    allowedHosts?: readonly string[];
  },
): Promise<SiteMapReceipt> {
  const safeBase = assertSafePublicUrl(input.url, input.allowedHosts);
  const limit = Math.min(Math.max(input.limit ?? 15, 1), MAX_PAGES_PER_RUN);
  const raw = await transport.mapSite({
    url: safeBase.toString(),
    search: input.search,
    limit,
  });
  const matchedUrls: string[] = [];
  for (const entry of raw.links ?? []) {
    const candidate = typeof entry === "string" ? entry : entry.url;
    if (!candidate) continue;
    try {
      const verified = assertSafePublicUrl(candidate, input.allowedHosts);
      matchedUrls.push(verified.toString());
    } catch {
      // Skip links outside allowlist or unsafe schemes
    }
  }
  const unique = [...new Set(matchedUrls)].slice(0, limit);
  return {
    baseUrl: safeBase.toString(),
    retrievedAt: new Date().toISOString(),
    matchedUrls: unique,
    sha256: sha256(unique.join("\n")),
  };
}

export async function buildLiveEvidenceBundle(
  transport: FirecrawlTransport,
  input: {
    caseId: string;
    docUrls: readonly string[];
    mapSeedUrl?: string;
    mapSearch?: string;
    developerQuery: string;
    tag: string;
    allowedHosts?: readonly string[];
  },
): Promise<FirecrawlEvidenceBundle> {
  if (input.docUrls.length === 0 || input.docUrls.length > MAX_PAGES_PER_RUN) {
    throw new Error(
      `docUrls must contain between 1 and ${MAX_PAGES_PER_RUN} URLs`,
    );
  }
  const omissions: string[] = [];
  const driftReceipts: DocDriftReceipt[] = [];

  for (const url of input.docUrls) {
    try {
      const receipt = await trackDocumentationDrift(transport, {
        url,
        tag: input.tag,
        allowedHosts: input.allowedHosts,
      });
      if (receipt.changeStatus === "unavailable") {
        omissions.push(`Change tracking unavailable for ${url}`);
      }
      driftReceipts.push(receipt);
    } catch (error) {
      omissions.push(
        `Failed drift scrape for ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let mappedUrls: string[] = [];
  if (input.mapSeedUrl) {
    try {
      const mapped = await mapDocumentationSite(transport, {
        url: input.mapSeedUrl,
        search: input.mapSearch,
        limit: 12,
        allowedHosts: input.allowedHosts,
      });
      mappedUrls = mapped.matchedUrls;
    } catch (error) {
      omissions.push(
        `Map failed for ${input.mapSeedUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let developerHits: DeveloperDriftHit[] = [];
  try {
    developerHits = await searchDeveloperIndex(transport, {
      query: input.developerQuery,
      limit: 8,
    });
  } catch (error) {
    omissions.push(
      `Developer Index search failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const createdAt = new Date().toISOString();
  const payload = {
    schemaVersion: 1 as const,
    bundleId: `fc-${input.caseId}-${sha256(createdAt + input.caseId).slice(0, 10)}`,
    caseId: input.caseId,
    createdAt,
    mode: "live" as const,
    driftReceipts,
    developerHits,
    mappedUrls,
    omissions,
  };
  return {
    ...payload,
    bundleSha256: sha256(JSON.stringify(payload)),
  };
}
