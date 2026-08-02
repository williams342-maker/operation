import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hashPassword, verifyPassword } from "../src/crypto.js";

test("new password hashes use PBKDF2 at 600k iterations and round-trip", () => {
  const stored = hashPassword("correct horse battery staple");
  const parts = stored.split("$");
  assert.equal(parts[0], "pbkdf2");
  assert.equal(parts.length, 4);
  assert.equal(Number(parts[1]), 600_000);
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
  assert.equal(verifyPassword("wrong password", stored), false);
});

test("legacy 3-field PBKDF2 hashes (120k) still verify", () => {
  // Reproduce the pre-migration on-disk format: pbkdf2$<salt>$<hash> at 120k iterations.
  const salt = crypto.randomBytes(16).toString("hex");
  const legacyHash = crypto.pbkdf2Sync("legacy-secret", salt, 120_000, 32, "sha256").toString("hex");
  const legacyStored = `pbkdf2$${salt}$${legacyHash}`;
  assert.equal(verifyPassword("legacy-secret", legacyStored), true);
  assert.equal(verifyPassword("not-the-secret", legacyStored), false);
});

test("malformed stored hashes are rejected without throwing", () => {
  assert.equal(verifyPassword("x", ""), false);
  assert.equal(verifyPassword("x", "notpbkdf2$a$b"), false);
  assert.equal(verifyPassword("x", "pbkdf2$abc$salt$hash"), false); // non-integer iterations
  assert.equal(verifyPassword("x", "pbkdf2$600000$salt"), false); // too few fields
});
