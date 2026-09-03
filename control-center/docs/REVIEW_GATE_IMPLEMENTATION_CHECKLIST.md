# Split-authority implementation checklist

**Source:** design review round 6, **APPROVED-TO-IMPLEMENT**, 2026-09-02.
**Status:** this is the **reviewer's** list. It is what the candidate will be checked against.

> **Why this file exists rather than a section in the design.** Six design rounds produced 23 findings, 12
> HIGH, and the recurring failure was *my reading of my own document*. So the candidate is built to this
> list, not to my summary of the design. Where the two ever disagree, this file governs and the design is
> wrong.

**Blocked on certification, not on building:** these cases must run against a **real Mongo replica set** —
*"a skipped Mongo conformance suite is not sufficient for candidate approval"*. This machine has neither a
running Docker nor `mongod`. See §15 of `REVIEW_GATE_SPLIT_AUTHORITY_DESIGN.md`.

---

## A. Store conformance — identical against BOTH stores

### A1. Mint and identity

- both mint paths require the owner role;
- both write `identitySchemaVersion: v2`;
- both require distinct, explicit `bindingPrincipalId` and `audiencePrincipalId` — **no defaulting one to
  the other**;
- both include `bindingPrincipalId` and optional `supersedesAttestationId` in the v2 identity digest;
- `supersedesAttestationId`, when supplied: references an existing record; matches candidate, content
  digest, org and server; is immutable; **rejects every mismatch and nonexistent reference**;
- legacy v1 / absent-version records: reject reserve, bind, acquire, extension, redeem; remain readable,
  auditable, revocable, sweepable, reconcilable; are **never rewritten or migrated in place**.

### A2. Reserve boundary

**Positive:** the configured binder reserves a v2 `PENDING`, live attestation within its target scope.

**Negative, each independently exercised:** audience attempts reserve; unrelated principal; `lease.holderPrincipalId !== acting.principalId`; lease epoch ≠ acting epoch; stale/rotated binder credential; disabled binder; binder outside org/server scope; wrong state; expired attestation; unauthorizable released claim; lease expiry beyond attestation expiry; legacy v1.

**All refusals leave attestation and lease state unchanged.**

### A3. Bind boundary

**Positive:** the binder holding the lease binds the exact valid payload.

**Negative:** audience or unrelated principal; wrong lease holder; wrong lease id; stale lease epoch or
credential; expired lease or attestation; wrong state; released claim no longer authorizable; target
mismatch; payload/action digest mismatch; binder no longer provisioned for the target; legacy v1;
**`configuration.apply` with `configuration.rollback.v1`**; **`configuration.rollback` with
`configuration.apply.v1`**.

**On success assert:** `binderIncarnation` equals the canonical principal incarnation *read
transactionally*; `binderCredentialEpoch` equals the binding credential epoch; a durable bind audit event
carrying acting principal, credential epoch, action digest and time.

### A4. Pre-acquire renewal

Only the binder/lease holder may renew; requires current credential, correct lease id and epoch, live
lease and attestation, legal state; **the new expiry never moves backward** (test an explicitly earlier
requested deadline and assert rejection or no contraction); remains bounded by attestation expiry;
audience and unrelated principals refused; legacy v1 refused.

### A5. Acquire boundary

**Positive:** the audience acquires a bound record with its current credential and target scope while the
binder incarnation is still valid.

**Assert atomically:** `RESERVED_BOUND → EXECUTING`; executing principal is the audience;
`executingCredentialEpoch` equals the audience epoch used at acquire; `acquiredAt`, execution deadline,
attempt-token verifier and idempotency binding recorded; **plaintext token appears only in the single
successful response**; the binder's `acquireFence` increases by **exactly one**; **nothing commits if
either the principal-row fencing or the attestation transition fails**.

**Negative:** binder attempts acquire; unrelated principal; wrong audience; stale/rotated audience
credential; disabled audience; audience outside scope; wrong lease id; expired lease or attestation; wrong
state or second acquire; action digest / target / kind / released-claim mismatch; apply-rollback verb
mismatch; disabled binder before acquire; **binder disabled then re-enabled with a changed incarnation**;
missing or wrong recorded incarnation; legacy v1.

**Rotation and disablement:** binder rotation after bind does **not** block acquire; binder disablement
before acquire **does**; disable-then-enable still blocks the old binding; acquire committing before a
concurrent disable succeeds and stays `EXECUTING`; disablement committing first makes acquire refuse
**without changing the attestation**.

**Idempotency and token delivery:** first successful acquire returns exactly one plaintext token; the same
committed request identity returns `already_acquired` **and no token**; the same key with a different
request hash or binding tuple is rejected; a second key or process cannot acquire an already-executing
record; **the stored value is only a verifier**; record projections, audit events, logs, errors, generic
operation results, idempotency records and diagnostics **never contain token plaintext**; the successful
response carries `Cache-Control: no-store`.

### A6. Matched/modified count assertions

