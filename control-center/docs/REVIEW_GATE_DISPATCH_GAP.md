# The dispatch gap: the sequence in §2.6 has no actor that can execute it

**Date:** 2026-09-02
**Author:** Claude
**Status:** **CONFIRMED by independent review, 2026-09-02.** Four corrections came back with the
confirmation — two factual errors in my argument and two places where my scope statement was too generous
to myself. All four are applied below and marked, because the corrections are more instructive than the
finding.

---

## The claim, stated so it can be falsified

> With the review gate as built and the agent as built, **there is no sequence of actions by any existing
> component that produces a privileged task an activated executor would accept.**

Not "it is awkward". There is no ordering. Activating an executor today would refuse every configuration
deployment and every agent upgrade to that host, fail-closed, permanently — and no owner action alone
could fix it, because nothing can construct a conforming task.

## Why

The steps and their permitted actors, all verified against the code rather than the design text:

| step | who may do it | enforced by | verified |
|---|---|---|---|
| mint | owner | role check | `attestationService.recordOwnerDecision` |
| **reserve** | **the `audiencePrincipalId`** | `wrong_audience` | probe + `attestationService.test.ts:304` |
| **bind** | **the lease holder** | `not_lease_holder` | `attestationService.bind` |
| **acquire** | **the lease holder** | `not_lease_holder` | probe + `forging.test.ts:224` |
| **redeem** | **the lease holder** | `not_lease_holder` | `store.redeemAttestation` |

The lease holder is whoever reserved, and only the audience may reserve. So **one principal must perform
reserve, bind, acquire and redeem.**

`acquire` and `redeem` happen on the managed host at execution time — that is the whole point of the
enforcement point, and it is what the executor's own credential is for. Therefore that one principal is
**the executor**.

Now the ordering, from §2.6: mint → reserve → **bind** → **sign** → **dispatch** → acquire → apply →
redeem.

- **bind requires the final payload.** The gate validates it against the reviewed subject and computes
  `actionDigest` from it.
- **The owner signs a digest of the final OUTER payload**, which contains the bound sub-payload and its
  review ids. *(Corrected: I first wrote "the owner signs the `actionDigest` fixed at bind". Not true —
  the gate binds `privilegedActionDigest(subPayload)` while layer 2 signs
  `privilegedActionDigest(outerTaskPayload)`. That asymmetry is the one already documented in
  `reviewEnforcedExecution.ts`. It does not weaken the argument, because **both** scopes contain the
  `reviewAuthorization` ids, so neither can be finalised before reservation — but the sentence was
  wrong.)*
- **The only channel that delivers a payload to an executor is the signed task dispatch** — which is
  step 5, *after* bind and sign.

So the executor must hold the payload at step 3 and cannot receive one until step 5. **Circular.**

This is the same species of defect §2.6 exists to fix. Its own opening paragraph says of v4: *"It was a
protocol that could not execute in any order, and I did not notice because I wrote the two halves in
different revisions."* The halves this time are the gate's principal constraints and the sequence's
ordering.

## Why every suite is green anyway

The gate's tests drive `reserve` and `bind` directly as `agent-1`. My own `executorEffectPoint.test.ts`
does the same in its setup, then calls `executeTask` — so it faithfully measures the executor's half of a
protocol whose other half has no implementation.

*(Corrected: I first wrote "no component can authenticate as `agent-1`". Too broad — **the agent does
exactly that**, every time it acquires. The precise statement is:*

> *No existing component authenticates as the executor to perform reserve and bind **at a point when it
> possesses the prospective payload**.*

*The distinction matters, because it locates the gap in the ORDERING and the missing client methods rather
than in identity. The agent's `ReviewGateClient` implements only `acquire` and `redeem`; the gate's
`/reserve` and `/bind` routes exist and have no caller anywhere in the repository.)*

Every test is honest about what it tests; none tests that the sequence can be *produced*.

Restated as the pattern this workstream keeps hitting: the tests confirm each step in isolation, and the
thing that does not work is the composition.

## The escapes, and why each fails

1. **The control-center performs reserve and bind using the executor's gate credential.** Then the
   component that *requests* a deployment also supplies the proof that it was reviewed, which is the
   decorative-review failure the design names in `reviewGateClient.ts`. It also breaks execution: the
   executor is a different principal, and `acquire` by a non-holder is refused `not_lease_holder`
   (verified).
