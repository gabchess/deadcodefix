import { createHash } from "node:crypto";
import { generateText, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export type ProviderName = "vercel-ai-gateway" | "openai" | "openrouter";

export interface RouterCredentials {
  vercelGatewayApiKey?: string;
  vercelOidcToken?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
}

export interface RouterCallRequest {
  /** Verified Vercel AI Gateway model slug, e.g. "openai/gpt-5-mini" or "anthropic/claude-sonnet-5.5" */
  modelId: string;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  maxUsdCap?: number;
  spentUsdSoFar?: number;
}

export interface ProviderAttemptError {
  provider: ProviderName;
  message: string;
}

export interface RouterCallReceipt {
  status: "completed" | "blocked" | "failed";
  providerUsed: ProviderName | null;
  modelId: string;
  attemptedProviders: ProviderName[];
  fallbackErrors: ProviderAttemptError[];
  text: string | null;
  rawResponseSha256: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  blockReason?: string;
}

export type TextGeneratorFn = (input: {
  provider: ProviderName;
  model: LanguageModel | string;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}) => Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
}>;

const MODEL_PRICING_PER_TOKEN: Record<
  string,
  { input: number; output: number }
> = {
  "openai/gpt-5-mini": { input: 0.00000025, output: 0.000002 },
  "openai/gpt-5": { input: 0.00000125, output: 0.00001 },
  "openai/gpt-5-nano": { input: 0.00000005, output: 0.0000004 },
  "anthropic/claude-sonnet-5.5": { input: 0.000002, output: 0.00001 },
  "anthropic/claude-sonnet-4.6": { input: 0.000003, output: 0.000015 },
};

const DEFAULT_PRICING = { input: 0.000003, output: 0.000015 };

export function estimateCallCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = MODEL_PRICING_PER_TOKEN[modelId] ?? DEFAULT_PRICING;
  return Number(
    (inputTokens * rates.input + outputTokens * rates.output).toFixed(6),
  );
}

export function resolveProviderOrder(creds: RouterCredentials): ProviderName[] {
  const order: ProviderName[] = [];
  if (creds.vercelOidcToken?.trim() || creds.vercelGatewayApiKey?.trim()) {
    order.push("vercel-ai-gateway");
  }
  if (creds.openaiApiKey?.trim()) {
    order.push("openai");
  }
  if (creds.openrouterApiKey?.trim()) {
    order.push("openrouter");
  }
  return order;
}

function buildModelForProvider(
  provider: ProviderName,
  modelId: string,
  creds: RouterCredentials,
): LanguageModel | string {
  if (provider === "vercel-ai-gateway") {
    // Plain "provider/model" strings route automatically through Vercel AI Gateway in AI SDK v6+
    return modelId;
  }
  if (provider === "openai") {
    const openai = createOpenAI({ apiKey: creds.openaiApiKey });
    const bareModel = modelId.startsWith("openai/")
      ? modelId.slice("openai/".length)
      : "gpt-5-mini";
    return openai(bareModel);
  }
  const openrouter = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: creds.openrouterApiKey,
  });
  return openrouter.chatModel(modelId);
}

const defaultGenerator: TextGeneratorFn = async ({
  model,
  system,
  prompt,
  maxOutputTokens,
  temperature,
}) => {
  const result = await generateText({
    model,
    system,
    prompt,
    maxOutputTokens,
    temperature,
  });
  return {
    text: result.text,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  };
};

function cleanSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^\x21-\x7e]/g, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function credentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): RouterCredentials {
  return {
    vercelGatewayApiKey: cleanSecret(env.AI_GATEWAY_API_KEY),
    vercelOidcToken: cleanSecret(env.VERCEL_OIDC_TOKEN),
    openaiApiKey: cleanSecret(env.OPENAI_API_KEY),
    openrouterApiKey: cleanSecret(env.OPENROUTER_API_KEY),
  };
}

export async function generateWithFallback(
  request: RouterCallRequest,
  creds: RouterCredentials = credentialsFromEnv(),
  generator: TextGeneratorFn = defaultGenerator,
): Promise<RouterCallReceipt> {
  const startedAt = Date.now();
  const maxUsdCap = request.maxUsdCap ?? 50;
  const spentUsdSoFar = request.spentUsdSoFar ?? 0;

  if (spentUsdSoFar >= maxUsdCap || maxUsdCap <= 0) {
    return {
      status: "blocked",
      providerUsed: null,
      modelId: request.modelId,
      attemptedProviders: [],
      fallbackErrors: [],
      text: null,
      rawResponseSha256: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - startedAt,
      blockReason: `Budget cap reached ($${spentUsdSoFar.toFixed(4)} / $${maxUsdCap.toFixed(2)})`,
    };
  }

  const providers = resolveProviderOrder(creds);
  if (providers.length === 0) {
    return {
      status: "blocked",
      providerUsed: null,
      modelId: request.modelId,
      attemptedProviders: [],
      fallbackErrors: [],
      text: null,
      rawResponseSha256: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - startedAt,
      blockReason:
        "No LLM provider credentials configured (set AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN, OPENAI_API_KEY, or OPENROUTER_API_KEY)",
    };
  }

  const attemptedProviders: ProviderName[] = [];
  const fallbackErrors: ProviderAttemptError[] = [];

  for (const provider of providers) {
    attemptedProviders.push(provider);
    try {
      const model = buildModelForProvider(provider, request.modelId, creds);
      const output = await generator({
        provider,
        model,
        system: request.system,
        prompt: request.prompt,
        maxOutputTokens: request.maxOutputTokens ?? 2048,
        temperature: request.modelId.startsWith("openai/gpt-5")
          ? undefined
          : (request.temperature ?? 0),
      });
      const estimatedCostUsd = estimateCallCostUsd(
        request.modelId,
        output.inputTokens,
        output.outputTokens,
      );
      return {
        status: "completed",
        providerUsed: provider,
        modelId: request.modelId,
        attemptedProviders,
        fallbackErrors,
        text: output.text,
        rawResponseSha256: createHash("sha256")
          .update(output.text, "utf8")
          .digest("hex"),
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        estimatedCostUsd,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      fallbackErrors.push({
        provider,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    status: "failed",
    providerUsed: null,
    modelId: request.modelId,
    attemptedProviders,
    fallbackErrors,
    text: null,
    rawResponseSha256: null,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    latencyMs: Date.now() - startedAt,
  };
}
