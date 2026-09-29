# One-time password enforcement

Administrator-created and reset passwords expire after 72 hours by default. Set
`CONTROL_CENTER_OTP_TTL_HOURS` to a positive whole number of hours to change both
lifetimes. Startup rejects invalid values and durations that cannot be represented
as a safe integer in milliseconds. An absent setting uses 72; blank is invalid.

Password login verifies the credential before reporting `PASSWORD_EXPIRED`. A
flagged account with a missing, malformed, or future issue timestamp needs a new
password issued by an administrator. Expiry is checked again when changing the
password, so a session created before expiration cannot redeem an expired secret.

Every session-authenticated endpoint requires a current password by default.
Only GET/HEAD `/me`, POST `/auth/change-password`, and POST `/auth/logout` permit
flagged users, and these still enforce session validity and applicable CSRF checks.
Reauthentication is gated. Google authentication also yields a restricted session;
the user must supply the administrator-issued password to choose a different one.
Successful password change clears both invitation fields and revokes older sessions.

The current repository has one combined web application, including the administrator
and Foundry interfaces; there is no separate `apps/admin`. Its root checks identity
before mounting protected navigation and presents the mandatory form for either
login method, reloads, and `PASSWORD_CHANGE_REQUIRED` responses.

Users and sessions carry an optional authentication revision. Missing values mean
legacy revision zero; malformed revisions are rejected. Resets, password changes,
owner replacement, revocation, and deactivation advance the revision. A login
already in flight cannot resurrect a revoked session. Password changes atomically
compare the verified credential, revision, and enabled state before updating them;
only the winning session can advance to that revision. Older cleanup operations
do not remove sessions belonging to later revisions.

On eventual owner-approved deployment, existing flagged users become restricted
on their next request. No database migration or bulk rewriting of legacy users is
needed. Existing flagged invitations without valid timestamps must be reissued.
Rollback to code that does not enforce the flag would restore the original defect;
this change is development-only until the normal owner-gated release process.

Run the API suite and database suites using a disposable `MONGO_URL_TEST`. The
focused `otpIntegration.test.ts` tests exercise roles, direct routes, password and
Google authentication, stale sessions, invalid invitations, replay, and controlled
credential races. `node scripts/otp-mutation-check.mjs` runs the focused database
suite against three temporary mutants in an isolated source copy. The working
source files are never mutated. The runner requires database tests enabled and first verifies the clean
baseline, preventing skipped tests or a broken environment from counting as kills.
