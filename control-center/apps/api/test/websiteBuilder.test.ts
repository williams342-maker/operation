import assert from "node:assert/strict";
import test from "node:test";
import { buildArchitecture, buildBrandDirections, buildImplementationPlan, buildProjectBrief, buildSiteContent, buildStaticSiteArtifact, buildValidation, regenerateSiteSection } from "../src/websiteBuilder.js";

const brief = buildProjectBrief([
  { questionId: "business_name", value: "Acme Makers" },
  { questionId: "business_purpose", value: "We help local makers sell handcrafted goods." },
  { questionId: "primary_audience", value: "Independent makers" },
  { questionId: "primary_goal", value: "Generate qualified inquiries" },
  { questionId: "primary_action", value: "Book a consultation" },
  { questionId: "brand_personality", value: "warm, trustworthy" },
  { questionId: "required_pages", value: "Home, Services, About, Contact" },
  { questionId: "launch_target", value: "October" },
], "business");

test("website builder creates a structured brief from bounded discovery answers", () => {
  assert.equal(brief.business.name, "Acme Makers");
  assert.deepEqual(brief.website.requiredPages, ["Home", "Services", "About", "Contact"]);
  assert.deepEqual(brief.brand.personality, ["warm", "trustworthy"]);
});

test("website architecture assigns stable routes and accessibility target", () => {
  const architecture = buildArchitecture(brief);
  assert.deepEqual(architecture.pages.map((page: any) => page.route), ["/", "/services", "/about", "/contact"]);
  assert.equal(architecture.accessibilityTarget, "WCAG 2.2 AA");
});

test("website builder produces three meaningfully distinct brand directions", () => {
  const directions = buildBrandDirections(brief);
  assert.equal(directions.length, 3);
  assert.equal(new Set(directions.map((item) => item.colors.join("|"))).size, 3);
});

test("website content remains structured by section", () => {
  const sections = buildSiteContent(brief, buildArchitecture(brief));
  assert.deepEqual(sections.map((section) => section.id), ["hero", "features", "about", "cta"]);
  assert.equal(sections.every((section) => section.heading.length > 0 && section.body.length > 0), true);
});

test("implementation plan is preview-only and carries rollback guidance", () => {
  const architecture = buildArchitecture(brief); const plan = buildImplementationPlan(architecture, buildSiteContent(brief, architecture));
  assert.equal(plan.repositoryMutation, false);
  assert.match(plan.deploymentImpact, /Preview only/);
  assert.match(plan.rollback, /prior immutable artifact version/);
});

test("preview validation fails closed when required content is absent", () => {
  assert.equal(buildValidation([]).passed, false);
  assert.equal(buildValidation(buildSiteContent(brief, buildArchitecture(brief))).passed, true);
});

test("section regeneration changes only one versioned artifact", () => {
  const original = buildSiteContent(brief, buildArchitecture(brief))[0]; const regenerated = regenerateSiteSection(original, brief);
  assert.equal(regenerated.id, original.id);
  assert.equal(regenerated.version, original.version + 1);
  assert.notEqual(regenerated.heading, original.heading);
});

test("static artifact escapes user-controlled HTML", () => {
  const unsafe = { ...brief, business: { name: "<script>alert(1)</script>", description: "Safe & sound" } }; const architecture = buildArchitecture(unsafe); const artifact = buildStaticSiteArtifact(unsafe, architecture, buildBrandDirections(unsafe)[0], buildSiteContent(unsafe, architecture));
  assert.doesNotMatch(artifact.html, /<script>alert/);
  assert.match(artifact.html, /&lt;script&gt;/);
  assert.match(artifact.html, /Safe &amp; sound/);
});

test("static artifact is reproducible and content addressed", () => {
  const architecture = buildArchitecture(brief); const brand = buildBrandDirections(brief)[0]; const sections = buildSiteContent(brief, architecture); const first = buildStaticSiteArtifact(brief, architecture, brand, sections); const second = buildStaticSiteArtifact(brief, architecture, brand, sections);
  assert.equal(first.html, second.html);
  assert.equal(first.sha256, second.sha256);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
});

test("static artifact rejects untrusted color tokens", () => {
  const architecture = buildArchitecture(brief); const artifact = buildStaticSiteArtifact(brief, architecture, { colors: ["red;position:fixed", "javascript:alert(1)", "url(evil)"] }, buildSiteContent(brief, architecture));
  assert.doesNotMatch(artifact.html, /javascript:|url\(evil\)|position:fixed/);
  assert.match(artifact.html, /--accent:#2563eb/);
});
