import assert from "node:assert/strict";
import test from "node:test";
import { deriveWebsiteTarget, displayNameFromDomain, normalizeWebsiteUrl, slugFromDomain } from "../src/onboarding.js";

test("URL-first onboarding derives normalized values", () => {
  assert.deepEqual(deriveWebsiteTarget("opsworkbench.org/"), { normalizedUrl: "https://opsworkbench.org", domain: "opsworkbench.org", displayName: "OpsWorkbench", slug: "opsworkbench" });
  assert.equal(normalizeWebsiteUrl("HTTPS://Example.COM:443/"), "https://example.com");
  assert.equal(slugFromDomain("www.production-api.example"), "production-api");
  assert.equal(displayNameFromDomain("production-api.example"), "Production Api");
});

test("URL normalization rejects non-http protocols", () => assert.throws(() => normalizeWebsiteUrl("file:///etc/passwd")));
