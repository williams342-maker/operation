import assert from "node:assert/strict";
import test from "node:test";
import { assertValidEnvironment, validateEnvironment } from "../src/environmentValidation.js";

const production = { NODE_ENV: "production", MONGO_URL: "mongodb://mongo:27017/control_center_staging", CONTROL_CENTER_SESSION_SECRET: "s".repeat(40), CONTROL_CENTER_CSRF_SECRET: "c".repeat(40), CONTROL_CENTER_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), CONTROL_CENTER_PUBLIC_URL: "https://staging.example.test", CONTROL_CENTER_WEB_ORIGIN: "https://staging.example.test", CONTROL_CENTER_SECURE_COOKIES: "true", CONTROL_CENTER_TRUST_PROXY: "loopback", CONTROL_CENTER_BOOTSTRAP_MODE: "invitation", AI_ASSISTANT_ENABLED: "false" } as NodeJS.ProcessEnv;
test("development startup has no production-only required variables", () => { const result = validateEnvironment({ NODE_ENV: "test" }); assert.equal(result.valid, true); assert.deepEqual(result.required, []); });
test("production reports every missing required variable without values", () => { const result = validateEnvironment({ NODE_ENV: "production" }); assert.equal(result.valid, false); assert.equal(result.diagnostics.filter((item) => item.code === "missing_required").length, 9); assert.ok(result.diagnostics.every((item) => !item.message.includes("mongodb://"))); });
test("valid staging environment passes with AI disabled", () => { const result = assertValidEnvironment(production); assert.equal(result.valid, true); assert.equal(result.ai.state, "disabled"); });
test("image-provided source and agent artifact identity variables are recognized", () => { const result = validateEnvironment({ ...production, CONTROL_CENTER_SOURCE_COMMIT: "a".repeat(40), CONTROL_CENTER_AGENT_ARTIFACT_PATH: "/app/artifacts/agent.tar.gz" }); assert.equal(result.diagnostics.some((item) => item.code === "unknown_variable"), false); });
test("unknown OpsWorkbench variables are warnings", () => { const result = validateEnvironment({ ...production, CONTROL_CENTER_TYPO: "secret-value" }); const warning = result.diagnostics.find((item) => item.code === "unknown_variable"); assert.equal(warning?.variable, "CONTROL_CENTER_TYPO"); assert.equal(warning?.message.includes("secret-value"), false); });
test("deprecated and conflicting AI variables are diagnosed", () => { const result = validateEnvironment({ ...production, AI_PROVIDER: "openai", AI_DEFAULT_PROVIDER: "anthropic" }); assert.ok(result.diagnostics.some((item) => item.code === "deprecated_variable")); assert.ok(result.diagnostics.some((item) => item.code === "conflicting_variables")); });
test("unsafe production cookie and bootstrap defaults are diagnosed", () => { const result = validateEnvironment({ ...production, CONTROL_CENTER_SECURE_COOKIES: "false", CONTROL_CENTER_ALLOW_INSECURE_COOKIES: "true", CONTROL_CENTER_BOOTSTRAP_MODE: "manual" }); assert.equal(result.valid, false); assert.equal(result.diagnostics.filter((item) => item.code === "unsafe_default").length, 2); assert.ok(result.diagnostics.some((item) => item.code === "bootstrap_open")); });
test("OpenAI readiness requires an allowlisted model and credential", () => { const base = { ...production, AI_ASSISTANT_ENABLED: "true", AI_DEFAULT_PROVIDER: "openai", AI_DEFAULT_MODEL: "gpt-test", AI_ALLOWED_PROVIDERS: "openai", AI_ALLOWED_MODELS: "gpt-test" }; assert.equal(validateEnvironment(base).ai.state, "invalid"); assert.equal(validateEnvironment({ ...base, OPENAI_API_KEY: "present" }).ai.state, "ready"); });
test("Anthropic readiness detects provider-specific credentials", () => { const base = { ...production, AI_ASSISTANT_ENABLED: "true", AI_DEFAULT_PROVIDER: "anthropic", AI_DEFAULT_MODEL: "claude-test", AI_ALLOWED_PROVIDERS: "anthropic", AI_ALLOWED_MODELS: "claude-test" }; assert.equal(validateEnvironment(base).ai.state, "invalid"); assert.equal(validateEnvironment({ ...base, ANTHROPIC_API_KEY: "present" }).ai.state, "ready"); });
test("Gemini and OpenRouter readiness use provider-specific credentials and models", () => {
  const gemini = { ...production, AI_ASSISTANT_ENABLED: "true", AI_DEFAULT_PROVIDER: "gemini", AI_DEFAULT_MODEL: "gemini-test", AI_ALLOWED_PROVIDERS: "gemini", GEMINI_MODELS: "gemini-test", GEMINI_API_KEY: "present" };
  const openrouter = { ...production, AI_ASSISTANT_ENABLED: "true", AI_DEFAULT_PROVIDER: "openrouter", AI_DEFAULT_MODEL: "openai/gpt-test", AI_ALLOWED_PROVIDERS: "openrouter", OPENROUTER_MODELS: "openai/gpt-test", OPENROUTER_API_KEY: "present" };
  assert.equal(validateEnvironment(gemini).ai.state, "ready");
  assert.equal(validateEnvironment(openrouter).ai.state, "ready");
});
test("provider models cannot be routed across providers", () => {
  const result = validateEnvironment({ ...production, AI_ASSISTANT_ENABLED: "true", AI_DEFAULT_PROVIDER: "openai", AI_DEFAULT_MODEL: "claude-test", AI_ALLOWED_PROVIDERS: "openai,anthropic", OPENAI_MODELS: "gpt-test", ANTHROPIC_MODELS: "claude-test", OPENAI_API_KEY: "present" });
  assert.equal(result.ai.state, "invalid");
  assert.ok(result.diagnostics.some((item) => item.variable === "AI_DEFAULT_MODEL"));
});
test("provider endpoint overrides must remain credential-free HTTPS URLs", () => {
  const result = validateEnvironment({ ...production, AI_ASSISTANT_ENABLED: "true", AI_DEFAULT_PROVIDER: "openai", AI_DEFAULT_MODEL: "gpt-test", AI_ALLOWED_PROVIDERS: "openai", OPENAI_MODELS: "gpt-test", OPENAI_API_KEY: "present", OPENAI_BASE_URL: "http://user:pass@127.0.0.1/v1?key=value" });
  assert.equal(result.ai.state, "invalid");
  assert.ok(result.diagnostics.some((item) => item.message.includes("credential-free HTTPS")));
  assert.ok(result.diagnostics.every((item) => !item.message.includes("user:pass")));
});
test("mock readiness needs no credential but remains explicitly enabled", () => { const result = validateEnvironment({ ...production, AI_ASSISTANT_ENABLED: "true", AI_DEFAULT_PROVIDER: "mock", AI_DEFAULT_MODEL: "deterministic-v1", AI_ALLOWED_PROVIDERS: "mock", AI_ALLOWED_MODELS: "deterministic-v1" }); assert.equal(result.ai.state, "ready"); assert.equal(result.ai.credentialPresent, true); });
test("disabled AI never becomes ready merely because credentials exist", () => { const result = validateEnvironment({ ...production, AI_DEFAULT_PROVIDER: "openai", AI_DEFAULT_MODEL: "gpt-test", OPENAI_API_KEY: "present" }); assert.equal(result.ai.state, "disabled"); assert.ok(result.diagnostics.some((item) => item.code === "ai_disabled_configuration_present")); });
