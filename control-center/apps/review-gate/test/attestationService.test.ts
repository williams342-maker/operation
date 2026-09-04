import test from "node:test";
import assert from "node:assert/strict";
import { configurationChangeDigest, privilegedActionDigest } from "@control-center/shared";
import { AttestationService, validatePayload } from "../src/attestationService.js";
import type { AuthenticatedPrincipal } from "../src/auth.js";
import type { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { contentDigest, candidateDigest, type CandidateBinding, type CandidateSubject }
  from "../src/policy.js";
import type { CandidateRecord } from "../src/store.js";
import { castOf, type Person } from "./principals.js";

/** Narrow an AttestationResult to its value, failing the test if it was a refusal. */
function valueOf<T>(result: { ok: boolean; value?: unknown; code?: string }): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value as T;
}

const oid = (c: string) => c.repeat(40).slice(0, 40);
const dig = (c: string) => c.repeat(64).slice(0, 64);

/**
 * The cast, provisioned with real credentials and resolved through `authenticate`.
 *
 * "agent-1-rotated" exists because a test needs an executor whose CURRENT epoch is 2 while holding a
 * lease stamped at 1 — the rotation race an independent review found. A test cannot construct that by
 * asserting an epoch, because principals are now read from the store.
 */
const PEOPLE: Person[] = [
  { principalId: "owner", roles: ["owner"] },
  { principalId: "claude", roles: ["author"] },
  { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
  { principalId: "agent-1", roles: ["executor"], targetScopes: [{ orgId: "org-1", serverId: "server-1" }] },
  { principalId: "agent-2", roles: ["executor"], targetScopes: [{ orgId: "org-1", serverId: "server-2" }] },
  // The binder is a separate principal with its own target scope. It reserves and binds; it never
  // acquires. `targetScopes` is the existing scope field and is used for both roles -- the checklist asks
  // for it to be renamed to something role-neutral, which is a later increment.
  { principalId: "binder-1", roles: ["binder"], targetScopes: [{ orgId: "org-1", serverId: "server-1" }] },
  { principalId: "binder-2", roles: ["binder"], targetScopes: [{ orgId: "org-1", serverId: "server-2" }] },
];

/** The mutation set a candidate is reviewed against. */
const MUTATIONS = [
  { name: "DATABASE_URL", operation: "update" as const, secret: true, versionId: "v-000000000001",
    valueRef: "ref-1" },
  { name: "FEATURE_X", operation: "enable" as const, secret: false, versionId: "v-000000000002",
    valueRef: "ref-2" },
];

const CHANGE_DIGEST = configurationChangeDigest(MUTATIONS);

const configSubject = (over: Partial<Extract<CandidateSubject, { kind: "configuration.change" }>> = {}) =>
  ({
    kind: "configuration.change" as const,
    changeDigest: CHANGE_DIGEST,
    environmentId: "env-000000000001",
    targetProfileId: "profile-00000001",
    targetProfileRevision: 3,
    ...over,
  });

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
    targetEnvironmentClass: "staging",
    authorIdentity: "claude",
    requestedReviewerClass: "independent",
    authorityRef: "OWNER-2026-09-02",
    createdAt: "2026-09-02T00:00:00.000Z",
    occurrenceId: "occ-seed",
    ...over,
  } as CandidateBinding;
}

function record(id: string, b: CandidateBinding): CandidateRecord {
  return {
    candidateId: id,
    digest: candidateDigest(b),
    contentDigest: contentDigest(b),
    binding: b,
    state: "BUILT",
    participants: [{ identity: b.authorIdentity, role: "author", at: "2026-09-02T00:00:00.000Z" }],
    occurrences: [],
    verdicts: [],
  };
}

let counter = 0;
const idem = (principalId = "owner") =>
  ({ principalId, scope: "t", key: `k-${counter++}`, requestHash: "h" });

