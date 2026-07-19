import assert from "node:assert/strict";
import test from "node:test";
import { calculateAgentStatus, publicSiteStatus } from "../src/serverStatus.js";
import { websiteFailureStatus } from "../src/urlDiscovery.js";

const now = new Date("2026-07-18T00:10:00.000Z");

test("agent heartbeat status uses online, degraded, offline and never-connected states", () => {
  assert.equal(calculateAgentStatus(undefined, undefined, now), "never_connected");
  assert.equal(calculateAgentStatus(new Date(now.getTime() - 60_000), undefined, now), "online");
  assert.equal(calculateAgentStatus(new Date(now.getTime() - 3 * 60_000), undefined, now), "degraded");
  assert.equal(calculateAgentStatus(new Date(now.getTime() - 10 * 60_000), undefined, now), "offline");
  assert.equal(calculateAgentStatus(now, now, now), "revoked");
});

test("website status preserves redirects and classifies network failures", () => {
  assert.equal(publicSiteStatus(200, false), "reachable");
  assert.equal(publicSiteStatus(200, true), "redirecting");
  assert.equal(publicSiteStatus(503, false), "unreachable");
  assert.equal(websiteFailureStatus(new Error("getaddrinfo ENOTFOUND missing.example")), "dns_error");
  assert.equal(websiteFailureStatus(new Error("certificate hostname mismatch")), "tls_error");
  assert.equal(websiteFailureStatus(new Error("connection refused")), "unreachable");
});
