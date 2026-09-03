import test from "node:test";
import assert from "node:assert/strict";
import { buildApp, readConfig } from "../src/server.js";
import { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { generateCredential, hashCredential, credentialIndex } from "../src/auth.js";
import { candidateDigest, type CandidateBinding } from "../src/policy.js";
import type { Principal, ReviewGateStore } from "../src/store.js";

const oid = (c: string) => c.repeat(40).slice(0, 40);
const dig = (c: string) => c.repeat(64).slice(0, 64);

function binding(over: Partial<CandidateBinding> = {}): CandidateBinding {
  return {
    subject: { kind: "code" },
    projectId: "crafters-market",
    repository: "williams342-maker/operation",
    baseBranch: "main",
    baseCommit: oid("a"),
    candidateCommit: oid("b"),
    candidateTree: oid("c"),
    patchDigest: dig("1"),
    artifactDigest: dig("3"),
    manifestDigest: dig("4"),
    dependencyLockDigests: [],
    testPlanVersion: "tp-1",
    testResultDigest: dig("2"),
    targetEnvironmentClass: "test",
    authorIdentity: "claude",
    requestedReviewerClass: "independent",
    authorityRef: "OWNER-2026-09-02",
    createdAt: "2026-09-02T00:00:00.000Z",
    occurrenceId: "occ-seed",
    ...over,
  } as CandidateBinding;
}

/**
 * A store whose principal lookup resolves the credentials this test issues.
 *
 * The gate looks a principal up by an unsalted index and then authenticates against the salted hash;
 * both steps are reproduced rather than short-circuited.
 */
function storeWithPrincipals(people: Array<{ credential: string } & Partial<Principal>>) {
  const store = new InMemoryReviewGateStore();
  const rows = people.map((p) => ({
    index: credentialIndex(p.credential),
    principal: {
      principalId: p.principalId ?? "someone",
      displayName: p.principalId ?? "someone",
      credentialHash: hashCredential(p.credential),
      reviewerClasses: p.reviewerClasses ?? [],
      roles: p.roles ?? [],
      credentialEpoch: 1,
      createdAt: "2026-09-02T00:00:00.000Z",
      ...(p.disabledAt ? { disabledAt: p.disabledAt } : {}),
    } as Principal,
  }));
  // Delegate everything except principal lookup to a real store, so state actually accumulates and the
  // routes are exercised against the same invariants production would enforce.
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "loadPrincipalByCredentialHash") {
        return async (hash: string) => rows.find((r) => r.index === hash)?.principal ?? null;
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ReviewGateStore;
}

/** Drive the app without binding a port. */
async function call(app: ReturnType<typeof buildApp>, method: string, path: string, options: {
  credential?: string;
  idempotencyKey?: string;
  body?: unknown;
} = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.credential) headers.authorization = `Bearer ${options.credential}`;
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      // GET must not carry a body: fetch throws rather than ignoring it.
      body: method === "GET" || options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ── the door ─────────────────────────────────────────────────────────────────────────────────────────

test("healthz says what this service currently is", async () => {
  const app = buildApp(new InMemoryReviewGateStore());
  const result = await call(app, "GET", "/healthz");
  assert.equal(result.status, 200);
  assert.match(String(result.body.advisory), /^ADVISORY:/,
    "the honest status is required to stay in the response until enforcement is wired");
  assert.equal(Object.keys(result.body).some((k) => k === "candidates" || k === "principals"), false,
    "liveness carries no data");
});

test("every route except healthz requires a credential", async () => {
  const app = buildApp(new InMemoryReviewGateStore());
  const routes: Array<[string, string]> = [
    ["POST", "/candidates"],
    ["POST", "/candidates/c1/successors"],
    ["POST", "/candidates/c1/evidence"],
    ["POST", "/candidates/c1/actions/freeze"],
    ["POST", "/candidates/c1/verdicts"],
    ["GET", "/candidates/c1"],
  ];
  for (const [method, path] of routes) {
    const result = await call(app, method, path, { idempotencyKey: "k", body: {} });
    assert.equal(result.status, 401, `${method} ${path} must require authentication`);
  }
});

test("a bad credential is refused before anything else is considered", async () => {
  const credential = generateCredential();
  const app = buildApp(storeWithPrincipals([{ credential, principalId: "claude", roles: ["author"] }]));
  const result = await call(app, "POST", "/candidates", {
    credential: "rgc_wrong", idempotencyKey: "k", body: { candidateId: "c1", binding: binding() },
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.ok, false);
});

test("a mutating request without an idempotency key is refused", async () => {
  const credential = generateCredential();
  const app = buildApp(storeWithPrincipals([{ credential, principalId: "claude", roles: ["author"] }]));
  const result = await call(app, "POST", "/candidates", {
    credential, body: { candidateId: "c1", binding: binding() },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "idempotency_key_required");
});

test("an unknown action is not a route", async () => {
  // The action is in the PATH and must be one the gate knows. A caller cannot invent a move, and there is
  // no shape here that describes a destination.
  const credential = generateCredential();
  const app = buildApp(storeWithPrincipals([{ credential, principalId: "claude", roles: ["author"] }]));
  const result = await call(app, "POST", "/candidates/c1/actions/become-approved", {
    credential, idempotencyKey: "k", body: { billingClass: "INTERNAL_QA_TEST" },
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.code, "unknown_action");
});

test("a candidate can be registered and read back through the API", async () => {
  const credential = generateCredential();
  const app = buildApp(storeWithPrincipals([{ credential, principalId: "claude", roles: ["author"] }]));
  const created = await call(app, "POST", "/candidates", {
    credential, idempotencyKey: "k1", body: { candidateId: "c1", binding: binding() },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.state, "BUILT");

  const read = await call(app, "GET", "/candidates/c1", { credential });
  assert.equal(read.status, 200);
  assert.equal(read.body.candidateId, "c1");
  assert.equal(read.body.digest, candidateDigest(binding()));
});

test("the read projection does not hand back the gate's bookkeeping", async () => {
  const credential = generateCredential();
  const app = buildApp(storeWithPrincipals([{ credential, principalId: "claude", roles: ["author"] }]));
  await call(app, "POST", "/candidates", {
    credential, idempotencyKey: "k1", body: { candidateId: "c1", binding: binding() },
  });
  const read = await call(app, "GET", "/candidates/c1", { credential });
  for (const leaked of ["occurrences", "verdicts", "binding", "credentialEpoch"]) {
    assert.equal(leaked in read.body, false, `${leaked} is the gate's bookkeeping, not a caller's`);
  }
});

test("an author cannot register a candidate attributed to someone else, over HTTP", async () => {
  const credential = generateCredential();
  const app = buildApp(storeWithPrincipals([{ credential, principalId: "claude", roles: ["author"] }]));
  const result = await call(app, "POST", "/candidates", {
    credential, idempotencyKey: "k1",
    body: { candidateId: "c1", binding: binding({ authorIdentity: "someone-else" }) },
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "author_actor_mismatch");
});

test("a replayed request is a no-op rather than a second registration", async () => {
  const credential = generateCredential();
  const app = buildApp(storeWithPrincipals([{ credential, principalId: "claude", roles: ["author"] }]));
  const body = { candidateId: "c1", binding: binding() };
  const first = await call(app, "POST", "/candidates", { credential, idempotencyKey: "same", body });
  assert.equal(first.status, 200);
  const replay = await call(app, "POST", "/candidates", { credential, idempotencyKey: "same", body });
  assert.equal(replay.status, 200, "a genuine replay is not an error");
  assert.equal(replay.body.code, "idempotent_replay");
});

test("the same key with a different request is an error, not an unrelated result", async () => {
  const credential = generateCredential();
  const app = buildApp(storeWithPrincipals([{ credential, principalId: "claude", roles: ["author"] }]));
  await call(app, "POST", "/candidates", {
    credential, idempotencyKey: "same", body: { candidateId: "c1", binding: binding() },
  });
  const different = await call(app, "POST", "/candidates", {
    credential, idempotencyKey: "same",
    body: { candidateId: "c2", binding: binding({ candidateCommit: oid("d") }) },
  });
  assert.equal(different.status, 409);
  assert.equal(different.body.code, "idempotency_key_reused");
});

test("a disabled principal cannot act", async () => {
  const credential = generateCredential();
  const app = buildApp(storeWithPrincipals([{
    credential, principalId: "claude", roles: ["author"], disabledAt: "2026-09-02T00:00:00.000Z",
  }]));
  const result = await call(app, "POST", "/candidates", {
    credential, idempotencyKey: "k", body: { candidateId: "c1", binding: binding() },
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.code, "principal_disabled");
});

// ── configuration ────────────────────────────────────────────────────────────────────────────────────

test("the service refuses to start against a standalone Mongo", () => {
  // A deployment constraint, enforced at startup rather than discovered on the first concurrent verdict.
  assert.throws(() => readConfig({
    REVIEW_GATE_MONGO_URL: "mongodb://localhost:27017", REVIEW_GATE_DB_NAME: "review_gate",
  } as NodeJS.ProcessEnv), /replica set/);
  const ok = readConfig({
    REVIEW_GATE_MONGO_URL: "mongodb://localhost:27017/?replicaSet=rs0",
    REVIEW_GATE_DB_NAME: "review_gate",
  } as NodeJS.ProcessEnv);
  assert.equal(ok.dbName, "review_gate");
});

test("the service binds to loopback unless told otherwise", () => {
  // A default of 0.0.0.0 would be a decision made by omission. This is not a public service.
  const config = readConfig({
    REVIEW_GATE_MONGO_URL: "mongodb://h/?replicaSet=rs0", REVIEW_GATE_DB_NAME: "d",
  } as NodeJS.ProcessEnv);
  assert.equal(config.bind, "127.0.0.1");
});

test("missing configuration fails loudly", () => {
  assert.throws(() => readConfig({} as NodeJS.ProcessEnv), /REVIEW_GATE_MONGO_URL/);
  assert.throws(() => readConfig({
    REVIEW_GATE_MONGO_URL: "mongodb://h/?replicaSet=rs0",
  } as NodeJS.ProcessEnv), /REVIEW_GATE_DB_NAME/);
});