/** Walk a candidate to GO by NAMED ACTIONS, so an owner decision is legal. */
async function atGo(store: InMemoryReviewGateStore, id: string, b: CandidateBinding) {
  await store.registerCandidate({
    acting: { principalId: "claude", credentialEpoch: 1 },
    record: record(id, b), idempotency: idem("claude") });
  const at = "2026-09-02T01:00:00.000Z";
  const steps = ["submit-tests", "freeze", "request-review", "claim-review"] as const;
  for (const action of steps) {
    const moved = await store.applyAction({
      acting: { principalId: action === "claim-review" ? "codex" : "claude", credentialEpoch: 1 },
      candidateId: id, action,
      billingClass: "INTERNAL_QA_TEST", at, occurrenceId: `w-${action}`,
      idempotency: idem("claude"),
    });
    assert.equal(moved.applied, true, `${action}: ${JSON.stringify(moved)}`);
  }
  const go = await store.applyVerdict({
    acting: { principalId: "codex", credentialEpoch: 1 },
    candidateId: id, expectedState: "REVIEW_IN_PROGRESS", nextState: "GO",
    occurrence: { occurrenceId: "w-GO", from: "REVIEW_IN_PROGRESS", to: "GO",
      actorIdentity: "codex", billingClass: "INTERNAL_REVIEW", at },
    verdict: { verdictId: "v1", reviewerIdentity: "codex", verdict: "GO", findings: [], resolves: [],
      submittedAt: at, at },
    addParticipant: { identity: "codex", role: "reviewer", at },
    idempotency: idem("codex"),
  });
  assert.equal(go.applied, true, JSON.stringify(go));
}
async function build() {
  const cast = await castOf(PEOPLE);
  const store = cast.store;
  let ids = 0;
  const svc = new AttestationService(store, {
    clock: () => "2026-09-02T02:00:00.000Z",
    ids: () => `id-${ids++}`,
  });
  return { store, svc, who: cast.who };
}

// Acquire now requires an idempotency identity bound to the whole request. A counter keeps each call
// distinct, so a test that acquires twice on purpose gets two attempts rather than a replay refusal.
let acquireSeq = 0;
const acquireArgs = <T extends object>(over: T) => ({
  idempotencyKey: `acq-${acquireSeq++}`,
  requestHash: `hash-${acquireSeq}`,
  ...over,
});

const configPayload = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "configuration-deployment-v1",
  action: "configuration.apply.v1",
  planId: "plan-00000000001",
  planRevision: 1,
  deploymentId: "deploy-000000001",
  environmentId: "env-000000000001",
  environmentKind: "staging",
  protected: false,
  targetProfileId: "profile-00000001",
  targetProfileRevision: 3,
  repositoryRoot: "/srv/app",
  environmentFilePath: "/srv/app/.env",
  composePath: "/srv/app/docker-compose.yml",
  composeProject: "app",
  statelessServices: ["web"],
  protectedServices: [],
  healthChecks: [{ id: "web", url: "http://localhost:8080/health", timeoutMs: 5000 }],
  mutations: MUTATIONS,
  encryptedValues: {
    algorithm: "aes-256-gcm", ciphertext: "x", nonce: "n", authTag: "t", keyVersion: "k1",
  },
  expectedConfigurationDigest: dig("e"),
  automaticRollback: true,
  reviewAuthorization: { attestationId: "id-0", leaseId: "id-2" },
  ...over,
});

// ── minting ──────────────────────────────────────────────────────────────────────────────────────────

test("only the owner may accept a review outcome", async () => {
  const { store, svc, who } = await build();
  const b = binding({ subject: configSubject() });
  await atGo(store, "c1", b);
  const result = await svc.recordOwnerDecision(who("claude"), {
    candidateId: "c1", idempotencyKey: "k",
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: "2026-09-02T06:00:00.000Z" }],
  });
  assert.equal((result as { code: string }).code, "role_required");
});

test("a code candidate cannot authorize a configuration change", async () => {
  // The discriminant is part of contentDigest, so this is refused on identity rather than on a naming
  // convention.
  const { store, svc, who } = await build();
  await atGo(store, "c1", binding());   // subject.kind === "code"
  const result = await svc.recordOwnerDecision(who("owner"), {
    candidateId: "c1", idempotencyKey: "k",
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: "2026-09-02T06:00:00.000Z" }],
  });
  assert.equal((result as { code: string }).code, "subject_kind_mismatch");
});

