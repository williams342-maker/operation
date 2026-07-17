import test from "node:test";
import assert from "node:assert/strict";
import { NonceStore, isFreshTimestamp, signRequest, verifyRequestSignature } from "../src/signing.js";

test("request signatures validate canonical method/path/body", () => {
  const parts = { method: "POST", path: "/api/agent/poll", timestamp: new Date().toISOString(), nonce: "n1", body: "{\"ok\":true}" };
  const signature = signRequest("secret", parts);
  assert.equal(verifyRequestSignature("secret", parts, signature), true);
  assert.equal(verifyRequestSignature("secret", { ...parts, body: "{\"ok\":false}" }, signature), false);
});

test("timestamps reject stale requests", () => {
  assert.equal(isFreshTimestamp(new Date().toISOString()), true);
  assert.equal(isFreshTimestamp(new Date(Date.now() - 10 * 60 * 1000).toISOString()), false);
});

test("nonce store prevents replay inside TTL", () => {
  const store = new NonceStore(1000);
  assert.equal(store.use("agent-a", "nonce-1", 1000), true);
  assert.equal(store.use("agent-a", "nonce-1", 1001), false);
  assert.equal(store.use("agent-b", "nonce-1", 1001), true);
  assert.equal(store.use("agent-a", "nonce-1", 3001), true);
});
