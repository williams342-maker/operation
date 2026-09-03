# The dispatch gap: the sequence in §2.6 has no actor that can execute it

**Date:** 2026-09-02
**Author:** Claude
**Status:** **FINDING — needs independent confirmation before it is acted on.** It contradicts a design
that already holds a GO, and my record in this workstream is claims that outrun the mechanism. Verify it
before believing it.

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
- **The owner signs `actionDigest`,** which is fixed at bind and covers `reviewAuthorization`
  (`privilegedActionDigest` excludes only `ownerAuthorization`).
- **The only channel that delivers a payload to an executor is the signed task dispatch** — which is
  step 5, *after* bind and sign.

So the executor must hold the payload at step 3 and cannot receive one until step 5. **Circular.**

This is the same species of defect §2.6 exists to fix. Its own opening paragraph says of v4: *"It was a
protocol that could not execute in any order, and I did not notice because I wrote the two halves in
different revisions."* The halves this time are the gate's principal constraints and the sequence's
ordering.

## Why every suite is green anyway

The gate's tests drive `reserve` and `bind` directly as `agent-1`, because a test can authenticate as
anyone. **No component can.** My own `executorEffectPoint.test.ts` does the same in its setup, then calls
`executeTask` — so it faithfully measures the executor's half of a protocol whose other half has no
implementation. Every test is honest about what it tests; none of them tests that the sequence can be
*produced*.

Restated as the pattern this workstream keeps hitting: the tests confirm each step in isolation, and the
thing that does not work is the composition.

## The escapes, and why each fails

1. **The control-center performs reserve and bind using the executor's gate credential.** Then the
   component that *requests* a deployment also supplies the proof that it was reviewed, which is the
   decorative-review failure the design names in `reviewGateClient.ts`. It also breaks execution: the
   executor is a different principal, and `acquire` by a non-holder is refused `not_lease_holder`
   (verified).
2. **The owner signs before bind.** Impossible. The digest is fixed at bind and covers ids that do not
   exist until reserve.
3. **The agent binds at poll time against an unsigned proposal, then the owner signs, then a second
   dispatch delivers the signed task.** This is coherent and is probably the answer, but **it does not
   exist** — it needs new endpoints on both sides, and it puts an offline human signature inside every
   deployment's critical path.

## What this does NOT change

- The executor wiring (W3, `7b62c0c6`) is still correct for its own scope, and its GO stands. It refuses
  correctly; it is the thing that would have to be *fed* that is missing.
- Nothing is at risk in production. Every executor is `DISABLED`, and a `DISABLED` executor behaves
  exactly as before. **The gap is a reason activation cannot be switched on, not a vulnerability.**
- The gate service's GO stands for its built scope. The gap is in the *composition*, which no candidate
  has claimed.

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

I have a view — (b), because (a) makes the gate a deployment bottleneck an on-call engineer will demand be
switched off, which is how enforcement dies. But this is a trust-model decision and it is not mine.