2. **The owner signs before bind.** Impossible under the present schemas: `leaseId` does not exist until
   reserve, and it sits inside the payload the owner signs.
3. **The agent binds at poll time against an unsigned proposal, then the owner signs, then a second
   dispatch delivers the signed task.** Coherent, faithful to the current single-holder design, and
   **absent** — it needs a proposal/preparation protocol, reserve/bind support in the agent's client, and
   a completion/signing/dispatch phase.

   *(Noted here because I got it wrong further down: the offline human signature sits in every
   deployment's critical path under **all three** options, since layer 2 is unchanged in all of them. It
   is not a cost specific to this one, and I should not have used it to argue against it.)*

## What this does NOT change

- The executor wiring (W3, `7b62c0c6`) is still correct for its own scope, and its GO stands. It refuses
  correctly; it is the thing that would have to be *fed* that is missing.
- Nothing is at risk in production. Every executor is `DISABLED`, and a `DISABLED` executor behaves
  exactly as before. **The gap is a reason activation cannot be switched on, not a vulnerability.**
- The gate service's **implementation** GO stands narrowly: its code correctly implements the local
  contract it states.

  *(Corrected, and this is the one I got wrong in my own favour. I originally wrote that the gate's GO
  stands because "the gap is in the composition, which no candidate has claimed". The reviewer's answer:
  the **design** GO does not stand unchanged. §2.6 explicitly claims the sequence is executable and
  non-circular and calls reserve/bind executor operations — this finding falsifies those composition
  claims directly. Describing the whole gate deliverable as GO without a blocking qualification is too
  generous. The build state now carries that qualification.)*

## The test that should have caught this, and should gate activation

A **public-interface choreography test**, which by construction cannot be written as a passing test today —
that is exactly the defect:

1. start from a released candidate and an owner-minted attestation;
2. use **only** the APIs and clients the control-center and agent actually expose;
3. produce a real configuration or upgrade task through the normal workflow;
4. poll it through the real agent protocol;
5. require an **ENFORCING** agent to acquire and execute it;
6. **forbid** direct calls to `AttestationService`, direct store mutation, and authenticating as an
   arbitrary principal.

Rule 6 is the whole point: every existing test violates it in setup, which is why they are green. After
the protocol is fixed, this test should be the gate on activation — not a checklist item, the test.

## What I am NOT doing

Building the missing dispatcher. Option 3 above is a protocol change touching the owner's offline signing
flow, and I am not going to design that alone and then discover in review that I had picked the shape that
made the code shortest — which is exactly what the last three rounds were about. It needs a design round
first, and the owner has a stake in it because it decides whether a human signature sits in the middle of
every deployment.

## The question for the owner, when the finding is confirmed

Where should reserve and bind happen, given that the signer is offline?

- **(a) The executor reserves and binds** during a pre-dispatch exchange, and the owner signs afterwards.
  Faithful to the design's trust model; puts an offline signature in every deployment's path.
- **(b) A separate provisioning principal** reserves and binds, and the executor acquires and redeems.
  Removes the human from the path, and requires the gate to split "who may bind" from "who may acquire" —
  a real weakening that needs its own review.
- **(c) Batch or standing authorizations** — the owner signs a class of deployments in advance. Largest
  change to the trust model; needs its own design round.

I had a view — (b) — **and my stated reason for it was false.** I wrote that (b) removes the offline human
signature from every deployment's critical path. It does not: under layer 2 unchanged, the owner must
still sign after the lease ids exist and the final outer payload is formed. Whatever (b) is worth, it is
not worth that.

**What the reviewer confirmed about (b), stated properly.** It is the smallest practical shape, and it is
not inherently a collapse of layer 3 — provided the split is explicit rather than an ad-hoc loosening of
"lease holder":

- two separate authorities, `bindingPrincipalId` and `audiencePrincipalId`, named as such;
- the provisioning principal may prepare only a payload matching released, reviewed content;
- it **cannot** acquire or redeem;
- the executor remains the fixed execution audience and is the only thing that can cross the host effect
  point;
- the offline owner signature remains independently required.

The authority actually added is **availability and allocation** — a provisioner can reserve, bind, exhaust
or strand attestations. It must not gain authority to forge reviewed content or to execute it. That is a
real and bounded cost, and it is the honest way to describe the trade.

**Removing the human from the path is a separate, larger change** — it needs a layer-2 decision such as
scoped standing or batch owner authorization, and it should not be smuggled in as a side effect of fixing
the ordering.

The decision remains the owner's.