test("minted attestations are UNBOUND — no payload, no actionDigest", async () => {
  const { store, svc, who } = await build();
  await atGo(store, "c1", binding({ subject: configSubject() }));
  const result = await svc.recordOwnerDecision(who("owner"), {
    candidateId: "c1", idempotencyKey: "k",
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: "2026-09-02T06:00:00.000Z" }],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const [id] = valueOf<{ attestationIds: string[] }>(result).attestationIds;
  const attestation = await store.loadAttestation(id);
  assert.equal(attestation!.state, "PENDING");
  assert.equal(attestation!.actionDigest, undefined,
    "binding a payload at mint is what made an earlier design circular");
});

test("a rollback attestation requires the candidate to name what it restores", async () => {
  const { store, svc, who } = await build();
  await atGo(store, "c1", binding({ subject: configSubject() }));   // no rollbackTarget
  const result = await svc.recordOwnerDecision(who("owner"), {
    candidateId: "c1", idempotencyKey: "k",
    attestations: [{ kind: "configuration.rollback", orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: "2026-09-02T06:00:00.000Z" }],
  });
  assert.equal((result as { code: string }).code, "rollback_target_required");
});

test("a rollback target that was never released is refused", async () => {
  const { store, svc, who } = await build();
  await atGo(store, "c1", binding({
    subject: configSubject({ rollbackTarget: { candidateId: "never", contentDigest: dig("f") } }),
  }));
  const result = await svc.recordOwnerDecision(who("owner"), {
    candidateId: "c1", idempotencyKey: "k",
    attestations: [{ kind: "configuration.rollback", orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: "2026-09-02T06:00:00.000Z" }],
  });
  assert.equal((result as { code: string }).code, "rollback_target_not_released",
    "you may not roll back to content that was never reviewed");
});

// ── payload validation ───────────────────────────────────────────────────────────────────────────────

test("the payload must apply the change set that was reviewed", () => {
  const subject = configSubject();
  assert.equal(validatePayload("configuration.apply", subject, configPayload()).ok, true);
  const different = configPayload({
    mutations: [{ ...MUTATIONS[0], versionId: "v-999999999999" }, MUTATIONS[1]],
  });
  const result = validatePayload("configuration.apply", subject, different);
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "payload_not_reviewed_content",
    "a different versionId is a different change, even for the same variable");
});

test("a reviewed change cannot be redirected at another environment or profile", () => {
  const subject = configSubject();
  for (const over of [
    { environmentId: "env-000000000009" },
    { targetProfileId: "profile-00000009" },
    { targetProfileRevision: 4 },
  ]) {
    const result = validatePayload("configuration.apply", subject, configPayload(over));
    assert.equal((result as { code: string }).code, "payload_not_reviewed_target",
      `${Object.keys(over)[0]} must not be redirectable after review`);
  }
});

test("expectedConfigurationDigest is NOT what review is bound to", () => {
  // It describes the state expected BEFORE the change — a concurrency precondition, not the content
  // being deployed. An earlier design bound review to it, which would have asserted something false.
  const subject = configSubject();
  const result = validatePayload("configuration.apply", subject,
    configPayload({ expectedConfigurationDigest: dig("9") }));
  assert.equal(result.ok, true, "changing the precondition does not change what was reviewed");
});

