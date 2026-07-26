import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/seoRoutes.ts", import.meta.url), "utf8");

test("SEO routes enforce distinct read and scan permissions", () => {
  assert.match(source, /get\("\/projects\/:id\/seo"[\s\S]*requirePermission\("seo:view"\)/);
  assert.match(source, /post\("\/projects\/:id\/seo\/audits"[\s\S]*requirePermission\("seo:scan"\)/);
});

test("SEO scans derive the target from scoped project configuration and record audit evidence", () => {
  assert.doesNotMatch(source, /req\.body\.(?:url|targetUrl)/);
  assert.match(source, /healthChecks\.findOne\(\{ orgId, projectId, enabled: true/);
  assert.match(source, /servers\.findOne\(\{ _id: project\.primaryServerId, orgId/);
  assert.match(source, /action: "seo\.audit\.run"/);
  assert.match(source, /action: "seo\.audit\.failure"/);
});

test("SEO routes persist only bounded crawl evidence and advertise the exact limit", () => {
  assert.match(source, /runSeoAudit\(found\.targetUrl, body\.keywords, body\.maxPages\)/);
  assert.match(source, /pages: result\.pages, crawl: result\.crawl/);
  assert.match(source, /multiPageCrawl: true, maximumPages: 25/);
});
