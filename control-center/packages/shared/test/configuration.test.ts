import assert from "node:assert/strict";
import test from "node:test";
import { classifySecret, classifySettingType, definitionsForPromotion, discoveredSettingSchema, environmentDefinitionSchema, hasPermission, missingRequiredDefinitions, recognizeProvider, safeConfigurationDisplay, settingNameSchema, validateEnvironmentDefinitionValue } from "../src/index.js";

test("configuration names reject injection-shaped and lowercase input", () => {
  assert.equal(settingNameSchema.safeParse("SAFE_VARIABLE_1").success, true);
  assert.equal(settingNameSchema.safeParse("unsafe=value\nSECOND=value").success, false);
  assert.equal(settingNameSchema.safeParse("$(command)").success, false);
});

test("provider-neutral classifiers recognize common names without values", () => {
  assert.equal(recognizeProvider("STRIPE_API_KEY"), "Stripe");
  assert.equal(recognizeProvider("GEMINI_API_KEY"), "Google Gemini");
  assert.equal(recognizeProvider("OPENROUTER_MODELS"), "OpenRouter");
  assert.equal(classifySecret("CUSTOM_SIGNING_SECRET"), true);
  assert.equal(classifySettingType("PUBLIC_ORIGIN"), "url");
  assert.equal(discoveredSettingSchema.safeParse({ name: "R2_ACCESS_KEY", applicationPath: "/srv/app", sources: ["runtime-name"], sourcePaths: ["/srv/app/.env"], secret: true, type: "secret" }).success, true);
});

test("configuration permissions separate viewing, public edits, and secret changes", () => {
  assert.equal(hasPermission("Viewer", "configuration:view"), true);
  assert.equal(hasPermission("Viewer", "configuration:edit-public"), false);
  assert.equal(hasPermission("Developer", "configuration:edit-public"), true);
  assert.equal(hasPermission("Developer", "secrets:replace"), false);
  assert.equal(hasPermission("Administrator", "secrets:replace"), true);
});

const definition = { name: "FEATURE_ENABLED", description: "Controls the feature", secret: false, required: false, applicableEnvironments: ["staging"] as const, validation: { type: "boolean" as const }, services: ["web"], restartRequirement: "restart" as const, removalPermitted: true, browserDisplayPermitted: true, risk: "low" as const };

test("environment registry enforces classification, validation, and protected variables", () => {
  assert.equal(environmentDefinitionSchema.safeParse(definition).success, true);
  assert.equal(validateEnvironmentDefinitionValue(definition, "true"), undefined);
  assert.match(validateEnvironmentDefinitionValue(definition, "yes") || "", /true or false/);
  assert.equal(environmentDefinitionSchema.safeParse({ ...definition, name: "API_SECRET", secret: true, browserDisplayPermitted: true }).success, false);
  assert.equal(environmentDefinitionSchema.safeParse({ ...definition, name: "CF_ACCESS_CLIENT_SECRET", secret: true, browserDisplayPermitted: false, risk: "high" }).success, false);
});

test("secret display returns state only and public display remains policy-bound", () => {
  assert.deepEqual(safeConfigurationDisplay({ secret: true, browserDisplayPermitted: false }, "configured", "never-return-this"), { state: "configured" });
  assert.deepEqual(safeConfigurationDisplay({ secret: false, browserDisplayPermitted: false }, "changed", "hidden"), { state: "changed" });
  assert.deepEqual(safeConfigurationDisplay({ secret: false, browserDisplayPermitted: true }, "configured", "visible"), { state: "configured", value: "visible" });
});

test("promotion copies definitions but never values and release gates identify missing required input", () => {
  const required = { ...definition, required: true };
  const promoted = definitionsForPromotion([required], "production");
  assert.equal(Object.hasOwn(promoted[0], "value"), true);
  assert.equal(promoted[0].value, undefined);
  assert.deepEqual(missingRequiredDefinitions([required], [], "staging"), ["FEATURE_ENABLED"]);
  assert.deepEqual(missingRequiredDefinitions([required], ["FEATURE_ENABLED"], "staging"), []);
});