test("an apply attestation cannot authorize a rollback payload, or the reverse", () => {
  // REGRESSION, design review round 2 §13.1. `validatePayload` did not look at `action` at all, and
  // acquire's kind check compares the CALLER-SUPPLIED kind against the record rather than against the
  // bound payload. Both configuration kinds share one subject, one payload schema and one change-set
  // digest, so every other check here passes identically for an apply and a rollback of the same change
  // set -- the verb was the one thing separating them, and nothing looked at it.
  //
  // Note the payloads below are otherwise VALID: `action` carries no conditional fields, so swapping it
  // alone produces a payload that parses cleanly. The refusal has to be about the verb, not the schema.
  const subject = configSubject();
  const rollbackPayload = configPayload({ action: "configuration.rollback.v1" });
  const applyPayload = configPayload({ action: "configuration.apply.v1" });

  const swappedForward = validatePayload("configuration.apply", subject, rollbackPayload);
  assert.equal((swappedForward as { code: string }).code, "payload_not_reviewed_action",
    "an apply attestation must not authorize a rollback");
  const swappedBack = validatePayload("configuration.rollback", subject, applyPayload);
  assert.equal((swappedBack as { code: string }).code, "payload_not_reviewed_action",
    "a rollback attestation must not authorize an apply");

  // The matching directions still bind, so the check pins the verb rather than blocking the payload.
  assert.equal(validatePayload("configuration.apply", subject, applyPayload).ok, true);
  assert.equal(validatePayload("configuration.rollback", subject, rollbackPayload).ok, true);
});

test("agent upgrade carries no verb to pin, and is unaffected", () => {
  // KIND_REQUIRED_ACTION is null there: the artifact and release-manifest digests identify the
  // operation instead. Asserted so that "total over AttestationKind" is not silently satisfied by
  // making agent.upgrade fail everything.
  const subject = { kind: "agent.upgrade" as const, artifactSha256: dig("5"), releaseManifestDigest: dig("6") };
  const manifest = {
    schemaVersion: "agent-upgrade-v1", upgradeId: "up-1", serverId: "server-000000001",
    expectedAgentId: "agent-1", expectedCurrentVersion: "0.1.0", targetVersion: "0.2.0",
    releaseId: "rel-1", artifactSha256: dig("5"), artifactSignature: "s".repeat(90),
    signatureKeyId: "key-1", releaseManifestDigest: dig("6"), planDigest: dig("7"),
    operatingSystem: "linux", architecture: "x64", packageType: "tar",
    requiredCapabilities: [], expiresAt: "2026-09-02T06:00:00.000Z", nonce: "n".repeat(20),
  };
  assert.equal(validatePayload("agent.upgrade", subject, manifest).ok, true);
});

test("agent upgrade binds the bytes that will be installed", () => {
  const subject = { kind: "agent.upgrade" as const,
    artifactSha256: dig("5"), releaseManifestDigest: dig("6") };
  const manifest = {
    schemaVersion: "agent-upgrade-v1", upgradeId: "up-1", serverId: "server-000000001",
    expectedAgentId: "agent-1", expectedCurrentVersion: "0.1.0", targetVersion: "0.2.0",
    releaseId: "rel-1", artifactSha256: dig("5"), artifactSignature: "s".repeat(90),
    signatureKeyId: "key-1", releaseManifestDigest: dig("6"), planDigest: dig("7"),
    operatingSystem: "linux", architecture: "x64", packageType: "tar",
    requiredCapabilities: [], expiresAt: "2026-09-02T06:00:00.000Z", nonce: "n".repeat(20),
  };
  assert.equal(validatePayload("agent.upgrade", subject, manifest).ok, true);
  const swapped = validatePayload("agent.upgrade", subject,
    { ...manifest, artifactSha256: dig("9") });
  assert.equal((swapped as { code: string }).code, "payload_not_reviewed_content");
});

// ── reserve, bind, acquire, redeem ───────────────────────────────────────────────────────────────────

async function minted(kind: "configuration.apply" = "configuration.apply") {
  const { store, svc, who } = await build();
  await atGo(store, "c1", binding({ subject: configSubject() }));
  const decision = await svc.recordOwnerDecision(who("owner"), {
    candidateId: "c1", idempotencyKey: "k",
    attestations: [{ kind, orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: "2026-09-02T06:00:00.000Z" }],
  });
  assert.equal(decision.ok, true, JSON.stringify(decision));
  const [attestationId] = valueOf<{ attestationIds: string[] }>(decision).attestationIds;
  return { store, svc, attestationId, who };
}

