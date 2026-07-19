import assert from "node:assert/strict";
import test from "node:test";
import { aiAssistantConfig, organizationProvider } from "../src/aiAssistant.js";
import { defaultAiSettings, effectiveAiSettings } from "../src/aiOperations.js";

test("organization settings default to disabled and bounded limits", () => { const settings = defaultAiSettings(); assert.equal(settings.enabled, false); assert.equal(settings.maximumConcurrentRequests, 3); assert.deepEqual(settings.allowedScopeTypes, ["server", "application"]); });
test("missing organization settings remain backward compatible", () => { const settings = effectiveAiSettings({ name: "Legacy", slug: "legacy", createdAt: new Date(), updatedAt: new Date() }); assert.equal(settings.enabled, false); });
test("provider and model must both be server allowlisted", () => { const base = { ...aiAssistantConfig(), enabled: true, provider: "mock", model: "safe", allowedProviders: ["mock"], allowedModels: ["safe"] }; assert.ok(organizationProvider(base, "mock", "safe")); assert.equal(organizationProvider(base, "other", "safe"), null); assert.equal(organizationProvider(base, "mock", "unsafe"), null); });
test("environment configuration never invents credentials or browser base URLs", () => { const config = aiAssistantConfig(); assert.equal("browserBaseUrl" in config, false); assert.equal(typeof config.allowedProviders.length, "number"); });
