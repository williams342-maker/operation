import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import {
  agentSigningKey, signRequest, generateAgentKeyPairs, signTaskEnvelopeV2, payloadDigest,
  signOwnerAuthorization, privilegedActionDigest, configurationChangeDigest,
  configurationDeploymentPayloadSchema, taskPayloadSchema,
} from "@control-center/shared";
import { buildApp } from "../src/server.js";
import { contentDigest, candidateDigest, type CandidateBinding } from "../src/policy.js";
import type { CandidateRecord } from "../src/store.js";
import { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { castOf } from "./principals.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CHECKLIST §B — the public-interface choreography gate.
//
// Every other test in this suite can be satisfied by code that is wrong in the same way the test is
// wrong, because the test chooses the arguments. This one is the activation gate precisely because it
// does not: each participant here holds ONLY its own credential, and every step of §2.6 crosses a real
// socket in the order a production dispatch would cross it.
//
// What that forbids, and what this file therefore does not contain:
//
//   - `AttestationService` is never imported. Mint, reserve and bind are HTTP calls carrying a bearer
//     credential, so the route layer, the authenticator and the split-authority checks are all on the
//     path. A direct service call would skip all three.
//
//     The check at the bottom of this file enforces that mechanically, along with the absence of every
//     attestation-mutating store call. WHAT IT CANNOT DO is prove the absence of a shortcut nobody has
//     thought of: it is a named-list check, so it catches the specific ways this test could rot, not
//     every possible one. An independent review pointed out that an earlier version claimed more than
//     that, and it did.
//   - No store write after the released-candidate fixture. The fixture is explicitly permitted — it
//     stands in for a review that already happened — and everything after it is a request. The store is
//     READ once at the end, to assert the terminal state; the checklist forbids direct store access for
//     SETUP, and an assertion is not setup.
//   - The executor is handed its own credential and nothing else. It never sees the binder's, and the
//     binder never sees the executor's.
//   - The attempt token is never injected, read out of the store, or passed to the agent. It is minted
//     inside acquire and lives only in the executor's memory. If this test could observe it, the
//     confinement it is meant to prove would already be broken — which is why step 15 below is the one
//     step this gate cannot drive, and says so rather than faking it.
//   - The agent is not called with a task. It POLLS, over its real signed protocol, and finds one.
//
// SCOPE, and it is narrower than it was: the control-center here is a protocol-faithful stub. It
// verifies the agent's real HMAC over the real canonical string with the agent's own secret and answers
// the real poll contract, but it is not the deployed API.
//
// Step 10 is now covered by `choreographyDeployedApi.test.ts`, which runs this same sequence against
// `apps/api` on a socket over a real MongoDB — real authentication, real claim, real control-plane
// envelope signing, real acknowledgement. That file needs a database and skips without one; this one
// runs everywhere and stays the fast structural gate. Keeping both is deliberate: this file is where
// the FORBIDDEN-SHORTCUT checks live, and they are worth running on every machine.
//
// What this file therefore still does not prove: the control plane's own task persistence and
// acknowledgement handling. Read the two together.
//
// STEP 15 — extension — is likewise not driven here, and the reason is structural rather than an
// omission. Extending requires the attempt token, the token is confined to the executor's memory, and
// a test that could supply it would be doing the one thing this gate forbids. Extension is covered by
// the store conformance cases and the route tests, where the token is a legitimate local value.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// The process's identity, established BEFORE the agent module loads: `configPath` is a module constant
// resolved once at import, and `pollOnce()` takes no arguments, so this is the ONLY way to tell this
// executor who it is. That is the property under test, not a convenience.
process.env.NODE_ENV = "test";
const PROCESS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "choreography-home-"));
process.env.CONTROL_CENTER_AGENT_CONFIG = path.join(PROCESS_HOME, "agent.json");
const PROCESS_STATE_DIR = path.join(PROCESS_HOME, "agent-state");

// Dynamic, and load-bearing: a static import is hoisted above the assignment above it.
const { pollOnce } = await import("../../agent/src/agent.js");
const { writeEnforcement } = await import("../../agent/src/reviewEnforcement.js");
const { saveConfig, agentConfigSchema } = await import("../../agent/src/config.js");
const { ExecutionJournal } = await import("../../agent/src/executionJournal.js");

const oid = (c: string) => c.repeat(40).slice(0, 40);
const dig = (c: string) => c.repeat(64).slice(0, 64);