test("mint requires an explicit binder, distinct from the audience", async () => {
  const { store, svc, who } = await build();
  await atGo(store, "c1", binding({ subject: configSubject() }));
  const mint = (over: Record<string, unknown>) => svc.recordOwnerDecision(who("owner"), {
    candidateId: "c1", idempotencyKey: `k-${JSON.stringify(over)}`,
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1",
      expiresAt: "2026-09-02T06:00:00.000Z", ...over } as never],
  });

  const missing = await mint({ bindingPrincipalId: "" });
  assert.equal((missing as { code: string }).code, "binding_principal_required");

  // The default the design exists to forbid. Defaulting the binder to the audience reproduces exactly
  // the unexecutable protocol: the executor would have to bind a payload it has not been dispatched.
  const collapsed = await mint({ bindingPrincipalId: "agent-1" });
  assert.equal((collapsed as { code: string }).code, "binding_principal_not_distinct");

  assert.equal((await mint({})).ok, true);
});

test("every mint stamps v2, because absence is what marks a legacy record", async () => {
  const { store, svc, attestationId } = await minted();
  const record = (await store.loadAttestation(attestationId))!;
  assert.equal(record.identitySchemaVersion, "v2");
  assert.equal(record.bindingPrincipalId, "binder-1");
});

test("lineage is validated against the referenced record, not trusted", async () => {
  const { store, svc, attestationId, who } = await minted();
  const mintWith = (supersedes: string, key: string) => svc.mintFurther(who("owner"), {
    candidateId: "c1", idempotencyKey: key,
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1",
      supersedesAttestationId: supersedes, expiresAt: "2026-09-02T06:00:00.000Z" }],
  });

  const unknown = await mintWith("at-does-not-exist", "k1");
  assert.equal((unknown as { code: string }).code, "superseded_attestation_unknown");

  // A replacement must supersede an attestation for the SAME candidate, content, org and server.
  const wrongTarget = await svc.mintFurther(who("owner"), {
    candidateId: "c1", idempotencyKey: "k2",
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-2",
      audiencePrincipalId: "agent-2", bindingPrincipalId: "binder-2",
      supersedesAttestationId: attestationId, expiresAt: "2026-09-02T06:00:00.000Z" }],
  });
  assert.equal((wrongTarget as { code: string }).code, "superseded_attestation_mismatch");

  const ok = await mintWith(attestationId, "k3");
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test("only the named BINDER may reserve, and the audience specifically may not", async () => {
  // The heart of the split. This test previously asserted the opposite -- that only the audience could
  // reserve -- which is precisely what made §2.6 unexecutable: the executor would have had to reserve
  // and bind a payload the control plane had not yet dispatched to it.
  const { svc, attestationId, who } = await minted();

  const otherBinder = await svc.reserve(who("binder-2"), { attestationId, leaseSeconds: 60 });
  assert.equal((otherBinder as { code: string }).code, "wrong_binder");

  // The audience is refused BY NAME, not merely by not being the binder.
  const audience = await svc.reserve(who("agent-1"), { attestationId, leaseSeconds: 60 });
  assert.equal((audience as { code: string }).code, "wrong_binder",
    "the principal that will execute must not be able to reserve the authority to execute");

  assert.equal((await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 })).ok, true);
});

