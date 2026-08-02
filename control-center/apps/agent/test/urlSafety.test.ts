import test from "node:test";
import assert from "node:assert/strict";
import { publicAddress, validateHttpCheckUrl, probeHttp } from "../src/urlSafety.js";

test("publicAddress rejects loopback, private, link-local, CGNAT, and metadata addresses", () => {
  for (const blocked of ["127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1"]) {
    assert.equal(publicAddress(blocked), false, `${blocked} should be blocked`);
  }
});

test("publicAddress allows routable public unicast addresses", () => {
  for (const ok of ["8.8.8.8", "1.1.1.1", "203.0.113.10", "2606:4700:4700::1111"]) {
    assert.equal(publicAddress(ok), true, `${ok} should be allowed`);
  }
});

test("validateHttpCheckUrl rejects non-http schemes and literal internal IPs", async () => {
  await assert.rejects(validateHttpCheckUrl("file:///etc/passwd"), /rejected/);
  await assert.rejects(validateHttpCheckUrl("http://169.254.169.254/latest/meta-data/"), /rejected/);
  await assert.rejects(validateHttpCheckUrl("http://127.0.0.1:9000/"), /rejected/);
});

test("validateHttpCheckUrl blocks hostnames that resolve to private addresses (DNS)", async () => {
  const rebind = async () => ["10.0.0.5"];
  await assert.rejects(validateHttpCheckUrl("http://internal.example.test/", rebind), /rejected/);
  const publicResolve = async () => ["93.184.216.34"];
  const url = await validateHttpCheckUrl("http://example.test/health", publicResolve);
  assert.equal(url.hostname, "example.test");
});

test("probeHttp refuses to contact a private target (guard runs before any fetch)", async () => {
  await assert.rejects(probeHttp("http://127.0.0.1/", 1000), /rejected/);
  await assert.rejects(probeHttp("http://169.254.169.254/", 1000), /rejected/);
});
