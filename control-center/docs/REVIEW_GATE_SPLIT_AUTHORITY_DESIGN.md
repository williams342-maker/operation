# Split authority: `bindingPrincipalId` and `audiencePrincipalId`

**Date:** 2026-09-02
**Author:** Claude
**Status:** **DESIGN, FOR REVIEW BEFORE ANY CODE.** The owner chose option (b) from
`REVIEW_GATE_DISPATCH_GAP.md`. This is the delta design, not an implementation.

> **Why a design round rather than building it.** This workstream's last three NO-GOs were design errors
> that survived code review, and its predecessor took six design rounds before a line was written. The
> confirming reviewer was explicit that this split needs *"two explicitly separate authorities rather than
> weakening 'lease holder' ad hoc"*. Weakening it ad hoc is exactly what I would do if I started from the
> code.

---

## 1. What was chosen

A **provisioning principal** reserves and binds. The **executor** acquires and redeems. The offline owner
signature is unchanged and still independently required.

This fixes the circularity because the binder can hold the prospective payload — it is the party
constructing it — while the executor, which cannot hold a payload before dispatch, is no longer required
to bind one.

## 2. The two authorities

| | `bindingPrincipalId` | `audiencePrincipalId` |
|---|---|---|
| set at | mint, by the owner | mint, by the owner (**exists today**) |
| may `reserve` | **yes** | no *(changed: it may today)* |
| may `bind` | yes, as lease holder | no |
| may `renew` | yes, as lease holder | no |
| may `acquire` | **no** | **yes** *(changed: only the lease holder may today)* |
| may `redeem` | **no** | **yes** *(changed)* |
| crosses the host effect point | never | always |

Both are fixed at mint and immutable, and both must therefore enter `attestationIdentityDigest`, which
today covers `audiencePrincipalId` and would silently omit the new one.

## 3. The crux: one function currently bundles two authorities

`#leaseHeld(record, actingPrincipal, leaseId, epoch, now)` asserts five things at once:

1. a lease exists
2. `lease.holderPrincipalId === acting`
3. `lease.leaseId === leaseId`
4. `lease.credentialEpoch === acting.credentialEpoch`
5. the lease has not expired

Checks 1, 3 and 5 are about **the lease**. Checks 2 and 4 are about **who took it**. Acquire and redeem
need the former and must not use the latter, because under (b) the actor is deliberately not the holder.

**Proposed split — two named predicates, not a boolean flag on one:**

- `bindingAuthority(record, acting, leaseId, now)` — all five checks. Used by `bind` and `renew`.
- `executionAuthority(record, acting, leaseId, now)` — checks 1, 3, 5, plus
  `record.audiencePrincipalId === acting.principalId` and `acting.mayActOn(orgId, serverId)`. Used by
  `acquire` and `redeem`.

A flag such as `#leaseHeld(..., { asAudience: true })` would be the ad-hoc weakening the reviewer warned
about: the two call sites would share a code path whose meaning depends on an argument, and the next
person to touch it would have to reconstruct which authority they were in.

## 4. Credential rotation — three questions

The existing rule, from `store.ts`: *"no operation using the old credential may commit after rotation
commits, so the CURRENT principal is read inside the same transaction as the mutation."* That is
`#credentialCurrent(acting.principalId, acting.credentialEpoch)`, which already runs first in every
credential-sensitive store method and is **unaffected by this change** — it checks the actor against the
store, whoever the actor is.

The lease's own `credentialEpoch` is a different thing: it ties the lease to the credential that took it.

**Q1. Must the executor's credential be current at acquire?** *Proposed: yes* — already true via
`#credentialCurrent`, no change needed.

**Q2. Does the BINDER's rotation after bind invalidate execution?** *Proposed: no.* The binding is
immutable, content-validated, and the owner signed the resulting payload. Stranding every bound
attestation on a binder rotation is an availability failure with no security gain — an attacker holding a
stolen binder credential still cannot produce the owner's signature. **I hold this weakly and want it
challenged**, because the opposite argument (a rotation means the credential may have leaked, so anything
it touched is suspect) is not unreasonable.

