import assert from "node:assert/strict";
import test from "node:test";
import { agentPollRequestSchema, cloudflareOnboardingSchema, connectivityStatusSchema } from "../src/index.js";

test("Cloudflare onboarding requires only the enabled provider secrets", () => {
  assert.equal(cloudflareOnboardingSchema.safeParse({ enabled: false, tunnel: { enabled: false }, access: { enabled: false } }).success, true);
  assert.equal(cloudflareOnboardingSchema.safeParse({ enabled: true, tunnel: { enabled: true }, access: { enabled: false } }).success, false);
  assert.equal(cloudflareOnboardingSchema.safeParse({ enabled: true, tunnel: { enabled: true, token: "a-secure-one-time-tunnel-token" }, access: { enabled: true, clientId: "client-id", clientSecret: "client-secret-value" } }).success, true);
});

test("connectivity heartbeat exposes status but no credentials", () => {
  const status = { provider: "cloudflare", configured: true, state: "connected", service: { installed: true, active: true, enabled: true, version: "cloudflared 1", uptimeSeconds: 10 }, tunnel: { connected: true, identifier: "safe-tunnel-id" }, observedAt: new Date().toISOString() };
  assert.equal(connectivityStatusSchema.safeParse(status).success, true);
  assert.equal(agentPollRequestSchema.safeParse({ heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "test" }, connectivity: [status] }).success, true);
  assert.equal(JSON.stringify(status).includes("token"), false);
  assert.equal(JSON.stringify(status).includes("secret"), false);
});
