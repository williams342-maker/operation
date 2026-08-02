import test from "node:test";
import assert from "node:assert/strict";
import { nextLockedUntil, throttleKey, evaluateLoginThrottle, registerLoginFailure, clearLoginThrottle, type ThrottleRecord, type ThrottleStore } from "../src/authThrottle.js";

function memoryStore(): ThrottleStore & { map: Map<string, ThrottleRecord> } {
  const map = new Map<string, ThrottleRecord>();
  return {
    map,
    async get(key) { return map.get(key) ?? null; },
    async set(key, record) { map.set(key, record); },
    async delete(key) { map.delete(key); }
  };
}

test("nextLockedUntil: first four failures never lock, then exponential backoff capped at 30m", () => {
  const now = new Date("2026-08-02T00:00:00.000Z");
  assert.equal(nextLockedUntil(1, now), null);
  assert.equal(nextLockedUntil(4, now), null);
  assert.equal(nextLockedUntil(5, now)!.getTime() - now.getTime(), 60_000); // 1m
  assert.equal(nextLockedUntil(6, now)!.getTime() - now.getTime(), 120_000); // 2m
  assert.equal(nextLockedUntil(7, now)!.getTime() - now.getTime(), 240_000); // 4m
  assert.equal(nextLockedUntil(50, now)!.getTime() - now.getTime(), 30 * 60_000); // capped
});

test("throttleKey is stable, case-insensitive, and separates accounts", () => {
  assert.equal(throttleKey("Acme", "USER@Example.com"), throttleKey("acme", "user@example.com"));
  assert.notEqual(throttleKey("acme", "a@x.com"), throttleKey("acme", "b@x.com"));
  assert.notEqual(throttleKey("acme", "a@x.com"), throttleKey("other", "a@x.com"));
});

test("full cycle: not locked until 5th failure, then 429-worthy; success clears", async () => {
  const store = memoryStore();
  const key = throttleKey("acme", "victim@example.com");
  const t0 = new Date("2026-08-02T00:00:00.000Z");

  for (let i = 0; i < 4; i += 1) {
    await registerLoginFailure(key, t0, store);
    assert.equal((await evaluateLoginThrottle(key, t0, store)).locked, false, `still open after ${i + 1} failures`);
  }
  await registerLoginFailure(key, t0, store); // 5th
  const locked = await evaluateLoginThrottle(key, t0, store);
  assert.equal(locked.locked, true);
  assert.ok(locked.retryAfterSeconds > 0 && locked.retryAfterSeconds <= 60);

  // Lock elapses after the window.
  const later = new Date(t0.getTime() + 61_000);
  assert.equal((await evaluateLoginThrottle(key, later, store)).locked, false);

  // A success clears the counter entirely.
  await clearLoginThrottle(key, store);
  assert.equal(store.map.has(key), false);
});
