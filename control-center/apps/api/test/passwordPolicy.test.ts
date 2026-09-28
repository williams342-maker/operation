import test from "node:test";
import assert from "node:assert/strict";
import { oneTimePasswordExpired, otpTtlHours } from "../src/passwordPolicy.js";
import { validateEnvironment } from "../src/environmentValidation.js";
import { authenticationVersion } from "../src/auth.js";

test("only absent revisions are legacy; malformed revisions fail closed", () => {
  assert.equal(authenticationVersion(undefined), 0);
  assert.equal(authenticationVersion(0), 0);
  assert.equal(authenticationVersion(4), 4);
  for (const value of [null, -1, 0.5, NaN, Infinity, "0", Number.MAX_SAFE_INTEGER]) assert.equal(authenticationVersion(value), null);
});

test("OTP TTL defaults to 72 hours and rejects unsafe configuration", () => {
  assert.equal(otpTtlHours({}), 72);
  for (const value of ["1", "72", "720"]) assert.equal(otpTtlHours({ CONTROL_CENTER_OTP_TTL_HOURS: value }), Number(value));
  for (const value of ["", " ", "0", "-1", "1.5", "NaN", "Infinity", "2501999793", "1e2", "0x48"]) {
    assert.throws(() => otpTtlHours({ CONTROL_CENTER_OTP_TTL_HOURS: value }));
    assert.equal(validateEnvironment({ CONTROL_CENTER_OTP_TTL_HOURS: value }).valid, false);
  }
  assert.equal(validateEnvironment({ CONTROL_CENTER_OTP_TTL_HOURS: "72" }).diagnostics.some(d => d.code === "unknown_variable"), false);
});

test("OTP expiry boundary fails closed for malformed invitations and leaves regular users unaffected", () => {
  const now = Date.now();
  const ttl = otpTtlHours() * 3_600_000;
  assert.equal(oneTimePasswordExpired({ mustChangePassword: true, inviteIssuedAt: new Date(now - ttl + 1) }, now), false);
  assert.equal(oneTimePasswordExpired({ mustChangePassword: true, inviteIssuedAt: new Date(now - ttl) }, now), true);
  for (const issued of [undefined, new Date(NaN), new Date(now + 1), "not-a-date"])
    assert.equal(oneTimePasswordExpired({ mustChangePassword: true, inviteIssuedAt: issued as Date }, now), true);
  assert.equal(oneTimePasswordExpired({ inviteIssuedAt: new Date(0) }, now), false);
});
