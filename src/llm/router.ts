import { createHash } from "node:crypto";
import { createGateway, generateText, type LanguageModel } from "ai";
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
  reservedCostUsd: number;
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

export function estimateConservativeReservationUsd(
  modelId: string,
  system: string | undefined,
  prompt: string,
  maxOutputTokens: number,
): number {
  const promptChars = (system?.length ?? 0) + prompt.length;
  // Conservative 2 chars/token upper bound for input tokens
  const conservativeInputTokens = Math.max(1, Math.ceil(promptChars / 2));
  return estimateCallCostUsd(modelId, conservativeInputTokens, maxOutputTokens);
}

export function resolveProviderOrder(
  creds: RouterCredentials,
  modelId?: string,
): ProviderName[] {
  const order: ProviderName[] = [];
  if (creds.vercelOidcToken?.trim() || creds.vercelGatewayApiKey?.trim()) {
    order.push("vercel-ai-gateway");
  }
  const supportsDirectOpenAI = !modelId || modelId.startsWith("openai/");
  if (creds.openaiApiKey?.trim() && supportsDirectOpenAI) {
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
): LanguageModel {
  if (provider === "vercel-ai-gateway") {
    const gatewayKey =
      creds.vercelGatewayApiKey?.trim() || creds.vercelOidcToken?.trim();
    const gateway = createGateway(gatewayKey ? { apiKey: gatewayKey } : {});
    return gateway(modelId);
  }
  if (provider === "openai") {
    if (!modelId.startsWith("openai/")) {
      throw new Error(
        `Direct OpenAI provider cannot serve non-OpenAI model ${modelId}`,
      );
    }
    const openai = createOpenAI({ apiKey: creds.openaiApiKey });
    return openai(modelId.slice("openai/".length));
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
  const maxOutputTokens = request.maxOutputTokens ?? 2048;

  if (
    !Number.isFinite(maxUsdCap) ||
    !Number.isFinite(spentUsdSoFar) ||
    !Number.isFinite(maxOutputTokens) ||
    maxUsdCap <= 0 ||
    spentUsdSoFar < 0 ||
    maxOutputTokens <= 0
  ) {
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
      reservedCostUsd: 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - startedAt,
      blockReason: "Invalid non-finite or non-positive budget/token limit",
    };
  }

  const reservedCostUsd = estimateConservativeReservationUsd(
    request.modelId,
    request.system,
    request.prompt,
    maxOutputTokens,
  );

  if (
    spentUsdSoFar >= maxUsdCap ||
    spentUsdSoFar + reservedCostUsd > maxUsdCap
  ) {
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
      reservedCostUsd,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - startedAt,
      blockReason: `Budget cap reached or insufficient remaining allowance (spent $${spentUsdSoFar.toFixed(6)} + reserve $${reservedCostUsd.toFixed(6)} > cap $${maxUsdCap.toFixed(4)})`,
    };
  }

  const providers = resolveProviderOrder(creds, request.modelId);
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
      reservedCostUsd,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - startedAt,
      blockReason: `No compatible LLM provider credentials configured for ${request.modelId}`,
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
        maxOutputTokens,
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
        reservedCostUsd,
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
    reservedCostUsd,
    estimatedCostUsd: 0,
    latencyMs: Date.now() - startedAt,
  };
}
