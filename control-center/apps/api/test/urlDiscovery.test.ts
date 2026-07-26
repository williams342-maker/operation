import assert from "node:assert/strict";
import test from "node:test";
import { fetchPublicWebsite, isPublicAddress, validatePublicHealthCheckUrl } from "../src/urlDiscovery.js";

test("URL discovery blocks SSRF-sensitive address ranges", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "192.0.2.1", "198.51.100.1", "203.0.113.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("deployment health validation rejects prohibited targets before dispatch", async () => {
  for (const url of ["http://127.0.0.1", "http://169.254.169.254/latest/meta-data", "http://192.0.2.1", "http://[::1]", "http://[2001:db8::1]", "http://user:pass@1.1.1.1", "file:///etc/passwd", "not a url"]) await assert.rejects(() => validatePublicHealthCheckUrl(url));
  assert.equal(await validatePublicHealthCheckUrl("https://1.1.1.1/healthz"), "https://1.1.1.1/healthz");
  assert.equal(await validatePublicHealthCheckUrl("https://[2606:4700:4700::1111]/healthz"), "https://[2606:4700:4700::1111]/healthz");
});

test("health validation rejects DNS answers containing any private address", async () => {
  await assert.rejects(() => validatePublicHealthCheckUrl("https://health.example.test/status", async () => [{ address: "10.0.0.4", family: 4 }]));
  await assert.rejects(() => validatePublicHealthCheckUrl("https://health.example.test/status", async () => [{ address: "1.1.1.1", family: 4 }, { address: "169.254.169.254", family: 4 }]));
  assert.equal(await validatePublicHealthCheckUrl("https://health.example.test/status", async () => [{ address: "1.1.1.1", family: 4 }]), "https://health.example.test/status");
});

test("website discovery pins a public address and revalidates redirects", async () => {
  const requested: Array<{ url: string; address: string }> = [];
  const resolve = async (hostname: string) => hostname === "public.example.test"
    ? [{ address: "1.1.1.1", family: 4 }]
    : [{ address: "169.254.169.254", family: 4 }];
  await assert.rejects(() => fetchPublicWebsite("https://public.example.test/start", {
    resolve,
    request: async (url, address) => {
      requested.push({ url: url.toString(), address });
      return { status: 302, url: url.toString(), headers: { location: "http://metadata.example.test/latest" }, text: "" };
    }
  }));
  assert.deepEqual(requested, [{ url: "https://public.example.test/start", address: "1.1.1.1" }]);
});

test("website discovery rejects credential-bearing redirect destinations", async () => {
  await assert.rejects(() => fetchPublicWebsite("https://public.example.test/start", {
    resolve: async () => [{ address: "1.1.1.1", family: 4 }],
    request: async (url) => ({ status: 302, url: url.toString(), headers: { location: "https://user:secret@public.example.test/private" }, text: "" })
  }), /not an approved public HTTP target/);
});
