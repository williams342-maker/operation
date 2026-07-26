import { describe, expect, it } from "vitest";
import { renderWebsiteDocument, websiteBuilderFilename } from "./websiteBuilderExport";

const content = { siteName: "Maker <House>", tagline: "Original & local", description: "Shop <script>alert(1)</script>", primaryCta: "Browse", palette: { primary: "#06b6d4", accent: "#22c55e", background: "#07131f", text: "#f8fafc" }, sections: [{ id: "hero", type: "hero" as const, heading: "Made by hand", body: "Find one-of-a-kind work." }, { id: "contact", type: "contact" as const, heading: "Say hello", body: "We would love to hear from you.", buttonLabel: "Contact" }] };

describe("website builder export", () => {
  it("creates a standalone responsive document and escapes all authored content", () => {
    const html = renderWebsiteDocument(content);
    expect(html).toContain("<!doctype html>"); expect(html).toContain('name="viewport"'); expect(html).toContain("@media(max-width:480px)");
    expect(html).toContain("Maker &lt;House&gt;"); expect(html).toContain("Shop &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>"); expect(html).not.toContain("http://"); expect(html).not.toContain("https://");
  });
  it("produces a bounded filesystem-safe filename", () => { expect(websiteBuilderFilename(content.siteName)).toBe("maker-house.html"); expect(websiteBuilderFilename("***")).toBe("website.html"); });
});
