import assert from "node:assert/strict";
import test from "node:test";
import { websiteBuilderContentSchema, websiteBuilderGenerateSchema, websiteBuilderSaveSchema } from "../src/index.js";

const content = {
  siteName: "Crafters Market", tagline: "Made by local hands", description: "A market for independent makers.", primaryCta: "Shop now",
  palette: { primary: "#06b6d4", accent: "#22c55e", background: "#07131f", text: "#f8fafc" },
  sections: [
    { id: "hero", type: "hero", heading: "Discover something original", body: "Meet local makers.", buttonLabel: "Browse" },
    { id: "about", type: "about", heading: "Made with care", body: "Every item has a story." }
  ]
};

test("website builder accepts bounded structured content", () => {
  assert.equal(websiteBuilderContentSchema.parse(content).sections.length, 2);
  assert.equal(websiteBuilderSaveSchema.parse({ baseRevision: 0, content }).source, "manual");
  assert.equal(websiteBuilderSaveSchema.parse({ baseRevision: 2, source: "ai", content }).source, "ai");
});

test("website builder rejects unsafe or unrenderable structures", () => {
  assert.equal(websiteBuilderContentSchema.safeParse({ ...content, palette: { ...content.palette, primary: "javascript:alert(1)" } }).success, false);
  assert.equal(websiteBuilderContentSchema.safeParse({ ...content, sections: [{ ...content.sections[0], type: "script" }, content.sections[1]] }).success, false);
  assert.equal(websiteBuilderContentSchema.safeParse({ ...content, sections: [content.sections[0]] }).success, false);
  assert.equal(websiteBuilderContentSchema.safeParse({ ...content, html: "<script>alert(1)</script>" }).success, false);
});

test("AI generation requires an explicit meaningful prompt", () => {
  assert.equal(websiteBuilderGenerateSchema.safeParse({ prompt: "Build a welcoming site for local artists", current: content }).success, true);
  assert.equal(websiteBuilderGenerateSchema.safeParse({ prompt: "short" }).success, false);
});
