import assert from "node:assert/strict";
import test from "node:test";
import { providerBaseUrl, providerCredential, providerHealth, providerModelRegistry } from "../src/aiProviderRegistry.js";

test("provider model registry binds models to their declared provider", () => {
  const env = {
    OPENAI_MODELS: "gpt-a,gpt-b",
    ANTHROPIC_MODELS: "claude-a",
    GEMINI_MODELS: "gemini-a",
    OPENROUTER_MODELS: "openai/gpt-a"
  };
  const models = providerModelRegistry({ env, defaultProvider: "openai", defaultModel: "gpt-a", allowedProviders: ["openai", "anthropic", "gemini", "openrouter"], legacyAllowedModels: [] });
  assert.deepEqual(models.openai, ["gpt-a", "gpt-b"]);
  assert.deepEqual(models.anthropic, ["claude-a"]);
  assert.deepEqual(models.gemini, ["gemini-a"]);
  assert.deepEqual(models.openrouter, ["openai/gpt-a"]);
});

test("provider endpoints require credential-free HTTPS URLs", () => {
  assert.equal(providerBaseUrl("openai", { OPENAI_BASE_URL: "http://api.example.test/v1" }), undefined);
  assert.equal(providerBaseUrl("openai", { OPENAI_BASE_URL: "https://user:pass@api.example.test/v1" }), undefined);
  assert.equal(providerBaseUrl("openai", { OPENAI_BASE_URL: "https://api.example.test/v1?token=value" }), undefined);
  assert.equal(providerBaseUrl("openai", { OPENAI_BASE_URL: "https://api.example.test/v1/" }), "https://api.example.test/v1");
});

test("provider credentials are detected by name without exposing values", () => {
  assert.equal(Boolean(providerCredential("gemini", { GEMINI_API_KEY: "configured" })), true);
  assert.equal(Boolean(providerCredential("openrouter", { OPENROUTER_API_KEY: "configured" })), true);
  assert.equal(providerCredential("unsupported", { AI_API_KEY: "fallback-must-not-activate" }), undefined);
});

test("provider health is passive and reports bounded readiness states", () => {
  let calls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => { calls += 1; throw new Error("unexpected"); }) as typeof fetch;
  const health = providerHealth(
    { enabled: true, allowedProviders: ["gemini", "openrouter"], modelsByProvider: { gemini: ["gemini-a"], openrouter: [] } },
    { GEMINI_API_KEY: "configured", OPENROUTER_API_KEY: "configured" }
  );
  globalThis.fetch = previous;
  assert.equal(health.find((item) => item.id === "gemini")?.state, "ready");
  assert.equal(health.find((item) => item.id === "openrouter")?.state, "no_models");
  assert.equal(health.find((item) => item.id === "openai")?.state, "not_allowed");
  assert.equal(calls, 0);
});
