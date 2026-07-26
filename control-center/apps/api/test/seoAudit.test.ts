import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSeoDocument, discoverSeoPageUrls, runSeoAudit, sitemapPageUrls } from "../src/seoAudit.js";

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
  const result = await runSeoAudit("https://public.example.test/health", [], 1, {
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
  await assert.rejects(() => runSeoAudit("https://private.example.test", [], 1, { resolve: async () => [{ address: "10.0.0.9", family: 4 }] }), /private or reserved/);
});

test("SEO audit records a protected login redirect instead of following query state", async () => {
  const requested: string[] = [];
  const result = await runSeoAudit("https://protected.example.test/", [], 1, {
    resolve: async () => [{ address: "1.1.1.1", family: 4 }],
    request: async (url) => {
      requested.push(url.toString());
      if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") return { status: 404, url: url.toString(), headers: {}, text: "" };
      return { status: 302, url: url.toString(), headers: { location: "https://access.example.test/login?state=sensitive" }, text: "" };
    }
  });
  assert.equal(result.pages.length, 1);
  assert.equal(result.evidence.redirectBlocked, true);
  assert.ok(result.findings.some((finding) => finding.code === "protected-redirect" && finding.severity === "critical"));
  assert.equal(requested.includes("https://access.example.test/login?state=sensitive"), false);
});

test("page discovery keeps normalized same-origin HTML candidates only", () => {
  const html = '<a href="/about?utm=x#team">About</a><a href="https://external.test/page">External</a><a href="/asset.png">Image</a><a href="mailto:test@example.test">Mail</a><a href="/about">Duplicate</a>';
  assert.deepEqual(discoverSeoPageUrls(html, "https://public.example.test/"), ["https://public.example.test/about"]);
  assert.deepEqual(sitemapPageUrls("<urlset><url><loc>https://public.example.test/pricing?ref=map</loc></url><url><loc>https://external.test/</loc></url></urlset>", "https://public.example.test/"), ["https://public.example.test/pricing"]);
});

test("multi-page audit follows bounded sitemap URLs and reports duplicates and broken pages", async () => {
  const requested: string[] = [];
  const pageHtml = (url: string) => `<title>Shared site title for testing</title><meta name="description" content="A sufficiently detailed shared description used to verify duplicate metadata across bounded audited pages."><link rel="canonical" href="${url}"><h1>Page heading</h1>`;
  const result = await runSeoAudit("https://public.example.test/", [], 3, {
    resolve: async () => [{ address: "1.1.1.1", family: 4 }],
    request: async (url) => {
      requested.push(url.toString());
      if (url.pathname === "/robots.txt") return { status: 200, url: url.toString(), headers: { "content-type": "text/plain" }, text: "User-agent: *" };
      if (url.pathname === "/sitemap.xml") return { status: 200, url: url.toString(), headers: { "content-type": "application/xml" }, text: '<urlset><url><loc>https://public.example.test/about</loc></url><url><loc>https://public.example.test/broken</loc></url></urlset>' };
      if (url.pathname === "/broken") return { status: 500, url: url.toString(), headers: { "content-type": "text/html" }, text: pageHtml(url.toString()) };
      return { status: 200, url: url.toString(), headers: { "content-type": "text/html" }, text: pageHtml(url.toString()) };
    }
  });
  assert.equal(result.pages.length, 3);
  assert.equal(result.crawl.limit, 3);
  assert.ok(result.findings.some((finding) => finding.code.startsWith("duplicate-title")));
  assert.ok(result.findings.some((finding) => finding.code.includes("page-http-status") && finding.evidence.url === "https://public.example.test/broken"));
  assert.deepEqual(requested, ["https://public.example.test/", "https://public.example.test/robots.txt", "https://public.example.test/sitemap.xml", "https://public.example.test/about", "https://public.example.test/broken"]);
});

test("multi-page audit refuses cross-origin redirects without requesting the destination", async () => {
  const requested: string[] = [];
  const result = await runSeoAudit("https://public.example.test/", [], 2, {
    resolve: async () => [{ address: "1.1.1.1", family: 4 }],
    request: async (url) => {
      requested.push(url.toString());
      if (url.pathname === "/sitemap.xml") return { status: 200, url: url.toString(), headers: {}, text: '<urlset><url><loc>https://public.example.test/leaves</loc></url></urlset>' };
      if (url.pathname === "/leaves") return { status: 302, url: url.toString(), headers: { location: "https://external.example.test/page" }, text: "" };
      return { status: 200, url: url.toString(), headers: { "content-type": "text/html" }, text: '<title>Public website title that is long enough</title><meta name="description" content="A complete public website description that is long enough for the bounded metadata review range used here."><link rel="canonical" href="https://public.example.test/"><h1>Public website</h1>' };
    }
  });
  assert.equal(requested.includes("https://external.example.test/page"), false);
  assert.ok(result.findings.some((finding) => finding.evidence.reason === "cross-origin-redirect"));
});
