import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSeoDocument, runSeoAudit } from "../src/seoAudit.js";

test("SEO analysis reports truthful category evidence and target phrase coverage", () => {
  const result = analyzeSeoDocument({
    html: '<!doctype html><html><head><title>Short</title></head><body><h1>Deploy safely</h1><img src="hero.jpg"><a href="/pricing">Pricing</a></body></html>',
    requestedUrl: "https://example.test", finalUrl: "https://example.test/", status: 200, responseTimeMs: 750, redirected: false, robotsStatus: 404, sitemapStatus: 404, keywords: ["server monitoring"]
  });
  assert.ok(result.score < 100);
  assert.equal(result.evidence.h1Count, 1);
  assert.equal(result.evidence.imagesMissingAlt, 1);
  assert.ok(result.findings.some((finding) => finding.code === "description-missing"));
  assert.ok(result.findings.some((finding) => finding.code === "response-time" && finding.summary.includes("not a Core Web Vitals")));
  assert.ok(result.findings.some((finding) => finding.evidence.keyword === "server monitoring"));
});

test("SEO analysis rejects a successful JSON health endpoint as website evidence", () => {
  const result = analyzeSeoDocument({ html: '{"ok":true}', requestedUrl: "https://example.test/api/health", finalUrl: "https://example.test/api/health", status: 200, contentType: "application/json", responseTimeMs: 20, redirected: false });
  assert.ok(result.findings.some((finding) => finding.code === "content-type" && finding.severity === "critical"));
});

test("SEO audit uses pinned public fetches for the registered page and origin files", async () => {
  const requested: string[] = [];
  const result = await runSeoAudit("https://public.example.test/health", [], {
    resolve: async () => [{ address: "1.1.1.1", family: 4 }],
    request: async (url, address) => {
      assert.equal(address, "1.1.1.1"); requested.push(url.toString());
      if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") return { status: 200, url: url.toString(), headers: {}, text: "ok" };
      return { status: 200, url: url.toString(), headers: {}, text: '<title>OpsWorkbench deployment and monitoring</title><meta name="description" content="Deploy and monitor applications with secure release controls and operational evidence for every project."><link rel="canonical" href="https://public.example.test/health"><h1>Deploy with confidence</h1>' };
    }
  });
  assert.deepEqual(requested, ["https://public.example.test/health", "https://public.example.test/robots.txt", "https://public.example.test/sitemap.xml"]);
  assert.equal(result.evidence.robotsStatus, 200);
  assert.equal(result.findings.some((finding) => finding.code === "https-missing"), false);
});

test("SEO audit rejects a registered target that resolves privately", async () => {
  await assert.rejects(() => runSeoAudit("https://private.example.test", [], { resolve: async () => [{ address: "10.0.0.9", family: 4 }] }), /private or reserved/);
});
