import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAddress, validatePublicHealthCheckUrl } from "../src/urlDiscovery.js";
import { analyzeSeoHtml, extractSameOriginLinks, siteFindings } from "../src/seoAudit.js";

test("URL discovery blocks SSRF-sensitive address ranges", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1", "fe80::1"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("SEO analyzer rewards complete indexable metadata", () => {
  const html = `<html lang="en"><head><title>Reliable Operations for Growing Engineering Teams</title><meta name="description" content="A clear and complete description that helps search visitors understand this page before clicking through to learn more."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com"></head><body><h1>Operations made clear</h1><img src="a.png" alt="Dashboard"></body></html>`;
  const result = analyzeSeoHtml(html, 200);
  assert.equal(result.score, 100);
  assert.equal(result.findings.every((item) => item.severity === "pass"), true);
});

test("SEO analyzer reports missing metadata and noindex", () => {
  const result = analyzeSeoHtml(`<html><head><meta name="robots" content="noindex"></head><body><h1>One</h1><h1>Two</h1><img src="a.png"></body></html>`, 503);
  assert.ok(result.score < 50);
  assert.equal(result.findings.find((item) => item.id === "indexable")?.severity, "error");
  assert.equal(result.findings.find((item) => item.id === "image-alt")?.severity, "error");
});

test("SEO crawl discovery keeps only unique same-origin HTTP links", () => {
  const links = extractSameOriginLinks(`<a href="/about">About</a><a href="https://example.com/about#team">Team</a><a href="https://other.test/escape">Other</a><a href="mailto:a@example.com">Mail</a>`, "https://example.com/");
  assert.deepEqual(links, ["https://example.com/about"]);
});

test("site findings identify broken pages and duplicate metadata", () => {
  const findings = siteFindings([
    { url: "https://example.com/", httpStatus: 200, score: 90, pageTitle: "Shared", metaDescription: "Shared description", findings: [] },
    { url: "https://example.com/about", httpStatus: 404, score: 40, pageTitle: "Shared", metaDescription: "Shared description", findings: [] },
  ]);
  assert.equal(findings.find((item) => item.id === "site-broken-pages")?.severity, "error");
  assert.equal(findings.find((item) => item.id === "site-duplicate-titles")?.severity, "warning");
  assert.equal(findings.find((item) => item.id === "site-duplicate-descriptions")?.severity, "warning");
});

test("deployment health validation rejects prohibited targets before dispatch", async () => {
  for (const url of ["http://127.0.0.1", "http://169.254.169.254/latest/meta-data", "http://[::1]", "http://user:pass@1.1.1.1", "file:///etc/passwd", "not a url"]) await assert.rejects(() => validatePublicHealthCheckUrl(url));
  assert.equal(await validatePublicHealthCheckUrl("https://1.1.1.1/healthz"), "https://1.1.1.1/healthz");
  assert.equal(await validatePublicHealthCheckUrl("https://[2606:4700:4700::1111]/healthz"), "https://[2606:4700:4700::1111]/healthz");
});
