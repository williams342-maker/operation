import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import { MongoReviewGateStore, ensureIndexes } from "../src/mongoStore.js";
import { disable, enable } from "../src/operator.js";
import { hashCredential } from "../src/auth.js";
import { record, attestation, dig } from "./storeConformance.js";
import type { Principal } from "../src/store.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CHECKLIST §C — "tests prove transactional rollback after an INJECTED FAILURE between the principal
// update and the attestation update".
//
// `acquireAttestation` does two writes in one transaction: it `$inc`s the binder's fence, and then it
// transitions the attestation to EXECUTING. The store's comment claims that "nothing commits if EITHER
// the fencing write or the transition fails". Nothing measured that. Every other test observes the two
// writes succeeding together, which is exactly the case where an unrolled-back `$inc` is invisible.
//
// A durable fence increment with no acquisition behind it is not cosmetic. The fence exists so that a
// concurrent disable and a concurrent acquire cannot both believe they won; a counter that advances on
// attempts that never happened is a counter that has stopped describing acquisitions.
//
// The failure is injected through the DRIVER rather than through a hook in the store, so production
// code carries no test-only branch. The store resolves its collections through `client.db(name)` at
// construction, so proxying the client is enough — and the proxy is armed only for the acquire call,
// because the fixture below reaches the same `updateOne` while setting up.
//
// BOTH exit paths are covered, and they are genuinely different mechanisms:
//   - THROW: the exception unwinds `withTransaction`, which aborts.
//   - REFUSAL: the transition reports `modifiedCount: 0`, the store returns a refusal, and `#tx` aborts
//     explicitly. This one is the easier of the two to get wrong, because returning normally from a
//     transaction body commits it by default.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const url = process.env.REVIEW_GATE_TEST_MONGO_URL;

/** What the injected `attestations.updateOne` should do on its next call. */
type Injection = { mode: "off" | "throw" | "refuse" };

/**
 * A client whose `attestations.updateOne` can be made to fail. Everything else passes through, and the
 * session the store opens is the real one — so the abort under test is a real abort.
 */
function withInjectedAttestationWrite(real: MongoClient, injection: Injection): MongoClient {
  const passThrough = (target: object, prop: string | symbol, receiver: unknown) => {
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  };
  const wrapCollection = (collection: Collection<Document>) => new Proxy(collection, {
    get(target, prop, receiver) {
      if (prop !== "updateOne") return passThrough(target, prop, receiver);
      return async (...args: unknown[]) => {
        if (injection.mode === "throw") {
          throw new Error("injected failure between the fence write and the transition");
        }
        if (injection.mode === "refuse") {
          // Shaped like a filter that matched nothing, which is what a lost race looks like.
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
        }
        return (target.updateOne as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  const wrapDb = (db: Db) => new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "collection") return passThrough(target, prop, receiver);
      return (name: string) => {
        const collection = target.collection(name);
        return name === "attestations" ? wrapCollection(collection) : collection;
      };
    },
  });
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== "db") return passThrough(target, prop, receiver);
      return (name?: string) => wrapDb(target.db(name as string));
    },
  });
}

