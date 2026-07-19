import assert from "node:assert/strict";
import test from "node:test";
import { classifySecret, classifySettingType, discoveredSettingSchema, hasPermission, recognizeProvider, settingNameSchema } from "../src/index.js";

test("configuration names reject injection-shaped and lowercase input", () => {
  assert.equal(settingNameSchema.safeParse("SAFE_VARIABLE_1").success, true);
  assert.equal(settingNameSchema.safeParse("unsafe=value\nSECOND=value").success, false);
  assert.equal(settingNameSchema.safeParse("$(command)").success, false);
});

test("provider-neutral classifiers recognize common names without values", () => {
  assert.equal(recognizeProvider("STRIPE_API_KEY"), "Stripe");
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
