import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { clientIdentityGuard, parseTrustedProxies } from "../src/clientIdentity.js";
import { createIpRateLimits } from "../src/ipRateLimits.js";
import { validateEnvironment } from "../src/environmentValidation.js";

async function harness(peer = "172.18.0.5", limits = { globalLimit: 100, authLimit: 2, globalWindowMs: 1000, authWindowMs: 1000 }) {
  const app = express();
  const trusted = parseTrustedProxies("172.18.0.5,172.18.0.6,172.18.0.1");
  app.set("trust proxy", trusted);
  // Only the test transport replaces the socket address; production never uses headers for peers.
  app.use((req, _res, next) => { Object.defineProperty(req.socket, "remoteAddress", { value: peer, configurable: true }); next(); });
  app.use(clientIdentityGuard(trusted));
  const limiter = createIpRateLimits(limits);
  app.use(limiter.global);
  app.use("/auth", limiter.auth);
  app.get("*", (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  return { get: (xff?: string, path = "/", extra: Record<string, string> = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { ...(xff === undefined ? {} : { "x-forwarded-for": xff }), ...extra } }), close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

test("proxy trust accepts measured identities and rejects permissive or ambiguous configurations", () => {
  assert.deepEqual(parseTrustedProxies("172.18.0.5/32, ::1/128"), ["172.18.0.5/32", "::1/128"]);
  assert.deepEqual(parseTrustedProxies("loopback"), ["loopback"]);
  assert.deepEqual(parseTrustedProxies(), []);
  for (const value of ["true", "false", "2", "0", "uniquelocal", "linklocal", "172.16.0.0/12", "0.0.0.0/0", "::/0", "0.0.0.0", "::", "172.18.0.5,", "localhost", "127.0.0.1/33"]) {
    assert.throws(() => parseTrustedProxies(value));
    assert.equal(validateEnvironment({ CONTROL_CENTER_TRUST_PROXY: value }).valid, false);
  }
});

test("public and admin proxy chains resolve the actual IPv4 and IPv6 client", async () => {
  for (const peer of ["172.18.0.5", "172.18.0.6"]) {
    const h = await harness(peer);
    try {
      for (const ip of ["198.51.100.42", "2001:db8:1234::1", "::ffff:198.51.100.42"]) {
        const r = await h.get(`${ip}, 172.18.0.1`);
        assert.equal(r.status, 200); assert.equal((await r.json()).ip, ip);
      }
    } finally { await h.close(); }
  }
});

test("direct-origin callers cannot choose their identity with any forwarding header", async () => {
  const h = await harness("198.51.100.12");
  try {
    for (const xff of ["203.0.113.8", "invalid", "203.0.113.8,172.18.0.1", undefined]) {
      const r = await h.get(xff, "/", { "cf-connecting-ip": "203.0.113.9", "x-real-ip": "203.0.113.10", forwarded: "for=203.0.113.11" });
      assert.equal(r.status, 200); assert.equal((await r.json()).ip, "198.51.100.12");
    }
  } finally { await h.close(); }
});

test("missing and malformed trusted chains fail closed before reaching handlers", async () => {
  const h = await harness();
  try {
    for (const xff of [undefined, "", "unknown", "1.2.3.4:5000", "198.51.100.1,", "198.51.100.1,,172.18.0.1", "[2001:db8::1]", "198.51.100.1,invalid", "1".repeat(2049)]) assert.equal((await h.get(xff)).status, 400, String(xff));
  } finally { await h.close(); }
});

test("Express stops at the nearest untrusted hop rather than an attacker-supplied leftmost IP", async () => {
  const h = await harness();
  try { assert.equal((await (await h.get("203.0.113.8,198.51.100.1,172.18.0.1")).json()).ip, "198.51.100.1"); }
  finally { await h.close(); }
});

test("auth rate budgets are per client, exhaust, and recover after reset", async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = "staging";
  const h = await harness(undefined, { globalLimit: 100, authLimit: 2, globalWindowMs: 1000, authWindowMs: 150 });
  try {
    const a = "198.51.100.1,172.18.0.1", b = "198.51.100.2,172.18.0.1";
    assert.equal((await h.get(a, "/auth")).status, 200);
    assert.equal((await h.get(a, "/auth")).status, 200);
    assert.equal((await h.get(a, "/auth")).status, 429);
    assert.equal((await h.get(b, "/auth")).status, 200);
    assert.equal((await h.get(a, "/auth", { "cf-connecting-ip": "203.0.113.1" })).status, 429);
    await delay(200);
    assert.equal((await h.get(a, "/auth")).status, 200);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; await h.close(); }
});

test("global limiter groups equivalent IPv6 and rotations within a /56 but separates other prefixes", async () => {
  const h = await harness(undefined, { globalLimit: 2, authLimit: 100, globalWindowMs: 1000, authWindowMs: 1000 });
  try {
    assert.equal((await h.get("2001:db8:1234:5600::1,172.18.0.1")).status, 200);
    assert.equal((await h.get("2001:0db8:1234:56ff:0:0:0:2,172.18.0.1")).status, 200);
    assert.equal((await h.get("2001:db8:1234:5601::3,172.18.0.1")).status, 429);
    assert.equal((await h.get("2001:db8:1234:5700::1,172.18.0.1")).status, 200);
  } finally { await h.close(); }
});

test("auth limiter retains development/test exemption", async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = "test";
  const h = await harness();
  try { for (let i = 0; i < 5; i++) assert.equal((await h.get("198.51.100.1,172.18.0.1", "/auth")).status, 200); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; await h.close(); }
});

test("plain and mapped IPv4 share one budget while independent mapped clients stay independent", async () => {
  const h = await harness(undefined, { globalLimit: 2, authLimit: 100, globalWindowMs: 1000, authWindowMs: 1000 });
  try {
    assert.equal((await h.get("198.51.100.1,172.18.0.1")).status, 200);
    assert.equal((await h.get("::ffff:198.51.100.1,172.18.0.1")).status, 200);
    assert.equal((await h.get("0:0:0:0:0:ffff:c633:6401,172.18.0.1")).status, 429);
    assert.equal((await h.get("::ffff:198.51.100.2,172.18.0.1")).status, 200);
  } finally { await h.close(); }
});