const AGENT_SECRET = "a".repeat(64);
const cp = generateAgentKeyPairs();
const owner = generateAgentKeyPairs();

const MUTATIONS = [
  { name: "DATABASE_URL", operation: "update" as const, secret: true, versionId: "v-000000000001", valueRef: "ref-1" },
  { name: "FEATURE_X", operation: "enable" as const, secret: false, versionId: "v-000000000002", valueRef: "ref-2" },
];

const subject = (over: Record<string, unknown> = {}) => ({
  kind: "configuration.change", changeDigest: configurationChangeDigest(MUTATIONS),
  environmentId: "env-000000000001", targetProfileId: "profile-00000001", targetProfileRevision: 3,
  ...over,
});

const binding = (over: Record<string, unknown> = {}): CandidateBinding => ({
  subject: subject(),
  projectId: "crafters-market", repository: "williams342-maker/operation", baseBranch: "main",
  baseCommit: oid("a"), candidateCommit: oid("b"), candidateTree: oid("c"), patchDigest: dig("1"),
  artifactDigest: dig("3"), manifestDigest: dig("4"), dependencyLockDigests: [], testPlanVersion: "tp-1",
  testResultDigest: dig("2"), targetEnvironmentClass: "staging", authorIdentity: "claude",
  requestedReviewerClass: "independent", authorityRef: "OWNER-2026-09-02",
  createdAt: "2026-09-02T00:00:00.000Z", occurrenceId: "occ-seed",
  ...over,
} as CandidateBinding);

/** The DEPLOYMENT sub-payload — what the gate binds. It nests inside the task payload. */
const deployment = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "configuration-deployment-v1", action: "configuration.apply.v1",
  planId: "plan-00000000001", planRevision: 1, deploymentId: "deploy-000000001",
  environmentId: "env-000000000001", environmentKind: "staging", protected: false,
  targetProfileId: "profile-00000001", targetProfileRevision: 3, repositoryRoot: "/srv/app",
  environmentFilePath: "/srv/app/.env", composePath: "/srv/app/docker-compose.yml", composeProject: "app",
  statelessServices: ["web"], protectedServices: [],
  healthChecks: [{ id: "web", url: "http://localhost:8080/health", timeoutMs: 5000 }],
  mutations: MUTATIONS,
  encryptedValues: { algorithm: "aes-256-gcm", ciphertext: "x", nonce: "n", authTag: "t", keyVersion: "k1" },
  expectedConfigurationDigest: dig("e"), automaticRollback: true, ...over,
});

let counter = 0;
const idem = (principalId: string) => ({ principalId, scope: "t", key: `k-${counter++}`, requestHash: "h" });

/**
 * STEP 1 — the released-candidate fixture. The one place a store write is permitted, because it stands
 * in for a review round that already concluded rather than for any part of the sequence under test.
 */
async function releaseCandidate(store: InMemoryReviewGateStore, id: string, b: CandidateBinding) {
  await store.registerCandidate({
    acting: { principalId: "claude", credentialEpoch: 1 },
    record: {
      candidateId: id, digest: candidateDigest(b), contentDigest: contentDigest(b), binding: b,
      state: "BUILT", participants: [{ identity: b.authorIdentity, role: "author", at: "2026-09-02T00:00:00.000Z" }],
      occurrences: [], verdicts: [],
    } as CandidateRecord,
    idempotency: idem("claude"),
  });
  const at = "2026-09-02T01:00:00.000Z";
  for (const action of ["submit-tests", "freeze", "request-review", "claim-review"] as const) {
    const moved = await store.applyAction({
      acting: { principalId: action === "claim-review" ? "codex" : "claude", credentialEpoch: 1 },
      candidateId: id, action, billingClass: "INTERNAL_QA_TEST", at, occurrenceId: `w-${action}-${id}`,
      idempotency: idem("claude"),
    });
    assert.equal(moved.applied, true, `${action}: ${JSON.stringify(moved)}`);
  }
  const go = await store.applyVerdict({
    acting: { principalId: "codex", credentialEpoch: 1 },
    candidateId: id, expectedState: "REVIEW_IN_PROGRESS", nextState: "GO",
    occurrence: { occurrenceId: `w-GO-${id}`, from: "REVIEW_IN_PROGRESS", to: "GO", actorIdentity: "codex", billingClass: "INTERNAL_REVIEW", at },
    verdict: { verdictId: `v-${id}`, reviewerIdentity: "codex", verdict: "GO", findings: [], resolves: [], submittedAt: at, at },
    addParticipant: { identity: "codex", role: "reviewer", at },
    idempotency: idem("codex"),
  });
  assert.equal(go.applied, true, JSON.stringify(go));
}

