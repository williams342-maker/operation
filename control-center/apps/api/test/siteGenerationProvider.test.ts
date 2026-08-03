import assert from "node:assert/strict";
import test from "node:test";
import {
  architectureSchema,
  brandDirectionSchema,
  briefSchema,
  deterministicSiteProvider,
  foundryAiPlanningEnabled,
  resolveSiteGenerationProvider,
  siteSectionSchema,
} from "../src/siteGenerationProvider.js";
import { buildArchitecture, buildBrandDirections, buildProjectBrief, buildSiteContent, deriveDiscoveryAnswers, inferWebsiteType, regenerateSiteSection } from "../src/websiteBuilder.js";

const answers = [
  { questionId: "business_name", value: "Acme Makers" },
  { questionId: "business_purpose", value: "We help local makers sell handcrafted goods." },
  { questionId: "primary_audience", value: "Independent makers" },
  { questionId: "primary_goal", value: "Generate qualified inquiries" },
  { questionId: "primary_action", value: "Book a consultation" },
  { questionId: "brand_personality", value: "warm, trustworthy" },
  { questionId: "required_pages", value: "Home, Services, About, Contact" },
  { questionId: "launch_target", value: "October" },
];

test("resolver defaults to the deterministic provider when AI planning is disabled", () => {
  delete process.env.FOUNDRY_AI_PLANNING_ENABLED;
  assert.equal(foundryAiPlanningEnabled(), false);
  assert.equal(resolveSiteGenerationProvider().mode, "deterministic");
});

test("enabling the flag alone never selects a paid provider (no configured AI)", () => {
  process.env.FOUNDRY_AI_PLANNING_ENABLED = "true";
  try {
    // With no ready shared AI provider, resolution must still be deterministic:
    // the flag is necessary but not sufficient, so enabling it cannot incur cost.
    assert.equal(resolveSiteGenerationProvider().mode, "deterministic");
  } finally {
    delete process.env.FOUNDRY_AI_PLANNING_ENABLED;
  }
});

test("deterministic provider is behaviourally identical to the raw generators", async () => {
  const brief = await deterministicSiteProvider.brief(answers, "business");
  assert.deepEqual(brief, buildProjectBrief(answers, "business"));
  const architecture = await deterministicSiteProvider.architecture(brief);
  assert.deepEqual(architecture, buildArchitecture(brief));
  assert.deepEqual(await deterministicSiteProvider.brandDirections(brief), buildBrandDirections(brief));
  const content = await deterministicSiteProvider.content(brief, architecture);
  assert.deepEqual(content, buildSiteContent(brief, architecture));
  assert.deepEqual(await deterministicSiteProvider.regenerateSection(content[0], brief), regenerateSiteSection(content[0], brief));
});

test("website type is inferred from a single natural-language request", () => {
  assert.equal(inferWebsiteType("An online shop to sell handmade mugs"), "store");
  assert.equal(inferWebsiteType("A landing page for my waitlist"), "landing_page");
  assert.equal(inferWebsiteType("A website for my accounting firm"), "business");
});

test("understand seeds honest answers from one sentence and only lifts an explicit name", async () => {
  const prompt = "A friendly website for a bakery called Rise & Co that takes custom cake orders";
  const derived = await deterministicSiteProvider.understand(prompt, inferWebsiteType(prompt));
  assert.deepEqual(derived, deriveDiscoveryAnswers(prompt));
  const map = Object.fromEntries(derived.map((a) => [a.questionId, a.value]));
  assert.equal(map.business_purpose, prompt); // the user's own words, not fabricated
  assert.equal(map.business_name, "Rise & Co"); // lifted only because it was stated
  // A prompt with no stated name must not invent one.
  const anon = await deterministicSiteProvider.understand("A simple site to show my photography", "business");
  assert.equal(anon.some((a) => a.questionId === "business_name"), false);
});

test("a single prompt flows through the provider into a schema-valid brief", async () => {
  const prompt = "An online store to sell handmade candles";
  const websiteType = inferWebsiteType(prompt);
  const answers = await deterministicSiteProvider.understand(prompt, websiteType);
  const brief = await deterministicSiteProvider.brief(answers, websiteType);
  assert.doesNotThrow(() => briefSchema.parse(brief));
  assert.equal(brief.business.description, prompt);
  assert.deepEqual(brief.website.requiredPages, ["Home", "Shop", "About", "Contact"]);
});

test("deterministic output satisfies the structured site-plan contract", async () => {
  const brief = await deterministicSiteProvider.brief(answers, "business");
  assert.doesNotThrow(() => briefSchema.parse(brief));
  const architecture = await deterministicSiteProvider.architecture(brief);
  assert.doesNotThrow(() => architectureSchema.parse(architecture));
  for (const direction of await deterministicSiteProvider.brandDirections(brief)) {
    assert.doesNotThrow(() => brandDirectionSchema.parse(direction));
  }
  for (const section of await deterministicSiteProvider.content(brief, architecture)) {
    assert.doesNotThrow(() => siteSectionSchema.parse(section));
  }
});