test("an acquired attempt can actually be EXTENDED through the real service", async () => {
  // THE TEST THAT WAS MISSING, and its absence made an entire feature unreachable.
  //
  // Acquire set the initial deadline to `min(now + MAX_EXECUTION_MS, expiresAt)` and extension computed
  // its absolute bound from the SAME constant against the same instant, so the deadline acquire issued
  // was already the absolute one. Extension must request something strictly later than the current
  // deadline and no later than the bound, and no such value existed -- every extension against the real
  // service was refused, whatever the executor did.
  //
  // Nothing caught it because nothing put the two together. The store conformance supplies both
  // deadlines as arguments, so it can choose a pair the service can never produce; the executor's unit
  // test answers from a stub that grants whatever it is asked. Only acquire and extend through the
  // service that owns both constants can show this, which is why this test exists at this level.
  const { svc, attestationId, who } = await minted();
  const { leaseId } = valueOf<{ leaseId: string }>(
    await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 3600 }));
  const bound = await svc.bind(who("binder-1"), {
    attestationId, leaseId, payload: configPayload({ reviewAuthorization: { attestationId, leaseId } }),
  });
  const { actionDigest } = valueOf<{ actionDigest: string }>(bound);
  const acquired = await svc.acquire(who("agent-1"), acquireArgs({
    attestationId, leaseId, actionDigest, orgId: "org-1", serverId: "server-1",
    kind: "configuration.apply" as const,
  }));
  const { attemptToken, executionDeadline } =
    valueOf<{ attemptToken: string; executionDeadline: string }>(acquired);

  const requested = new Date(Date.parse(executionDeadline) + 5 * 60_000).toISOString();
  const extended = await svc.extendExecution(who("agent-1"), {
    attestationId, attemptToken, requestedDeadline: requested,
  });
  assert.equal(extended.ok, true, JSON.stringify(extended));
  const granted = valueOf<{ executionDeadline: string }>(extended).executionDeadline;
  assert.ok(Date.parse(granted) > Date.parse(executionDeadline),
    "the deadline must actually move, or the initial window IS the absolute bound again");

  // And the cap is still real: far beyond it is refused rather than clamped silently.
  const absurd = new Date(Date.parse(executionDeadline) + 24 * 60 * 60_000).toISOString();
  const beyond = await svc.extendExecution(who("agent-1"), {
    attestationId, attemptToken, requestedDeadline: absurd,
  });
  assert.equal(beyond.ok, false, "the absolute cap must still bound the extension");
});

test("the binder may not acquire or redeem the execution it authorized", async () => {
  // The other half: whoever binds does not execute. Without this the split would be cosmetic -- one
  // principal could reserve, bind and then acquire, which is the single authority it exists to divide.
  const { svc, attestationId, who } = await minted();
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);
  const bound = await svc.bind(who("binder-1"), {
    attestationId, leaseId, payload: configPayload({ reviewAuthorization: { attestationId, leaseId } }),
  });
  const { actionDigest } = valueOf<{ actionDigest: string }>(bound);
  const request = { attestationId, leaseId, actionDigest, orgId: "org-1", serverId: "server-1",
    kind: "configuration.apply" as const };

  const binderAcquire = await svc.acquire(who("binder-1"), acquireArgs(request));
  assert.equal((binderAcquire as { code: string }).code, "wrong_audience");
  const acquired = await svc.acquire(who("agent-1"), acquireArgs(request));
  assert.equal(acquired.ok, true);
  const { attemptToken } = valueOf<{ attemptToken: string }>(acquired);
  const binderRedeem = await svc.redeem(who("binder-1"), { attestationId, leaseId, attemptToken });
  assert.equal((binderRedeem as { code: string }).code, "wrong_audience");
});

test("an executor cannot act on a target it was not provisioned for", async () => {
  const { store, svc, who } = await build();
  await atGo(store, "c1", binding({ subject: configSubject() }));
  const decision = await svc.recordOwnerDecision(who("owner"), {
    candidateId: "c1", idempotencyKey: "k",
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-9",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: "2026-09-02T06:00:00.000Z" }],
  });
  const [attestationId] = valueOf<{ attestationIds: string[] }>(decision).attestationIds;
  const result = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  assert.equal((result as { code: string }).code, "target_not_provisioned");
});

test("the gate computes actionDigest; it never accepts one", async () => {
  const { store, svc, attestationId, who } = await minted();
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);
  const payload = configPayload({ reviewAuthorization: { attestationId, leaseId } });
  const bound = await svc.bind(who("binder-1"), { attestationId, leaseId, payload });
  assert.equal(bound.ok, true, JSON.stringify(bound));
  const { actionDigest } = valueOf<{ actionDigest: string }>(bound);
  assert.equal(actionDigest, privilegedActionDigest(payload),
    "the same function layer 2 signs, computed here rather than trusted");
  assert.equal((await store.loadAttestation(attestationId))!.actionDigest, actionDigest);
});

