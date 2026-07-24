import assert from "node:assert/strict";
import test from "node:test";
import { requestSafeHttp, resolveSafeHttpTarget, safeHttpErrorCategory, UnsafeHttpTargetError } from "../src/safeHttp.js";

test("agent rejects literal, DNS-resolved, and mixed private health targets", async () => {
  for (const url of [
    "http://127.0.0.1/health",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/health",
    "http://192.0.2.1/health",
    "http://[2001:db8::1]/health"
  ]) await assert.rejects(() => resolveSafeHttpTarget(url), UnsafeHttpTargetError);
  await assert.rejects(() => resolveSafeHttpTarget("https://health.example.test/health", async () => ["10.0.0.4"]), UnsafeHttpTargetError);
  await assert.rejects(() => resolveSafeHttpTarget("https://health.example.test/health", async () => ["93.184.216.34", "127.0.0.1"]), UnsafeHttpTargetError);
});

test("agent pins the validated address used for the request", async () => {
  const calls: Array<{ url: string; address: string }> = [];
  const result = await requestSafeHttp("https://health.example.test/health", 1000, {
    resolve: async () => ["93.184.216.34"],
    request: async (url, _timeout, address) => { calls.push({ url: url.toString(), address }); return { statusCode: 204 }; },
    now: (() => { let value = 1000; return () => value += 5; })()
  });
  assert.deepEqual(calls, [{ url: "https://health.example.test/health", address: "93.184.216.34" }]);
  assert.equal(result.statusCode, 204);
  assert.equal(result.latencyMs, 5);
});

test("agent revalidates every redirect and never requests a private destination", async () => {
  let requests = 0;
  const resolver = async (hostname: string) => hostname === "health.example.test" ? ["93.184.216.34"] : ["169.254.169.254"];
  await assert.rejects(() => requestSafeHttp("https://health.example.test/start", 1000, {
    resolve: resolver,
    request: async () => { requests += 1; return { statusCode: 302, location: "http://metadata.example.test/latest" }; }
  }), UnsafeHttpTargetError);
  assert.equal(requests, 1);
});

test("agent rejects credential-bearing redirects and excess redirect chains", async () => {
  const resolver = async () => ["93.184.216.34"];
  await assert.rejects(() => requestSafeHttp("https://health.example.test/start", 1000, {
    resolve: resolver,
    request: async () => ({ statusCode: 302, location: "https://user:password@health.example.test/next" })
  }), UnsafeHttpTargetError);
  let requests = 0;
  await assert.rejects(() => requestSafeHttp("https://health.example.test/start", 1000, {
    resolve: resolver,
    request: async (_url) => ({ statusCode: 302, location: `/redirect-${++requests}` })
  }), UnsafeHttpTargetError);
  assert.equal(requests, 4);
});

test("safe HTTP errors remain bounded categories", () => {
  assert.equal(safeHttpErrorCategory(new UnsafeHttpTargetError()), "network");
  const timeout = new Error("request timeout"); timeout.name = "AbortError";
  assert.equal(safeHttpErrorCategory(timeout), "timeout");
  assert.equal(safeHttpErrorCategory(new Error("getaddrinfo ENOTFOUND")), "dns");
  assert.equal(safeHttpErrorCategory(new Error("TLS certificate rejected")), "tls");
});
