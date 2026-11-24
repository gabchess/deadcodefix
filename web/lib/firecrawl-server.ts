import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { Firecrawl } from "firecrawl";
import { z } from "zod";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function cleanSecret(value: string | undefined): string {
  return value ? value.replace(/[^\x21-\x7e]/g, "").trim() : "";
}

export function assertSafePublicUrl(rawUrl: string): URL {
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
    throw new Error(
      "Only public HTTPS URLs without credentials or private hosts are allowed.",
    );
  }
  return parsed;
}

export const DeveloperSearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(240),
  limit: z.number().int().min(1).max(12).optional().default(6),
  skillsOnly: z.boolean().optional().default(false),
  types: z
    .array(z.enum(["doc", "issue", "pull_request", "readme"]))
    .optional(),
  byokApiKey: z.string().trim().max(200).optional(),
});

export interface DeveloperSearchHit {
  id: string;
  kind: "doc" | "issue" | "pull_request" | "readme" | "web";
  url: string;
  title: string;
  passages: string[];
  sha256: string;
}

function inferKind(id: string | undefined): DeveloperSearchHit["kind"] {
  if (!id) return "doc";
  if (id.startsWith("issue:")) return "issue";
  if (id.startsWith("pull_request:")) return "pull_request";
  if (id.startsWith("readme:")) return "readme";
  if (id.startsWith("web:")) return "web";
  return "doc";
}

