import { collections } from "./db.js";
import { hashSecret } from "./crypto.js";

// Progressive per-account login lockout. The first (LOCK_THRESHOLD - 1) consecutive failures are free;
// from the LOCK_THRESHOLD-th failure onward the account is locked for an exponentially growing window,
// capped at MAX_LOCK_MS. Keyed per (organization, email) so it also stops attacks distributed across
// many source IPs (which a per-IP limiter alone cannot). A successful login clears the counter.
const LOCK_THRESHOLD = 5;
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 30 * 60_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export type ThrottleRecord = { failures: number; lockedUntil: Date | null; updatedAt: Date; expiresAt: Date };

export interface ThrottleStore {
  get(key: string): Promise<ThrottleRecord | null>;
  set(key: string, record: ThrottleRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

// Pure backoff curve — exported for deterministic unit testing.
export function nextLockedUntil(failures: number, now: Date): Date | null {
  if (failures < LOCK_THRESHOLD) return null;
  const lockMs = Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (failures - LOCK_THRESHOLD));
  return new Date(now.getTime() + lockMs);
}

export function throttleKey(organizationSlug: string | undefined, email: string) {
  return hashSecret(`login\0${(organizationSlug || "").toLowerCase()}\0${email.toLowerCase()}`);
}

const databaseStore: ThrottleStore = {
  async get(key) {
    const doc = await collections.loginThrottle.findOne({ key });
    if (!doc) return null;
    return { failures: doc.failures, lockedUntil: doc.lockedUntil ?? null, updatedAt: doc.updatedAt, expiresAt: doc.expiresAt };
  },
  async set(key, record) {
    await collections.loginThrottle.updateOne(
      { key },
      { $set: { key, failures: record.failures, lockedUntil: record.lockedUntil, updatedAt: record.updatedAt, expiresAt: record.expiresAt } },
      { upsert: true }
    );
  },
  async delete(key) {
    await collections.loginThrottle.deleteOne({ key });
  }
};

export async function evaluateLoginThrottle(key: string, now = new Date(), store: ThrottleStore = databaseStore): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const record = await store.get(key);
  if (record?.lockedUntil && record.lockedUntil > now) {
    return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((record.lockedUntil.getTime() - now.getTime()) / 1000)) };
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export async function registerLoginFailure(key: string, now = new Date(), store: ThrottleStore = databaseStore) {
  const record = await store.get(key);
  // Once a lock has elapsed the counter keeps climbing, so repeat offenders escalate rather than reset.
  const failures = (record?.failures || 0) + 1;
  const lockedUntil = nextLockedUntil(failures, now);
  await store.set(key, { failures, lockedUntil, updatedAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS) });
  return { failures, lockedUntil };
}

export async function clearLoginThrottle(key: string, store: ThrottleStore = databaseStore) {
  await store.delete(key);
}