test("bind refuses a swapped verb, and leaves the attestation unbound", async () => {
  // The pure-function test above proves the rule; this proves the real path enforces it AND that the
  // refusal is clean. A rejected bind must not leave a half-bound attestation: no actionDigest, and the
  // reservation still usable for the correct payload.
  const { store, svc, attestationId, who } = await minted();
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);

  const rejected = await svc.bind(who("binder-1"), {
    attestationId, leaseId,
    payload: configPayload({ action: "configuration.rollback.v1", reviewAuthorization: { attestationId, leaseId } }),
  });
  assert.equal((rejected as { code: string }).code, "payload_not_reviewed_action");

  const after = (await store.loadAttestation(attestationId))!;
  assert.equal(after.actionDigest, undefined, "a refused bind must not record an actionDigest");
  assert.equal(after.state, "RESERVED_UNBOUND", "a refused bind must not advance the state");

  // And the correct payload still binds on the same lease -- the refusal cost nothing.
  const accepted = await svc.bind(who("binder-1"), {
    attestationId, leaseId,
    payload: configPayload({ reviewAuthorization: { attestationId, leaseId } }),
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
});

test("the payload must name this attestation and lease", async () => {
  const { svc, attestationId, who } = await minted();
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);
  const result = await svc.bind(who("binder-1"), {
    attestationId, leaseId,
    payload: configPayload({ reviewAuthorization: { attestationId, leaseId: "someone-elses" } }),
  });
  assert.equal((result as { code: string }).code, "review_authorization_mismatch");
});

test("a payload with no reviewAuthorization cannot be bound", async () => {
  const { svc, attestationId, who } = await minted();
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);
  const payload = configPayload();
  delete (payload as Record<string, unknown>).reviewAuthorization;
  const result = await svc.bind(who("binder-1"), { attestationId, leaseId, payload });
  assert.equal((result as { code: string }).code, "review_authorization_missing",
    "the ids must be under the envelope digest and the owner's signature");
});

test("acquisition wins for exactly one caller, before any host mutation", async () => {
  const { svc, attestationId, who } = await minted();
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);
  const payload = configPayload({ reviewAuthorization: { attestationId, leaseId } });
  const bound = await svc.bind(who("binder-1"), { attestationId, leaseId, payload });
  const { actionDigest } = valueOf<{ actionDigest: string }>(bound);
  const request = { attestationId, leaseId, actionDigest, orgId: "org-1", serverId: "server-1",
    kind: "configuration.apply" as const };
  const won = await svc.acquire(who("agent-1"), acquireArgs(request));
  assert.equal(won.ok, true);
  const token = valueOf<{ attemptToken: string }>(won).attemptToken;
  assert.equal((await svc.acquire(who("agent-1"), acquireArgs(request))).ok, false,
    "a second delivery loses, and loses before it could change anything");
  assert.equal((await svc.redeem(who("agent-1"), { attestationId, leaseId, attemptToken: token })).ok, true);
});

test("a rotation after authentication invalidates a lease in flight", async () => {
  // The race an independent review found: the executor authenticates at epoch 1 and its lease records
  // epoch 1, so comparing the supplied epoch ONLY with the lease let the request commit after the
  // rotation. The store re-reads the principal, so the rotation wins.
  const { store, svc, attestationId, who } = await minted();
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);

  // The operator rotates THE BINDER while it is mid-flight. Before the split this test rotated the
  // executor, because the executor held the lease; now the binder does, so the binder's rotation is what
  // must invalidate a bind in flight.
  store.seedPrincipal({
    principalId: "binder-1", displayName: "binder-1", roles: ["binder"], reviewerClasses: [],
    targetScopes: [{ orgId: "org-1", serverId: "server-1" }],
    credentialEpoch: 2, createdAt: "2026-09-02T00:00:00.000Z",
  }, "rotated-credential");

  const payload = configPayload({ reviewAuthorization: { attestationId, leaseId } });
  const result = await svc.bind(who("binder-1"), { attestationId, leaseId, payload });
  assert.equal(result.ok, false,
    "an operation using the old credential must not commit after rotation commits");
  assert.equal((result as { code: string }).code, "credential_rotated");
});