**Q3. Should the audience's epoch be pinned at mint?** *Proposed: no.* Pinning it would make every routine
executor credential rotation invalidate in-flight attestations, and Q1 already ensures the executor
presenting a credential is presenting a current one.

## 5. What the provisioner can and cannot do — stated exactly

The confirming reviewer described the added authority as "availability and allocation". Having checked
`validatePayload`, I think that is **right, but for a reason worth being precise about**, and one part of
it is sharper than that phrase suggests.

**It gains NO new content authority.** The gate pins, per attestation: the change set (via
`configurationChangeDigest(mutations)`), `environmentId`, `targetProfileId`, `targetProfileRevision`, and
— fixed at mint by the owner — `kind`, `contentDigest`, `orgId`, `serverId`. The provisioner cannot move
a reviewed change to another host, another environment, or another change set.

**It gains availability and allocation authority.** It can reserve, bind, exhaust, or strand
attestations, and a bound attestation cannot be re-bound. That is real and it is new.

**The sharp part, which is NOT new but becomes attributable.** `validatePayload` does *not* pin
`repositoryRoot`, `environmentFilePath`, `composePath`, `composeProject`, `statelessServices`,
`protectedServices`, `healthChecks`, `expectedConfigurationDigest`, `planId`, `deploymentId`, or
`automaticRollback`. Whoever constructs the payload chooses those, and **only the owner's signature
constrains them.** Today that discretion sits with the control-center, unnamed and with no identity of its
own. Option (b) does not create it — it *names the principal that holds it*, which is a net improvement in
attributability rather than a new exposure.

**This belongs in the residual trust list (§3.1) regardless of option (b), and is currently missing.** The
list mentions sealed *values* but not these structural fields. Proposed entry:

> **The payload fields the reviewed subject does not pin** — filesystem paths, compose project, service
> lists, health checks, expected-state digest. The gate binds *which change* is applied and *where* in the
> estate; it does not bind *where on the host*. Only layer 2 constrains these, which means the owner is
> signing something they must actually read.

## 6. Compatibility

`bindingPrincipalId` is new and must be **required at mint**, not optional-with-a-default. Defaulting it
to `audiencePrincipalId` would preserve today's behaviour, which is precisely the unexecutable protocol —
a default that reproduces the bug is worse than a migration.

No stored attestation has the field, and none can be executed today, so there is nothing to migrate.

## 7. The activation gate

The choreography test from `REVIEW_GATE_DISPATCH_GAP.md` becomes writable under this design and **must
pass before any executor is activated**: only exposed APIs and clients, no direct `AttestationService`
calls, no store mutation, no authenticating as an arbitrary principal. Every existing test breaks that
last rule in setup, which is why they were all green while the protocol could not execute.

It should be the gate on activation — not an item on a list, the test.

## 8. What this design does NOT decide

- **Whether the human stays in the critical path.** Under layer 2 unchanged, the owner signs after the
  lease ids exist, in **every** option. Removing that needs scoped standing or batch owner authorization
  and is a separate, larger trust-model change. I previously claimed option (b) removed it; it does not.
- **Who runs the provisioner.** A control-center component, a separate service, or an operator tool are
  all consistent with this design. It matters operationally and I have no basis to choose yet.

## 9. Questions for the reviewer

1. Q2 above — should a binder rotation strand bound attestations? I proposed no, weakly.
2. Is `executionAuthority` missing a check? I have it asserting audience identity, target provisioning,
   lease existence, lease id, and lease expiry — but *not* holder or lease epoch, deliberately.
3. Does `bindingPrincipalId` belong in `attestationIdentityDigest`? I say yes, by the same argument that
   put `audiencePrincipalId` there. If so, is that a breaking change to any stored digest?
4. Is there a reason the provisioner should be prevented from binding a payload whose unpinned fields
   differ from what the reviewer saw — or is "the owner signs it" genuinely the right and only answer?
