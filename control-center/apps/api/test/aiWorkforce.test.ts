import assert from "node:assert/strict";
import test from "node:test";
import { modelRegistry, providerBaseUrl, providerCredential, routeWorkforceRole, workforceRoles, workforceStatus } from "../src/aiWorkforce.js";

test("workforce registry exposes four bounded read-only roles", () => {
  assert.deepEqual(workforceRoles.map((role) => role.id), ["operations-analyst", "seo-analyst", "website-planner", "reviewer"]);
  assert.equal(workforceRoles.every((role) => role.readOnly), true);
});

test("provider status reports configuration booleans without credential values", () => {
  const env = { OPENAI_API_KEY: "super-secret-value" }; const status = workforceStatus(["openai", "anthropic", "mock"], ["safe-model"], env);
  assert.deepEqual(status.providers.map((item) => [item.id, item.configured]), [["openai", true], ["anthropic", false], ["mock", true]]);
  assert.equal(JSON.stringify(status).includes("super-secret-value"), false);
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
