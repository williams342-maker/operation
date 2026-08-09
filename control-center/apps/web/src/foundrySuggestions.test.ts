import { describe, expect, it } from "vitest";
import { buildSuggestions } from "./foundrySuggestions";
import type { FoundryWorkflow } from "./foundryApi";

const base: FoundryWorkflow = {
  id: "1", websiteType: "business", stage: "preview_ready", version: 1,
  estimatedCredits: 5, actualCredits: 0, createdAt: "", updatedAt: "",
  brief: { business: { name: "Rise & Co", description: "A bakery" } },
  architecture: { pages: [{ title: "Home", route: "/" }, { title: "About", route: "/about" }] },
  sections: [
    { id: "hero", type: "hero", heading: "H", body: "B", version: 1 },
    { id: "features", type: "features", heading: "F", body: "B", version: 1 },
  ],
  artifact: { version: 1, filename: "x.html", mimeType: "text/html", html: "<html></html>", sha256: "a", bytes: 1, generatedAt: "" },
};

describe("foundry suggestions", () => {
  it("returns nothing before a preview exists", () => {
    expect(buildSuggestions({ ...base, artifact: undefined })).toEqual([]);
    expect(buildSuggestions(null)).toEqual([]);
  });

  it("returns 2–4 project-specific suggestions once the preview is ready", () => {
    const suggestions = buildSuggestions(base);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.length).toBeLessThanOrEqual(4);
    // Every suggestion is free while deterministic and must say so honestly.
    expect(suggestions.every((s) => s.credits === 0)).toBe(true);
  });

  it("offers a reversible, apply-able hero rewrite tied to the real section id", () => {
    const hero = buildSuggestions(base).find((s) => s.id === "regen-hero");
    expect(hero?.action).toEqual({ kind: "regenerate", sectionId: "hero" });
    expect(hero?.reversible).toBe(true);
  });

  it("recommends a contact page only when the project has none", () => {
    expect(buildSuggestions(base).some((s) => s.id === "add-contact")).toBe(true);
    const withContact = { ...base, architecture: { pages: [{ title: "Contact", route: "/contact" }] } };
    expect(buildSuggestions(withContact).some((s) => s.id === "add-contact")).toBe(false);
  });
});
