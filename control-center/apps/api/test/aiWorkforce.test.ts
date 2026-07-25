import assert from "node:assert/strict";
import test from "node:test";
import { modelRegistry, probeWorkforceProvider, providerBaseUrl, providerCredential, roleAcceptsResource, routeWorkforceRole, workforceRoles, workforceStatus } from "../src/aiWorkforce.js";
import { buildWorkforceMockSummary, drainWorkforceBatch } from "../src/aiWorkforceWorker.js";

test("workforce registry exposes four bounded read-only roles", () => {
  assert.deepEqual(workforceRoles.map((role) => role.id), ["operations-analyst", "seo-analyst", "website-planner", "reviewer"]);
  assert.equal(workforceRoles.every((role) => role.readOnly), true);
});

test("workforce roles accept only their bounded resource types", () => {
  assert.equal(roleAcceptsResource("operations-analyst", "server"), true);
  assert.equal(roleAcceptsResource("operations-analyst", "seo_audit"), false);
  assert.equal(roleAcceptsResource("seo-analyst", "seo_audit"), true);
  assert.equal(roleAcceptsResource("website-planner", "website_workflow"), true);
});

test("reviewer accepts draft resources but not infrastructure", () => {
  assert.equal(roleAcceptsResource("reviewer", "seo_audit"), true);
  assert.equal(roleAcceptsResource("reviewer", "website_workflow"), true);
  assert.equal(roleAcceptsResource("reviewer", "server"), false);
});

test("provider status reports configuration booleans without credential values", () => {
  const env = { OPENAI_API_KEY: "super-secret-value", AI_WORKFORCE_MODEL_MAP: "openai=safe-model,anthropic=safe-model,mock=safe-model" }; const status = workforceStatus(["openai", "anthropic", "mock"], ["safe-model"], env);
  assert.deepEqual(status.providers.map((item) => [item.id, item.configured]), [["openai", true], ["anthropic", false], ["mock", true]]);
  assert.equal(JSON.stringify(status).includes("super-secret-value"), false);
});

test("multi-provider routing fails closed without explicit model mappings", () => {
  const status = workforceStatus(["openai", "anthropic"], ["shared-name"], { OPENAI_API_KEY: "present", ANTHROPIC_API_KEY: "present" });
  assert.equal(status.models.length, 0);
  assert.equal(status.providers.every((provider) => provider.health === "models_not_mapped"), true);
  assert.equal(routeWorkforceRole("reviewer", ["openai", "anthropic"], ["shared-name"], { OPENAI_API_KEY: "present", ANTHROPIC_API_KEY: "present" }), null);
});

test("model registry and routing remain environment allowlisted", () => {
  assert.deepEqual(modelRegistry(["gemini"], ["gemini-test"]).map((item) => [item.provider, item.id]), [["gemini", "gemini-test"]]);
  assert.equal(routeWorkforceRole("seo-analyst", ["gemini"], ["gemini-test"], { GEMINI_API_KEY: "present" })?.provider, "gemini");
  assert.equal(routeWorkforceRole("unknown", ["gemini"], ["gemini-test"], { GEMINI_API_KEY: "present" }), null);
});

test("provider credential and base URL lookup is provider specific", () => {
  const env = { OPENROUTER_API_KEY: "router-key", GEMINI_API_KEY: "gemini-key" };
  assert.equal(providerCredential("openrouter", env), "router-key");
  assert.equal(providerCredential("gemini", env), "gemini-key");
  assert.equal(providerBaseUrl("openrouter", env), "https://openrouter.ai/api/v1");
});

test("provider probe sends authentication in headers and returns only normalized health", async () => {
  let captured: RequestInit | undefined; const previous = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => { captured = init; return new Response("{}", { status: 200 }); }) as typeof fetch;
  try { const result = await probeWorkforceProvider("openrouter", { OPENROUTER_API_KEY: "secret-value" }); assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes("secret-value"), false); assert.match(String((captured?.headers as Record<string, string>).authorization), /^Bearer /); } finally { globalThis.fetch = previous; }
});

test("provider probe normalizes authentication failures", async () => {
  const previous = globalThis.fetch; globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  try { const result = await probeWorkforceProvider("gemini", { GEMINI_API_KEY: "secret-value" }); assert.equal(result.ok, false); assert.equal(result.category, "authentication"); } finally { globalThis.fetch = previous; }
});

test("provider probe remains inert when configuration is absent", async () => {
  let calls = 0; const previous = globalThis.fetch; globalThis.fetch = (async () => { calls++; throw new Error("unexpected"); }) as typeof fetch;
  try { const result = await probeWorkforceProvider("anthropic", {}); assert.equal(result.category, "unconfigured"); assert.equal(calls, 0); } finally { globalThis.fetch = previous; }
});

test("mock worker summarizes SEO audit metadata without page content", () => {
  const summary = buildWorkforceMockSummary({ roleId: "seo-analyst", resourceType: "seo_audit" }, { score: 82, pagesCrawled: 7, pages: [{ text: "sensitive content" }] }); assert.match(summary, /82/); assert.match(summary, /7/); assert.doesNotMatch(summary, /sensitive/);
});

test("mock worker summarizes website workflow without answers", () => {
  const summary = buildWorkforceMockSummary({ roleId: "website-planner", resourceType: "website_workflow" }, { websiteType: "business", stage: "brief_review", answers: [{ value: "private answer" }] }); assert.match(summary, /business/); assert.match(summary, /brief_review/); assert.doesNotMatch(summary, /private answer/);
});

test("mock worker summaries remain bounded to operational identifiers", () => {
  assert.match(buildWorkforceMockSummary({ roleId: "operations-analyst", resourceType: "server" }, { name: "Web", agentStatus: "online", metadata: { secret: "hidden" } }), /Web.*online/);
  assert.equal(buildWorkforceMockSummary({ roleId: "operations-analyst", resourceType: "project" }, { name: "Portal", repoPath: "/secret/path" }).includes("/secret/path"), false);
});

test("mock worker rejects deleted resources", () => { assert.throws(() => buildWorkforceMockSummary({ roleId: "reviewer", resourceType: "seo_audit" }, null), /resource_missing/); });

test("mock worker drain caps each polling batch", async () => {
  let calls = 0;
  assert.equal(await drainWorkforceBatch(async () => { calls++; return true; }, 10), 10);
  assert.equal(calls, 10);
});

test("mock worker drain stops when the queue is empty", async () => {
  let remaining = 3;
  assert.equal(await drainWorkforceBatch(async () => remaining-- > 0, 10), 3);
});
