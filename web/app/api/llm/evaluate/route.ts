import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { generateText, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

const EvaluateRequestSchema = z.object({
  caseTitle: z.string().trim().min(2).max(200),
  diffText: z.string().trim().min(10).max(12000),
  evidenceSummary: z.string().trim().min(5).max(4000),
  modelId: z
    .enum([
      "openai/gpt-5-mini",
      "openai/gpt-5",
      "anthropic/claude-sonnet-5.5",
    ])
    .optional()
    .default("openai/gpt-5-mini"),
});

type ProviderName = "vercel-ai-gateway" | "openai" | "openrouter";

function getProviderChain(): Array<{
  provider: ProviderName;
  buildModel: (modelId: string) => LanguageModel | string;
}> {
  const chain: Array<{
    provider: ProviderName;
    buildModel: (modelId: string) => LanguageModel | string;
  }> = [];

  if (process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY) {
    chain.push({
      provider: "vercel-ai-gateway",
      buildModel: (modelId) => modelId,
    });
  }
  if (process.env.OPENAI_API_KEY) {
    chain.push({
      provider: "openai",
      buildModel: (modelId) => {
        const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const bare = modelId.startsWith("openai/")
          ? modelId.slice("openai/".length)
          : "gpt-5-mini";
        return openai(bare);
      },
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    chain.push({
      provider: "openrouter",
      buildModel: (modelId) => {
        const openrouter = createOpenAICompatible({
          name: "openrouter",
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: process.env.OPENROUTER_API_KEY,
        });
        return openrouter.chatModel(modelId);
      },
    });
  }
  return chain;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body: unknown = await request.json();
    const parsed = EvaluateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid evaluation payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const chain = getProviderChain();
    if (chain.length === 0) {
      return NextResponse.json(
        {
          status: "blocked",
          error:
            "No live LLM credentials configured on server (AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN, OPENAI_API_KEY, or OPENROUTER_API_KEY).",
        },
        { status: 403 },
      );
    }

    const errors: Array<{ provider: ProviderName; message: string }> = [];
    for (const entry of chain) {
      try {
        const result = await generateText({
          model: entry.buildModel(parsed.data.modelId),
          system:
            "You are an independent AI harness upgrade auditor following Matt Pocock's /code-review discipline. Be concise, grounded strictly in the provided Firecrawl evidence and unified diff. Identify: (1) upgrade correctness, (2) dead workarounds safely deleted, (3) any remaining risk.",
          prompt: `Case: ${parsed.data.caseTitle}\n\nFirecrawl Evidence:\n${parsed.data.evidenceSummary}\n\nExact repair.patch:\n${parsed.data.diffText}`,
          maxOutputTokens: 500,
          temperature: 0,
        });
        return NextResponse.json({
          status: "completed",
          providerUsed: entry.provider,
          modelId: parsed.data.modelId,
          fallbackErrors: errors,
          analysis: result.text,
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          rawResponseSha256: createHash("sha256")
            .update(result.text, "utf8")
            .digest("hex"),
          latencyMs: Date.now() - startedAt,
        });
      } catch (err) {
        errors.push({
          provider: entry.provider,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json(
      {
        status: "failed",
        error: "All configured LLM providers failed",
        fallbackErrors: errors,
      },
      { status: 502 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Evaluation request failed",
      },
      { status: 500 },
    );
  }
}