type Call = { status: number; body: Record<string, unknown> };

/**
 * `close()` alone stops accepting and then WAITS for live connections to end, and the agent's fetch
 * holds its sockets open with keep-alive — so the suite finished green and the process still would not
 * exit. Dropping the connections first is what actually releases the handle.
 */
async function shutDown(server: http.Server) {
  server.closeAllConnections();
  await new Promise((resolve) => { server.close(resolve); });
}

/**
 * The ONLY way this test reaches the gate: a bearer credential over HTTP. There is no handle to the
 * service and no second argument that could carry an identity the credential does not.
 */
async function gate(url: string, credential: string, endpoint: string, body: unknown,
  headers: Record<string, string> = {}): Promise<Call> {
  const response = await fetch(`${url}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${credential}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/**
 * A protocol-faithful control-center. It verifies the agent's signature the way the real middleware
 * does — recomputing the HMAC over the canonical string with the agent's own secret — so an executor
 * carrying the wrong credential cannot poll.
 */
function controlCenter(tasks: () => unknown[], secret = AGENT_SECRET) {
  const acks: { taskId?: string; event?: string; message?: string }[] = [];
  const polls: unknown[] = [];
  const unauthorized: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const send = (status: number, payload: unknown) =>
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
      const expected = signRequest(agentSigningKey(secret), {
        method: "POST", path: req.url ?? "", timestamp: String(req.headers["x-agent-timestamp"] ?? ""),
        nonce: String(req.headers["x-agent-nonce"] ?? ""), body,
      });
      if (req.headers["x-agent-id"] !== "agent-1" || req.headers["x-agent-signature"] !== expected) {
        unauthorized.push(String(req.url));
        return send(401, { error: "bad agent signature" });
      }
      if (req.url === "/api/agent/poll") { polls.push(JSON.parse(body)); return send(200, { serverId: "server-1", tasks: tasks() }); }
      if (req.url === "/api/agent/tasks/ack") { acks.push(JSON.parse(body)); return send(200, {}); }
      return send(404, {});
    });
  });
  return { server, acks, polls, unauthorized };
}

/** STEP 9 — a real owner signature over the final OUTER payload, plus a real control-plane envelope. */
let nonceCounter = 0;
function signedTask(configurationDeployment: unknown,
  taskType: "configuration.apply" | "configuration.rollback", taskId: string) {
  // PARSED, because the real `createTask` does -- it stores `registry.payload.parse(...)` and signs the
  // envelope over that -- and because a stub that skips a step the control plane takes is where this
  // file's mistakes come from. The last one was the acknowledgement shape, which this stub accepted in
  // any form while the real API rejected the refusal result with a 400. Key order is the same class of
  // thing: `payloadDigest` has no canonicalisation, so a stub that dispatched a hand-built object would
  // be modelling a control plane that does not exist.
  const core = taskPayloadSchema.parse({
    projects: [], httpHealthChecks: [], mongoChecks: [], configurationDeployment,
  });
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const nonce = `owner-nonce-${nonceCounter}`;
  const keyVersion = "owner-v1";
  const signature = signOwnerAuthorization(owner.signingPrivateKey, {
    taskType, orgId: "org-1", serverId: "server-1",
    actionDigest: privilegedActionDigest(core), expiresAt, nonce, keyVersion,
  });
  const payload = { ...core, ownerAuthorization: { signature, issuedAt: new Date().toISOString(), expiresAt, nonce, keyVersion } };
  const unsigned = {
    protocolVersion: "task-v1" as const, taskId, taskType,
    orgId: "org-1", serverId: "server-1", agentId: "agent-1", issuedAt: new Date().toISOString(),
    expiresAt, nonce: `envelope-nonce-${nonceCounter++}-padding`, payloadDigest: payloadDigest(payload),
    signingKeyVersion: "cp-ed25519-v1",
  };
  return { envelope: { ...unsigned, signature: signTaskEnvelopeV2(cp.signingPrivateKey, unsigned) }, payload };
}

/**
 * The whole §2.6 sequence, end to end, for one verb.
 *
 * `verb` selects both the attestation KIND and the payload ACTION, and step 7 asserts the mapping
 * between them by attempting the OTHER verb's payload against this attestation first.
 */
async function choreograph(verb: "apply" | "rollback") {
  // STEP 2 — separate principals, each with its own credential and its own authority. The binder and
  // the executor are scoped to the same target and are still different principals; that is the split.
  const store = new InMemoryReviewGateStore();
  const cast = await castOf([
    { principalId: "owner", roles: ["owner"] },
    { principalId: "claude", roles: ["author"] },
    { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
    { principalId: "binder-1", roles: ["binder"], targetScopes: [{ orgId: "org-1", serverId: "server-1" }] },
    { principalId: "agent-1", roles: ["executor"], targetScopes: [{ orgId: "org-1", serverId: "server-1" }] },
  ], store);

  // STEP 1 — a released candidate. A rollback additionally needs the candidate it restores to have been
  // reviewed and released in its own right, so that one is released first and named as the target.
  const applyBinding = binding();
  await releaseCandidate(store, "c1", applyBinding);
  const candidateId = verb === "apply" ? "c1" : "c2";

  const gateServer = buildApp(store).listen(0);
  await new Promise((resolve) => gateServer.once("listening", resolve));
  const gateUrl = `http://127.0.0.1:${(gateServer.address() as AddressInfo).port}`;

  if (verb === "rollback") {
    // "You may not roll back to content that was never reviewed and released." Reaching GO is NOT
    // release -- release is what the OWNER DECISION does. So the target is released here the only way
    // it can be: by a real owner decision over HTTP. The gate refused this test's first shape with
    // `rollback_target_not_released`, and it was right to.
    const target = await gate(gateUrl, cast.credentialFor("owner"), "/candidates/c1/owner-decision", {
      attestations: [{
        kind: "configuration.apply", orgId: "org-1", serverId: "server-1",
        audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }],
    }, { "idempotency-key": "mint-rollback-target" });
    assert.equal(target.status, 200, `releasing the rollback target: ${JSON.stringify(target)}`);
    await releaseCandidate(store, "c2", binding({
      subject: subject({ rollbackTarget: { candidateId: "c1", contentDigest: contentDigest(applyBinding) } }),
      occurrenceId: "occ-seed-2",
    }));
  }

  const kind = verb === "apply" ? "configuration.apply" : "configuration.rollback";
  const action = verb === "apply" ? "configuration.apply.v1" : "configuration.rollback.v1";
  const otherAction = verb === "apply" ? "configuration.rollback.v1" : "configuration.apply.v1";
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();

  // STEP 3 — the OWNER mints, over HTTP, naming both principals. Not the binder, not the executor.
  const minted = await gate(gateUrl, cast.credentialFor("owner"), `/candidates/${candidateId}/owner-decision`, {
    attestations: [{
      kind, orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt,
    }],
  }, { "idempotency-key": `mint-${verb}` });
  assert.equal(minted.status, 200, JSON.stringify(minted));
  const attestationId = (minted.body as unknown as { attestationIds: string[] }).attestationIds[0];

  // The executor may NOT mint. Same request, its own credential — the authority is the owner's.
  const executorMint = await gate(gateUrl, cast.credentialFor("agent-1"), `/candidates/${candidateId}/owner-decision`, {
    attestations: [{
      kind, orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt,
    }],
  }, { "idempotency-key": `mint-executor-${verb}` });
  assert.notEqual(executorMint.status, 200, "an executor must not be able to mint its own authorization");

  // STEP 4 — the BINDER reserves, over HTTP, with its own credential.
  const reserved = await gate(gateUrl, cast.credentialFor("binder-1"), `/attestations/${attestationId}/reserve`, { leaseSeconds: 600 });
  assert.equal(reserved.status, 200, JSON.stringify(reserved));
  const leaseId = (reserved.body as unknown as { leaseId: string }).leaseId;

  // The EXECUTOR may not reserve. Reserving and binding are the binder's authority, and the executor
  // holding the audience role is exactly the confusion split authority exists to prevent.
  const executorReserve = await gate(gateUrl, cast.credentialFor("agent-1"), `/attestations/${attestationId}/reserve`, { leaseSeconds: 600 });
  assert.notEqual(executorReserve.status, 200, "the audience principal must not be able to reserve");

  // STEP 5 — the final sub-payload, carrying the authorization the binder just took.
  const configurationDeployment = deployment({ action, reviewAuthorization: { attestationId, leaseId } });

  // STEP 7 — the action-to-schema mapping, asserted at BIND, where it is enforced. Both configuration
  // kinds share one subject, one payload schema and one change-set digest: the verb is the only thing
  // separating an apply from a rollback of the same change set, so it is the only thing to test here.
  const wrongVerb = await gate(gateUrl, cast.credentialFor("binder-1"), `/attestations/${attestationId}/bind`, {
    leaseId, payload: deployment({ action: otherAction, reviewAuthorization: { attestationId, leaseId } }),
  });
  assert.notEqual(wrongVerb.status, 200, `a ${kind} attestation must refuse a ${otherAction} payload`);
  assert.equal(wrongVerb.body.code, "payload_not_reviewed_action", JSON.stringify(wrongVerb.body));

  // STEP 6 — the BINDER binds the correct payload, over HTTP.
  const bound = await gate(gateUrl, cast.credentialFor("binder-1"), `/attestations/${attestationId}/bind`, {
    leaseId, payload: configurationDeployment,
  });
  assert.equal(bound.status, 200, JSON.stringify(bound));

  // STEPS 8 & 9 — the outer task wrapping the bound sub-payload, under a real owner signature.
  const claimed = signedTask(configurationDeployment, kind as "configuration.apply" | "configuration.rollback", `task-${verb}`);

  // STEP 10 — dispatch. The task is placed where a poll will find it; nothing hands it to the agent.
  let dispatched: unknown[] = [claimed];
  const cc = controlCenter(() => { const next = dispatched; dispatched = []; return next; });
  cc.server.listen(0);
  await new Promise((resolve) => cc.server.once("listening", resolve));

  // STEP 12 — an ENFORCING executor, authenticated ONLY with its configured executor credential. The
  // enforcement record lives at the location the PROCESS derives, so no argument can relocate it.
  fs.rmSync(PROCESS_STATE_DIR, { recursive: true, force: true });
  writeEnforcement(PROCESS_STATE_DIR, { state: "ENFORCING", by: "owner", reason: "choreography gate" });
  saveConfig(agentConfigSchema.parse({
    controlCenterUrl: `http://127.0.0.1:${(cc.server.address() as AddressInfo).port}`,
    agentId: "agent-1", agentSecret: AGENT_SECRET, keyProtocolVersion: "agent-v2",
    controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey,
    // The EXECUTOR's credential. The binder's never appears in this process.
    reviewGate: { url: gateUrl, credential: cast.credentialFor("agent-1"), timeoutMs: 5000 },
  }));

  // STEP 11 — poll, over the agent's real signed protocol. `pollOnce()` takes no arguments: it resolves
  // its own configuration, finds its own enforcement record, claims the task and drives steps 13-17
  // (acquire, durable claim, effect, redeem) inside the executor.
  //
  // The effect itself cannot succeed on a test machine — there is no docker, and the fixture's health
  // check is refused by the agent's own SSRF guard. That is downstream of everything measured here: the
  // gate's assertions are that acquisition happened BEFORE the effect and that settlement happened
  // whatever the effect did.
  const pollError = await pollOnce().then(() => null, (error: Error) => error.message);

  const journal = new ExecutionJournal(path.join(PROCESS_STATE_DIR, "execution-journal"));
  const record = await store.loadAttestation(attestationId);
  await shutDown(gateServer);
  await shutDown(cc.server);
  return { cc, journal, record, attestationId, configurationDeployment, pollError };
}

for (const verb of ["apply", "rollback"] as const) {
  // STEP 19 — the same gate, run for both verb mappings.
  test(`§B choreography: a polled ${verb} runs the full §2.6 sequence over the public interface`, async () => {
    const run = await choreograph(verb);

    assert.deepEqual(run.cc.unauthorized, [],
      "every control-center request must have carried a verifiable agent signature");
    assert.equal(run.cc.polls.length, 1, "the agent polled");

    // STEP 18 — the terminal gate state. CONSUMED means this executor acquired and redeemed: it took
    // execution before touching the host and settled afterwards.
    assert.equal(run.record?.state, "CONSUMED",
      `expected a settled attestation; poll error was ${run.pollError}`);

    // STEP 13/14 — the durable claim, written BEFORE the effect and settled after it.
    const entries = run.journal.list();
    assert.equal(entries.length, 1, "exactly one durable attempt was recorded on this host");
    assert.equal(entries[0].attestationId, run.attestationId);
    assert.ok(entries[0].startedAt, "the claim was durable before the effect");
    assert.ok(entries[0].finishedAt, "and it was settled, not left dangling");

    // The digest the executor claimed is the SUB-payload's, which is what the binder bound — not the
    // outer task's. Sending the wrapper's digest would refuse every privileged task in production.
    // Over the PARSE at both ends, which is what the serialization contract requires: the gate binds
    // the digest of its parse and the executor sends the digest of its own, so key order cannot decide
    // whether a correct authorization is honoured. This used to compare against the hand-built fixture,
    // and passed only because that fixture happened to be close enough to schema order.
    assert.equal(entries[0].actionDigest,
      privilegedActionDigest(configurationDeploymentPayloadSchema.parse(run.configurationDeployment)));

    // STEP 18 — the reconciliation evidence the executor owes the control-center.
    assert.ok(run.cc.acks.length >= 1, `expected an acknowledgement, got ${JSON.stringify(run.cc.acks)}`);

    // The attempt token is single-delivery and confined to the executor's memory. It must not have
    // reached the durable journal, which is the one place a copy would outlive the attempt.
    const journalDir = path.join(PROCESS_STATE_DIR, "execution-journal");
    const journalText = fs.readdirSync(journalDir)
      .map((entry) => fs.readFileSync(path.join(journalDir, entry), "utf8")).join("|");
    assert.ok(journalText.length > 0, "there is journal content to check");
    assert.ok(!/attemptToken/i.test(journalText), "the attempt token must not be journalled");
  });
}

test("§B choreography: an executor carrying the wrong credential cannot even poll", async () => {
  // The control-center verifies the real HMAC. This is what makes "authenticated ONLY with its own
  // credential" a measured property rather than a described one.
  const cc = controlCenter(() => []);
  cc.server.listen(0);
  await new Promise((resolve) => cc.server.once("listening", resolve));
  saveConfig(agentConfigSchema.parse({
    controlCenterUrl: `http://127.0.0.1:${(cc.server.address() as AddressInfo).port}`,
    agentId: "agent-1", agentSecret: "b".repeat(64), keyProtocolVersion: "agent-v2",
    controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey,
    // Gate configuration must be present and usable, or an ENFORCING executor refuses to START and the
    // poll never happens -- correct behaviour, but a different property than the one under test here.
    reviewGate: { url: "http://127.0.0.1:9", credential: "unused-credential", timeoutMs: 1000 },
  }));
  const error = await pollOnce().then(() => null, (e: Error) => e.message);
  assert.match(String(error), /401/, "a wrong agent secret must fail the poll");
  assert.deepEqual(cc.unauthorized, ["/api/agent/poll"]);
  await shutDown(cc.server);
});

test("§B choreography: this gate does not use the forbidden shortcuts", () => {
  // Mechanical, because the value of this file is entirely in what it refuses to import. A later edit
  // that reaches for the service directly would otherwise still pass every assertion above.
  const source = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  // Scoped to real code, not comments. The first version of this check searched the whole file for
  // names it had to spell out in its own assertion, so it always found itself and always failed; every
  // needle below is therefore assembled from pieces that never appear joined anywhere in this file.
  const lines = source.split("\n").filter((line) => !line.trim().startsWith("//"));
  const imports = lines.filter((line) => line.trim().startsWith("import ") || line.includes("await import(")).join("\n");
  const code = lines.join("\n");

  const service = ["Attestation", "Service"].join("");
  const direct = ["execute", "Task"].join("");
  assert.ok(!imports.includes(service), `must not import ${service}: mint, reserve and bind are HTTP`);
  assert.ok(!imports.includes(direct), `must not import ${direct}: the executor is reached by polling`);
  assert.ok(imports.includes("pollOnce"), "and the poll path is the one it does import");

  // Every attestation-mutating store call, by name. These are the operations §2.6 sequences, and each
  // one has to cross the socket with a credential or this test proves nothing about authority.
  for (const verb of ["reserve", "bind", "acquire", "redeem", "extend"]) {
    const forbidden = `store.${verb}${verb === "extend" ? "Execution" : "Attestation"}(`;
    assert.ok(!code.includes(forbidden), `must not call ${forbidden} directly`);
  }
  // The owner decision is a mint, and it is the one an executor must not be able to perform.
  assert.ok(!code.includes(`store.${["record", "OwnerDecision"].join("")}(`),
    "the owner decision must be an authenticated request, not a store write");
  // Nothing may hand the executor a token, or plant a verifier for one.
  assert.ok(!code.includes(["attemptToken", "Verifier"].join("")),
    "the attempt token must be minted by acquire, never seeded");
});
