import test from "node:test";
import assert from "node:assert/strict";
import {
  credentialsFromEnv,
  estimateCallCostUsd,
  generateWithFallback,
  resolveProviderOrder,
  type ProviderName,
} from "../src/llm/router.ts";

test("credentialsFromEnv strips UTF-8 BOM and control whitespace from secrets", () => {
  const creds = credentialsFromEnv({
    OPENAI_API_KEY: "\uFEFFsk-test-clean\r\n",
    AI_GATEWAY_API_KEY: "  \uFEFFvck_12345  ",
  });
  assert.equal(creds.openaiApiKey, "sk-test-clean");
  assert.equal(creds.vercelGatewayApiKey, "vck_12345");
});

test("resolveProviderOrder prioritizes Vercel AI Gateway -> OpenAI -> OpenRouter", () => {
  assert.deepEqual(
    resolveProviderOrder({
      vercelGatewayApiKey: "vck_test",
      openaiApiKey: "sk-test",
      openrouterApiKey: "sk-or-test",
    }),
    ["vercel-ai-gateway", "openai", "openrouter"],
  );
  assert.deepEqual(
    resolveProviderOrder({
      vercelOidcToken: "oidc_test",
      openrouterApiKey: "sk-or-test",
    }),
    ["vercel-ai-gateway", "openrouter"],
  );
  assert.deepEqual(resolveProviderOrder({}), []);
});

test("generateWithFallback fails closed when budget cap is reached or no keys exist", async () => {
  const overBudget = await generateWithFallback(
    {
      modelId: "openai/gpt-5-mini",
      prompt: "Check patch",
      maxUsdCap: 50,
      spentUsdSoFar: 50,
    },
    { openaiApiKey: "sk-test" },
  );
  assert.equal(overBudget.status, "blocked");
  assert.match(overBudget.blockReason ?? "", /Budget cap reached/);

  const noCreds = await generateWithFallback(
    { modelId: "openai/gpt-5-mini", prompt: "Check patch" },
    {},
  );
  assert.equal(noCreds.status, "blocked");
  assert.match(noCreds.blockReason ?? "", /No LLM provider credentials/);
});

test("generateWithFallback cascades from Vercel AI Gateway to OpenAI and then OpenRouter", async () => {
  const seen: ProviderName[] = [];
  const receipt = await generateWithFallback(
    {
      modelId: "openai/gpt-5-mini",
      prompt: "Evaluate harness diff",
      maxUsdCap: 50,
      spentUsdSoFar: 0.1,
    },
    {
      vercelGatewayApiKey: "vck_test",
      openaiApiKey: "sk-test",
      openrouterApiKey: "sk-or-test",
    },
    async ({ provider }) => {
      seen.push(provider);
      if (provider !== "openrouter") {
        throw new Error(`${provider} quota exhausted`);
      }
      return {
        text: '{"verdict":"repaired"}',
        inputTokens: 1000,
        outputTokens: 200,
      };
    },
  );
  assert.deepEqual(seen, ["vercel-ai-gateway", "openai", "openrouter"]);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.providerUsed, "openrouter");
  assert.equal(receipt.fallbackErrors.length, 2);
  assert.match(receipt.rawResponseSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(
    receipt.estimatedCostUsd,
    estimateCallCostUsd("openai/gpt-5-mini", 1000, 200),
  );
});