export async function runDeveloperIndexSearch(
  input: z.infer<typeof DeveloperSearchRequestSchema>,
): Promise<{
  mode: "live-keyed" | "live-keyless";
  query: string;
  skillsOnly: boolean;
  retrievedAt: string;
  partial: boolean;
  coverage: Record<string, string> | null;
  hits: DeveloperSearchHit[];
  receiptSha256: string;
}> {
  const apiKey =
    cleanSecret(input.byokApiKey) || cleanSecret(process.env.FIRECRAWL_API_KEY);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey.length > 0) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body: Record<string, unknown> = {
    query: input.query,
    k: input.limit,
    passages: 2,
  };
  if (input.skillsOnly) {
    body.skills = "only";
  } else if (input.types && input.types.length > 0) {
    body.types = input.types;
  }

  const response = await fetch("https://api.firecrawl.dev/v2/search/developer", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Firecrawl Developer Index returned HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`,
    );
  }

  const json = (await response.json()) as {
    partial?: boolean;
    coverage?: Record<string, string>;
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

  const rawItems = json.results ?? json.data ?? [];
  const hits: DeveloperSearchHit[] = [];

  for (const item of rawItems) {
    if (!item.url) continue;
    try {
      const safe = assertSafePublicUrl(item.url);
      const passages = (item.passages ?? [])
        .map((p) => (typeof p === "string" ? p : (p.markdown ?? p.text ?? "")))
        .filter((p) => p.length > 0)
        .slice(0, 2);
      if (passages.length === 0 && item.description) {
        passages.push(item.description);
      }
      const id = item.id ?? `doc:${safe.hostname}${safe.pathname}`;
      const title = (item.title ?? safe.toString()).trim();
      hits.push({
        id,
        kind: inferKind(id),
        url: safe.toString(),
        title,
        passages,
        sha256: sha256Hex(`${id}\n${safe.toString()}\n${passages.join("\n")}`),
      });
    } catch {
      // Skip unsafe URLs
    }
  }

  const retrievedAt = new Date().toISOString();
  const coverage =
    json.coverage && typeof json.coverage === "object" ? json.coverage : null;
  const partial = Boolean(json.partial);
  return {
    mode: apiKey.length > 0 ? "live-keyed" : "live-keyless",
    query: input.query,
    skillsOnly: input.skillsOnly,
    retrievedAt,
    partial,
    coverage,
    hits,
    receiptSha256: sha256Hex(JSON.stringify({ retrievedAt, partial, coverage, hits })),
  };
}

export const DriftScanRequestSchema = z.object({
  url: z.string().trim().url(),
  tag: z.string().trim().min(2).max(64).optional().default("deadcodefix-live"),
  mapSearch: z.string().trim().max(80).optional(),
  byokApiKey: z.string().trim().max(200).optional(),
});

const DRIFT_SCHEMA = {
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
          changeKind: { type: "string" },
          summary: { type: "string" },
          migrationAction: { type: "string" },
        },
        required: ["symbol", "summary", "migrationAction"],
      },
    },
    obsoleteWorkarounds: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["sdkOrHarness", "breakingChanges", "obsoleteWorkarounds"],
};

const ValidChangeStatusSchema = z.enum(["new", "same", "changed", "removed"]);

export async function runLiveChangeTrackingScan(
  input: z.infer<typeof DriftScanRequestSchema>,
) {
  const safeUrl = assertSafePublicUrl(input.url);
  const apiKey =
    cleanSecret(input.byokApiKey) || cleanSecret(process.env.FIRECRAWL_API_KEY);
  if (!apiKey) {
    throw new Error(
      "Live Firecrawl Change Tracking & Map requires FIRECRAWL_API_KEY (configured on Vercel or entered in the in-memory BYOK field).",
    );
  }

  const client = new Firecrawl({ apiKey });
  const prompt =
    "Extract breaking API/SDK changes, renamed or removed parameters, and obsolete legacy prompt or parser workarounds.";

  const [scrapeRes, mapOutcome] = await Promise.all([
    client.scrape(safeUrl.toString(), {
      formats: [
        "markdown",
        {
          type: "json",
          prompt,
          schema: DRIFT_SCHEMA,
        } as unknown as "json",
        {
          type: "changeTracking",
          modes: ["git-diff", "json"],
          prompt,
          schema: DRIFT_SCHEMA,
          tag: input.tag,
        } as unknown as "changeTracking",
      ],
    }),
    client
      .map(safeUrl.origin, {
        search: input.mapSearch || "migration changelog upgrade tool",
        limit: 8,
      })
      .then((res) => ({
        status: "ok" as const,
        links: Array.isArray(res.links)
          ? (res.links as Array<string | { url?: string }>)
          : [],
        error: null as string | null,
      }))
      .catch((err) => ({
        status: "failed" as const,
        links: [] as Array<string | { url?: string }>,
        error: err instanceof Error ? err.message : String(err),
      })),
  ]);

  const markdown =
    typeof scrapeRes.markdown === "string" ? scrapeRes.markdown : "";
  const tracking = (
    scrapeRes as {
      changeTracking?: {
        changeStatus?: string;
        previousScrapeAt?: string | null;
        diff?: { text?: string };
        json?: Record<string, { previous: unknown; current: unknown }>;
      };
    }
  ).changeTracking;

  const parsedStatus = ValidChangeStatusSchema.safeParse(tracking?.changeStatus);
  const changeStatus = parsedStatus.success ? parsedStatus.data : "unavailable";

  const mappedUrls: string[] = [];
  for (const entry of mapOutcome.links) {
    const candidate = typeof entry === "string" ? entry : entry.url;
    if (!candidate) continue;
    try {
      mappedUrls.push(assertSafePublicUrl(candidate).toString());
    } catch {
      // ignore invalid
    }
  }

  const retrievedAt = new Date().toISOString();
  const contentSha256 = sha256Hex(markdown);
  return {
    mode: "live" as const,
    url: safeUrl.toString(),
    tag: input.tag,
    retrievedAt,
    changeStatus,
    previousScrapeAt: tracking?.previousScrapeAt ?? null,
    gitDiff: tracking?.diff?.text ?? null,
    jsonDiff: tracking?.json ?? {},
    extractedJson: (scrapeRes as { json?: unknown }).json ?? null,
    markdownExcerpt: markdown.slice(0, 1400),
    bytesRetained: Buffer.byteLength(markdown, "utf8"),
    contentSha256,
    mapStatus: mapOutcome.status,
    mapError: mapOutcome.error,
    mappedUrls: [...new Set(mappedUrls)].slice(0, 8),
  };
}