test("a lease is bounded by the attestation it belongs to", async () => {
  const { store, svc, attestationId, who } = await minted();
  // Asks for far longer than the cap and than the attestation's own validity.
  await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 * 60 * 24 });
  const lease = (await store.loadAttestation(attestationId))!.lease!;
  assert.ok(Date.parse(lease.expiresAt) <= Date.parse("2026-09-02T06:00:00.000Z"),
    "a lease must never outlive the review that authorized it");
});

// ── revocation and reconciliation ────────────────────────────────────────────────────────────────────

test("only the owner may revoke, and not once execution is underway", async () => {
  const { svc, attestationId, who } = await minted();
  assert.equal((await svc.revoke(who("agent-1"), { attestationId, reason: "x" }) as { code: string })
    .code, "role_required");
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);
  const payload = configPayload({ reviewAuthorization: { attestationId, leaseId } });
  const bound = await svc.bind(who("binder-1"), { attestationId, leaseId, payload });
  const { actionDigest } = valueOf<{ actionDigest: string }>(bound);
  await svc.acquire(who("agent-1"), acquireArgs({ attestationId, leaseId, actionDigest,
    orgId: "org-1", serverId: "server-1", kind: "configuration.apply" }));
  const late = await svc.revoke(who("owner"), { attestationId, reason: "changed mind" });
  assert.equal(late.ok, false,
    "the effect may be underway; a row claiming it was stopped would assert what the gate cannot know");
});

test("an owner asserting APPLIED is not evidence", async () => {
  const { store, svc, attestationId, who } = await minted();
  // Drive it to INDETERMINATE the way the sweep would.
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);
  const payload = configPayload({ reviewAuthorization: { attestationId, leaseId } });
  await svc.bind(who("binder-1"), { attestationId, leaseId, payload });
  await store.sweepAttestations("2026-09-03T00:00:00.000Z");
  assert.equal((await store.loadAttestation(attestationId))!.state, "INDETERMINATE");

  const disagreeing = await svc.resolveIndeterminate(who("owner"), {
    attestationId,
    reconciliation: {
      resolvedByPrincipalId: "owner", resolvedAt: "2026-09-03T01:00:00.000Z",
      outcome: "APPLIED", journalReference: "journal/1",
      journaledPostStateDigest: dig("a"), observedHostStateDigest: dig("b"),
      terminalPhase: "succeeded", reason: "I think it worked",
    },
  });
  assert.equal((disagreeing as { code: string }).code, "observation_disagrees_with_journal");

  const rolledBack = await svc.resolveIndeterminate(who("owner"), {
    attestationId,
    reconciliation: {
      resolvedByPrincipalId: "owner", resolvedAt: "2026-09-03T01:00:00.000Z",
      outcome: "APPLIED", journalReference: "journal/1",
      journaledPostStateDigest: dig("a"), observedHostStateDigest: dig("a"),
      terminalPhase: "rolled_back", reason: "it rolled back",
    },
  });
  assert.equal((rolledBack as { code: string }).code, "terminal_phase_insufficient",
    "a rollback proves the change did NOT remain applied");
});

test("NOT_APPLIED terminates the attestation and it is never reopened", async () => {
  const { store, svc, attestationId, who } = await minted();
  const reservation = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  const { leaseId } = valueOf<{ leaseId: string }>(reservation);
  await svc.bind(who("binder-1"), {
    attestationId, leaseId,
    payload: configPayload({ reviewAuthorization: { attestationId, leaseId } }),
  });
  await store.sweepAttestations("2026-09-03T00:00:00.000Z");
  const resolved = await svc.resolveIndeterminate(who("owner"), {
    attestationId,
    reconciliation: {
      resolvedByPrincipalId: "owner", resolvedAt: "2026-09-03T01:00:00.000Z",
      outcome: "NOT_APPLIED", journalReference: "journal/1",
      journaledPostStateDigest: dig("a"), observedHostStateDigest: dig("b"),
      terminalPhase: "failed", reason: "the host is untouched",
    },
  });
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  assert.equal((await store.loadAttestation(attestationId))!.state, "ABORTED");
  const retry = await svc.reserve(who("binder-1"), { attestationId, leaseSeconds: 60 });
  assert.equal(retry.ok, false, "a retry needs a fresh attestation through the whole sequence");
});
