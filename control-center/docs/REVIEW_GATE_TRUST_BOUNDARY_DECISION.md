# Review gate — trust boundary decision required

**Date:** 2026-09-02
**Author:** Claude
**Disposition:** **BLOCKED — OWNER ACTION REQUIRED**
**Status of work:** ten candidates built, ten independent reviews, ten NO-GO. Production mutations: 0.

---

## Why this document exists

I stopped, and I said in advance that I would.

In candidate K's handoff I asked the independent reviewer a direct question: *"If this still looks like
the same shape, say so plainly — I will stop patching and take a redesign proposal to the owner instead.
I would rather hear that now than after three more rounds."*

Round 10's answer:

> **"Yes, plainly, candidate K still has the same shape. A stronger runtime token replaced TypeScript
> privacy, but the authority token is passed into caller-supplied code. Incremental patching should stop
> pending an explicit trust-boundary redesign."**

Continuing to iterate would be ignoring the answer to my own question.

---

## The defect that ends the line

Candidate K gave the store's write methods a capability object that cannot be constructed outside its
module. The service holds it privately and passes it on every write.

**But the application supplies the store.** So a consumer writes eleven lines:

```ts
const wrapper: ReviewGateStore = {
  async create(capability, record) {
    captured = capability;              // the real singleton, handed over willingly
    return realStore.create(capability, record);
  },
  // ...delegate the rest
};
new ReviewGateService(wrapper, authenticator);
```

No constructor access. No private symbol. No prototype trick. **The gate hands its own authority token to
code the gate does not control, because that code is on the other side of an interface the gate depends
on.**

This is the same shape as rounds 3, 5, 8 and 9. Each time I built a mediator, called it the boundary, and
left the mediated capability reachable — through an export, a property, and now an argument.

---

## The actual root cause

**Everything in this design lives in one process, and the application owns that process.**

`ReviewGateService` is an object the application constructs, holding a store the application supplies,
authenticated by an authenticator the application implements. Every "boundary" is therefore a boundary
between the application and code it wrote or injected. `#private` fields and capability tokens raise the
cost of a mistake — genuinely, and they are worth keeping — but they cannot make the application less
trusted than itself.

**The gate as built is a workflow control, not a security boundary.** It reliably prevents accident,
process drift, and an agent taking a shortcut through the intended API. It does not withstand code that
sets out to go around it. Nine rounds of my handoffs described it as the latter. That was the recurring
error, and it was mine rather than the reviewer's to catch.

---

## The decision

Three options. They are not ranked by cost alone — they answer different questions about what the gate is
*for*.

### Option A — Accept it as a workflow control

Keep the current design. Rewrite the claims to match what it does: it enforces the review lifecycle for
code that goes through the service, and it does not defend against code that does not.

- **Cost:** roughly a day. Documentation and claim correction, plus fixing the two genuine policy defects
  round 10 also found (below). No architecture change.
- **You get:** a working, well-tested review lifecycle with candidate identity, enforced independence,
  accumulated findings and remediation lineage — 189 tests today.
- **You do not get:** any guarantee against a determined agent or a compromised dependency in the same
  process. If the point of the gate is to constrain *me*, this option does not achieve it.

### Option B — Make the gate a separate service *(my recommendation)*

The review gate runs as its own process with its own database. The control-center talks to it over an
authenticated API. Authority never crosses into caller-supplied code because the caller is on the far end
of a network boundary.

- **Cost:** meaningfully more — a deployment unit, its database, an API surface, auth between the two,
  and operational ownership. Best estimate: one to two weeks, and it adds a service to run forever.
- **You get:** a real boundary. The store is not injectable, the capability never leaves the process, and
  the durable-store invariants (§H.16 — four of them now) become that service's internal problem instead
  of a contract I hope an implementer honours.
- **Why I recommend it:** the gate exists because an author should not be able to certify their own work,
  and the author it is most concerned with is an autonomous agent running inside the control-center. Under
  Option A that agent is on the trusted side of every boundary, which defeats the purpose.

### Option C — Sign the decisions

Verdicts and state transitions become signed records. The store is treated as untrusted; validity is
verified from signatures rather than from who wrote the row.

- **Cost:** comparable to B, plus key management — and it needs **key material I am not authorised to
  create**, which is already the standing owner-authority item for test provenance.
- **You get:** the strongest property — a forged decision is detectable after the fact even if storage is
  fully compromised.
- **Note:** B and C compose well. C without B still leaves the signing key inside the application process.

---

## What I need from you

**One decision: A, B, or C.** Everything else in this workstream proceeds without you.

If it helps to decide: the question underneath is *"is code running inside the control-center trusted not
to bypass the review gate?"* Option A says yes, B says no, C says no and also distrusts the database.

---

## Also found in round 10, and not yet fixed

Two real defects, independent of the trust question. I have not fixed them because their design depends on
which option you pick.

1. **CRITICAL — successor inheritance is a non-atomic snapshot.** A successor copies its predecessor's
   outstanding findings at creation, and nothing marks the predecessor as superseded. So the predecessor
   can go round the loop again, collect a *new* finding, and the successor — which knows nothing about it
   — can still reach GO. Multiple successors can also be created from one predecessor.
2. **MAJOR — my capability tests pass for the wrong reason.** They pass `{}` as the capability and confirm
   it is refused. They never intercept the *real* capability, which is exactly the attack that works. The
   constructor test proves the token cannot be *built*, not that it cannot be *obtained*. **Fourth test of
   mine to certify a hole rather than catch one.**

---

## State of the work

Nothing is merged, deployed, or wired to a running route. `main` is untouched at `07244a83`. The branch
`feat/review-gate-20260902` holds all ten candidates and their reviews; `REVIEW_GATE_HANDOFF_INDEX.md` has
the full lineage.

**The work is not wasted under any option.** The lifecycle, candidate and content identity, independence
checks, evidence records, accumulated findings and remediation lineage are all policy that Option B or C
would keep — they would move it behind a real boundary rather than replace it.

**Production mutations: 0.**
