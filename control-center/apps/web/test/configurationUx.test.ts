import assert from "node:assert/strict";
import test from "node:test";
import { configurationCategory, parseEnvironmentText, plainLanguageChangeSummary } from "../src/configurationUx.js";

test("environment import parses values in memory and reports duplicate or unsafe lines", () => {
  const result = parseEnvironmentText("# local input\nSTRIPE_API_KEY=temporary-value\nPUBLIC_ORIGIN=https://example.invalid\nSTRIPE_API_KEY=replacement\nlowercase=bad");
  assert.equal(result.variables.length, 3);
  assert.equal(result.variables[0].secret, true);
  assert.equal(result.variables[0].duplicate, true);
  assert.equal(result.variables[1].secret, false);
  assert.equal(result.errors.length, 1);
});

test("guided configuration categories remain provider neutral", () => {
  assert.equal(configurationCategory("MONGO_URL"), "Database");
  assert.equal(configurationCategory("R2_BUCKET_NAME"), "Storage");
  assert.equal(configurationCategory("PUBLIC_ORIGIN"), "Domains and URLs");
  assert.equal(configurationCategory("GEMINI_API_KEY"), "AI");
  assert.equal(configurationCategory("OPENROUTER_MODELS"), "AI");
  assert.equal(configurationCategory("PARTNER_ENDPOINT_KEY"), "Custom APIs");
});

test("deployment summaries use plain language without shell commands", () => {
  const summary = plainLanguageChangeSummary([{ name: "DATABASE_URL", services: ["backend", "worker"], secret: true }], "Production");
  assert.match(summary.heading, /1 setting prepared for Production/);
  assert.match(summary.steps.join(" "), /Back up|Restore/);
  assert.doesNotMatch(summary.steps.join(" "), /docker|systemctl|ssh/i);
});