For the Mongo conditional binder-row update:

| | success | refusal |
|---|---|---|
| `matchedCount` | 1 | 0 (disabled or incarnation-mismatched) |
| `modifiedCount` | 1 | 0 |
| fence | `after === before + 1` | unchanged |

**`matchedCount === 1 && modifiedCount === 0` is a FAILURE, never a success.** Test with identical/fixed
timestamps, consecutive acquisitions on the same clock instant, a regressed clock, and a missing initial
`acquireFence` if backward-compatible principal rows are supported. These must demonstrate the **`$inc`**
is load-bearing and `lastAcquireAt` is not. The memory store must expose equivalent observable decisions
despite having no driver counts.

### A7. Execution extension boundary

**Positive:** the acquiring audience extends before the current deadline with its current credential, the
attempt token, **the same credential epoch recorded at acquire**, current target provisioning, a live
attestation and an authorizable released claim.

**Negative:** no token; wrong token; token from another attestation or attempt; binder or unrelated
principal holding the token; **rotated audience credential even with a valid token**; disabled audience;
stale credential; target scope removed; expired execution deadline; expired attestation; released claim no
longer authorizable; non-`EXECUTING` state; legacy v1; requested deadline earlier than current; beyond the
per-extension bound; beyond `min(acquiredAt + configuredMaximumExecutionDuration, attestation.expiresAt)`.

Assert constant-time verifier comparison, and that extension never returns or persists plaintext token
material.

### A8. Redeem boundary

**Positive:** the original current audience credential with a valid attempt token; **and** a rotated
audience's *new* current credential with the same valid token.

**Negative:** binder or unrelated principal; disabled audience; stale/non-current credential; missing or
wrong token; token from another attempt; target scope removed; wrong execution state; execution deadline
passed; action/target/kind/digest mismatch; released claim no longer authorizable; legacy v1.

**Assert specifically that redeem does NOT compare the current epoch with `executingCredentialEpoch`:** a
post-rotation redeem passes while a post-rotation *extension* of the same attempt fails.

### A9. Disable, enable, rotation, reconciliation

Rotation increments the credential epoch but **not** the incarnation; disable increments the incarnation
monotonically and disables the principal; **enable does not restore the previous incarnation**; disable
mutates **only** the canonical principal row and its audit record, never attestations; `EXECUTING`
attestations are **never** changed to `REVOKED` by disablement; owner revocation stays linearizable
against acquire; reconciliation sets `resolvedByPrincipalId` **from the authenticated owner** and rejects
or ignores caller-supplied attribution; incident enumeration can query `EXECUTING` by
`bindingPrincipalId`, backed by the required index.

---

## B. Public-interface choreography test — the activation gate

An executable gate, not a service or store test.

1. start from a released candidate;
2. provision separate owner, binder and executor principals with appropriate target scopes;
3. owner mints a v2 attestation naming both principals;
4. **through the real client/API**, authenticate as the binder and reserve;
5. construct the final configuration or upgrade sub-payload;
6. **through the real client/API**, authenticate as the binder and bind;
7. verify the apply/rollback action-to-schema mapping during bind;
8. form the final outer task payload containing the bound review authorization;
9. obtain the real owner signature over that final outer payload;
10. dispatch through the normal control-center workflow;
11. poll through the real agent protocol;
12. run an `ENFORCING` agent authenticated **only** with its configured executor credential;
13. agent acquires immediately before the effect point and receives the single-delivery token;
14. agent durably records the attempt **before** the effect;
15. if execution exceeds the initial window, extend with the current credential and token;
16. perform the real effect;
17. redeem after the effect;
18. assert the terminal gate state and the executor's durable reconciliation evidence;
19. **repeat with a configuration rollback payload** so both verb mappings are covered.

**The test must forbid:** direct `AttestationService` calls; direct store reads or mutations for setup
after the initial released-candidate fixture; authenticating as an arbitrary principal; giving the
executor the binder credential; giving the provisioner the executor credential; bypassing the normal
dispatch/poll path; injecting the attempt token through fixtures or persistent client state.

---

## C. Candidate-level security checks

- public schemas and clients carry all new identity, lineage, binder, incarnation, execution-attempt and
  extension fields;
- principal target-scope naming is **neutral**, not audience-specific;
- attempt-token plaintext is **structurally absent** from record and audit types;
- constant-time verification for **both** principal credentials and attempt tokens;
- Mongo transactions cover the principal fence write **and** the attestation transition together;
- required indexes exist, particularly incident lookup by `bindingPrincipalId`;
- both stores return equivalent refusal codes and leave equivalent state after failures;
- tests prove **transactional rollback after an injected failure between the principal update and the
  attestation update**;
- tests prove concurrent acquire/acquire, acquire/disable, acquire/revoke, extension/expiry and
  redeem/expiry outcomes;
- existing authorization invariants remain covered alongside the new cases;
- **no executor activation unless the full choreography test passes.**
