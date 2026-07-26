import assert from "node:assert/strict";
import test from "node:test";
import { fetchPublicWebsite, isPublicAddress, pinnedWebsiteLookup, validatePublicHealthCheckUrl } from "../src/urlDiscovery.js";

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

test("pinned website lookup supports Node single-address and all-address callbacks", async () => {
  const lookup = pinnedWebsiteLookup("1.1.1.1") as (...args: unknown[]) => void;
  await new Promise<void>((resolve, reject) => lookup("example.test", {}, (error: Error | null, address: string, family: number) => {
    try { assert.ifError(error); assert.equal(address, "1.1.1.1"); assert.equal(family, 4); resolve(); } catch (failure) { reject(failure); }
  }));
  await new Promise<void>((resolve, reject) => lookup("example.test", { all: true }, (error: Error | null, addresses: Array<{ address: string; family: number }>) => {
    try { assert.ifError(error); assert.deepEqual(addresses, [{ address: "1.1.1.1", family: 4 }]); resolve(); } catch (failure) { reject(failure); }
  }));
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

test("SEO discovery can capture a protected redirect without following its query state", async () => {
  const requested: string[] = [];
  const result = await fetchPublicWebsite("https://public.example.test/", {
    captureBlockedRedirect: true,
    resolve: async () => [{ address: "1.1.1.1", family: 4 }],
    request: async (url) => {
      requested.push(url.toString());
      return { status: 302, url: url.toString(), headers: { location: "https://login.example.test/access?state=sensitive" }, text: "" };
    }
  });
  assert.equal(result.blockedRedirect, true);
  assert.equal(result.response.status, 302);
  assert.deepEqual(requested, ["https://public.example.test/"]);
});
