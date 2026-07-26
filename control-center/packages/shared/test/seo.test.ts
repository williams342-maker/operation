import assert from "node:assert/strict";
import test from "node:test";
import { seoAuditRequestSchema } from "../src/seo.js";

test("SEO audit input normalizes and deduplicates target phrases", () => {
  assert.deepEqual(seoAuditRequestSchema.parse({ keywords: [" Deployment Platform ", "deployment platform", "Monitoring"] }), { keywords: ["deployment platform", "monitoring"], maxPages: 10 });
  assert.deepEqual(seoAuditRequestSchema.parse({ keywords: [], maxPages: 25 }), { keywords: [], maxPages: 25 });
  assert.throws(() => seoAuditRequestSchema.parse({ keywords: [], maxPages: 26 }));
  assert.throws(() => seoAuditRequestSchema.parse({ keywords: Array.from({ length: 11 }, (_, index) => `term-${index}`) }));
  assert.throws(() => seoAuditRequestSchema.parse({ keywords: [], targetUrl: "http://127.0.0.1" }));
});