if (!url || !/replicaSet=/.test(url)) {
  test("mongo: transactional rollback SKIPPED — no replica set configured", { skip: true }, () => {
    // Deliberately a skip rather than a silent absence: a suite that says nothing about the durable
    // store reads the same as one that passed.
  });
} else {
  const NOW = "2026-09-02T02:10:00.000Z";
  const SCOPE = [{ orgId: "org-1", serverId: "server-1" }];
  const acting = (principalId: string, credentialEpoch = 1) => ({ principalId, credentialEpoch });
  let counter = 0;
  const idem = (principalId = "claude") =>
    ({ principalId, scope: "tx", key: `k-${counter++}`, requestHash: "h" });

  /** Reserve and bind through the store's own methods, leaving the attestation ready to acquire. */
  async function boundAttestation(dbName: string, injection: Injection) {
    const client = new MongoClient(url!);
    await client.connect();
    const store = new MongoReviewGateStore(withInjectedAttestationWrite(client, injection), dbName);
    await ensureIndexes(client.db(dbName));

    const seed = async (principalId: string, over: Partial<Principal> = {}) => {
      await client.db(dbName).collection("principals").replaceOne({ principalId }, {
        principalId, displayName: principalId, credentialHash: "unused-by-these-tests",
        roles: [], reviewerClasses: [], credentialEpoch: 1,
        createdAt: "2026-09-02T00:00:00.000Z", credentialIndex: `index-for-${principalId}`, ...over,
      }, { upsert: true });
    };
    for (const id of ["claude", "codex", "owner"]) await seed(id);
    await seed("agent-1", { audienceFor: SCOPE });
    await seed("binder-1", { audienceFor: SCOPE });

    const candidate = record("c1");
    await store.registerCandidate({ acting: acting("claude"), record: candidate, idempotency: idem() });
    const at = "2026-09-02T01:00:00.000Z";
    for (const action of ["submit-tests", "freeze", "request-review", "claim-review"] as const) {
      const moved = await store.applyAction({
        acting: acting(action === "claim-review" ? "codex" : "claude"),
        candidateId: "c1", action, billingClass: "INTERNAL_QA_TEST", at,
        occurrenceId: `w-${action}`, idempotency: idem(),
      });
      assert.equal(moved.applied, true, `${action}: ${JSON.stringify(moved)}`);
    }
    const go = await store.applyVerdict({
      acting: acting("codex"), candidateId: "c1", expectedState: "REVIEW_IN_PROGRESS", nextState: "GO",
      occurrence: { occurrenceId: "w-GO", from: "REVIEW_IN_PROGRESS", to: "GO",
        actorIdentity: "codex", billingClass: "INTERNAL_REVIEW", at },
      verdict: { verdictId: "v1", reviewerIdentity: "codex", verdict: "GO", findings: [], resolves: [],
        submittedAt: at, at },
      addParticipant: { identity: "codex", role: "reviewer", at }, idempotency: idem("codex"),
    });
    assert.equal(go.applied, true, JSON.stringify(go));

    const decision = await store.recordOwnerDecision({
      acting: acting("owner"), candidateId: "c1", expectedState: "GO",
      occurrence: { occurrenceId: "od", from: "GO", to: "READY_FOR_OWNER_DECISION",
        actorIdentity: "owner", billingClass: "INTERNAL_REVIEW", at: "2026-09-02T02:00:00.000Z" },
      contentDigest: candidate.contentDigest,
      attestations: [{ ...attestation("at-1"), contentDigest: candidate.contentDigest, candidateId: "c1" }],
      at: "2026-09-02T02:00:00.000Z", idempotency: idem("owner"),
    });
    assert.equal(decision.applied, true, JSON.stringify(decision));

    const claim = { contentDigest: candidate.contentDigest, releasedByCandidateId: "c1" };
    const reserved = await store.reserveAttestation({
      acting: acting("binder-1"), attestationId: "at-1",
      lease: { leaseId: "L1", holderPrincipalId: "binder-1", credentialEpoch: 1,
        expiresAt: "2026-09-02T03:00:00.000Z" },
      now: NOW, requireClaim: claim,
    });
    assert.equal(reserved.applied, true, JSON.stringify(reserved));
    const bound = await store.bindAttestation({
      acting: acting("binder-1"), attestationId: "at-1", leaseId: "L1",
      actionDigest: dig("7"), now: NOW,
    });
    assert.equal(bound.applied, true, JSON.stringify(bound));

    const fenceOf = async () => {
      const row = await client.db(dbName).collection("principals").findOne({ principalId: "binder-1" });
      return (row?.acquireFence as number | undefined) ?? 0;
    };
    const stateOf = async () => {
      const row = await client.db(dbName).collection("attestations").findOne({ attestationId: "at-1" });
      return row?.state as string | undefined;
    };
    const acquire = () => store.acquireAttestation({
      acting: acting("agent-1"), attestationId: "at-1", leaseId: "L1", actionDigest: dig("7"),
      orgId: "org-1", serverId: "server-1", kind: "configuration.apply", now: NOW, requireClaim: claim,
      attemptTokenVerifier: hashCredential("t-1"),
      executionDeadline: "2026-09-02T02:40:00.000Z",
      idempotency: { principalId: "agent-1", scope: "acquire", key: "acq-tx", requestHash: "h" },
    });
    const dispose = async () => { await client.db(dbName).dropDatabase(); await client.close(); };
    // The RAW database, for the cases that must drive the real operator commands rather than seed a
    // principal row into the shape they want to see.
    return { fenceOf, stateOf, acquire, dispose, db: client.db(dbName) };
  }

  test("mongo: disabling a LEGACY binder actually invalidates its bindings, even after re-enable", async () => {
    // THE DEFECT AN INDEPENDENT REVIEW FOUND, against the only thing that can settle it.
    //
    // `seed` above writes no `incarnation` at all -- these rows are exactly the shape that existed
    // before the field was introduced. Bind reads an absent incarnation as ONE. `disable()` used
    // `$inc`, and MongoDB's `$inc` treats a missing field as ZERO, so it wrote 1: precisely the value
    // bind had recorded. The acquire fence matched, and `enable()` -- which deliberately does not
    // restore the incarnation -- handed the old binding straight back.
    //
    // The unit test in operator.test.ts cannot settle this. Its fake computes `Number(undefined) + 1`
    // and gets NaN, where MongoDB gets 1; only the real driver has the behaviour that made the two
    // readings collide.
    const injection: Injection = { mode: "off" };
    const world = await boundAttestation(`review_gate_incarnation_${process.pid}`, injection);
    try {
      await disable(world.db, "binder-1");
      await enable(world.db, "binder-1");

      const outcome = await world.acquire();
      assert.equal(outcome.applied, false,
        "a binding taken before the binder was disabled must not survive re-enabling it");
      assert.equal((outcome as { code: string }).code, "binder_incarnation_changed");
      assert.equal(await world.stateOf(), "RESERVED_BOUND");
    } finally {
      await world.dispose();
    }
  });

  test("mongo: a THROWN failure after the fence write rolls the $inc back with it", async () => {
    const injection: Injection = { mode: "off" };
    const world = await boundAttestation(`review_gate_tx_throw_${process.pid}`, injection);
    try {
      const fenceBefore = await world.fenceOf();
      injection.mode = "throw";
      const failure = await world.acquire().then(() => null, (error: Error) => error.message);
      injection.mode = "off";
      assert.match(String(failure), /injected failure/, "the injection must actually have fired");

      // The fence is the whole point. An acquire that did not happen must not have advanced it.
      assert.equal(await world.fenceOf(), fenceBefore,
        "the binder fence must not survive a transaction that aborted");
      assert.equal(await world.stateOf(), "RESERVED_BOUND",
        "and the attestation must be exactly where the binder left it");
    } finally {
      await world.dispose();
    }
  });

  test("mongo: a REFUSED transition after the fence write also rolls the $inc back", async () => {
    // The harder half. Returning normally from a transaction body COMMITS it, so a store that merely
    // returned its refusal here would keep the `$inc` — a durable side effect of an acquire that was
    // refused. `#tx` has to abort explicitly, and this is what checks that it does.
    const injection: Injection = { mode: "off" };
    const world = await boundAttestation(`review_gate_tx_refuse_${process.pid}`, injection);
    try {
      const fenceBefore = await world.fenceOf();
      injection.mode = "refuse";
      const outcome = await world.acquire();
      injection.mode = "off";
      assert.equal(outcome.applied, false, "a transition that modified nothing is a refusal");
      assert.equal((outcome as { code: string }).code, "attestation_state");

      assert.equal(await world.fenceOf(), fenceBefore,
        "a refusal must leave the fence untouched, not merely fail to acquire");
      assert.equal(await world.stateOf(), "RESERVED_BOUND");
    } finally {
      await world.dispose();
    }
  });
}
