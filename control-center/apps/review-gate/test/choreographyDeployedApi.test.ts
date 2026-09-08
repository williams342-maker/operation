import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ObjectId } from "mongodb";
import {
  agentSigningKey, generateAgentKeyPairs, signOwnerAuthorization, privilegedActionDigest,
  configurationChangeDigest, taskPayloadSchema,
} from "@control-center/shared";
import { buildApp } from "../src/server.js";
import { contentDigest, candidateDigest, type CandidateBinding } from "../src/policy.js";
import type { CandidateRecord } from "../src/store.js";
import { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { castOf } from "./principals.js";
import { fixtureForgeSecurity } from "../../agent/test/fixtureForgeSecurity.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CHECKLIST §B STEP 10 — the choreography, through the DEPLOYED control-center.
//
// `choreography.test.ts` drives the same sequence against a protocol-faithful stub, and its own header
// says so: it verifies the agent's real HMAC and answers the real poll contract, but it is not
// `apps/api`. Two independent review rounds called that substitution an activation blocker, correctly.
// This file removes it.
//
// What is real here that was not there:
//
//   - The Express app from `apps/api/src/server.ts`, on a socket, against a real MongoDB. Nothing is
//     re-implemented: `requireSignedAgent` authenticates, `claimTasksForAgent` claims, `buildEnvelope`
//     signs with the control-plane key, `acknowledgeTask` records the outcome.
//   - `createTask` is the dispatch. It is the same function the configuration workflow calls, and with
//     `CONTROL_CENTER_OWNER_PUBLIC_KEY` set it VERIFIES the owner authorization before the task is ever
//     queued — so step 9's signature is checked by the control plane rather than only by the executor.
//   - The task is claimed by a POLL. Nothing hands it to the agent.
//
// The app is importable in a test at all because `server.ts` guards `connectDb()` and `app.listen()`
// behind `NODE_ENV !== "test"`, and `db.ts` reads `MONGO_URL` at module load — so the environment below
// is set BEFORE the dynamic imports, and this process connects the app to a database it owns.
//
// The server is enrolled `keyProtocolVersion: "agent-v2"` with `migrationState: "dual"`. That is a real
// mid-migration state and it is the combination this test needs: v2 gives control-plane-signed
// envelopes, and dual still accepts the v1-signed REQUESTS the agent's `signedPost` actually sends,
// which declares no key version. An agent enrolled straight to "v2" could not poll with today's client.
//
// WHAT PUTTING THE REAL API IN THE LOOP IMMEDIATELY FOUND, recorded because it is the argument for
// this file existing at all:
//
//   - An ENFORCING executor could not REPORT a gate refusal. `acknowledgeTask` parses every failed
//     configuration acknowledgement with `deploymentProgressSchema`; the refusal result did not fit,
//     the acknowledgement came back 400, `executeTask` threw, and the poll loop reported a fabricated
//     `progress: 100, errorCategory: unknown` deployment failure for a task where nothing ran. The
//     stub accepted any acknowledgement shape, so no amount of running the other file would have
//     surfaced it. Fixed, with the second test below as the regression.
//   - `payloadDigest` is `sha256(JSON.stringify(...))` with no canonicalisation, so KEY ORDER decides
//     it, and everything downstream digests the zod-PARSED payload. A hand-built object with the same
//     fields in a different order is refused twice over — once by the control plane verifying the
//     owner signature, once by the gate comparing the action digest. Both fail closed, and both are
//     traps for the real offline signing and binding tools. See the note at the parse below.
//
// STEP 15 IS NOW COVERED HERE TOO, at the bottom of this file, and the long note above those cases
// records why the first three attempts at it failed.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

process.env.NODE_ENV = "test";
const PROCESS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "choreography-api-"));
process.env.CONTROL_CENTER_AGENT_CONFIG = path.join(PROCESS_HOME, "agent.json");
const PROCESS_STATE_DIR = path.join(PROCESS_HOME, "agent-state");

const mongoUrl = process.env.REVIEW_GATE_TEST_MONGO_URL;

if (!mongoUrl) {
  test("§B step 10 SKIPPED — no MongoDB configured for the deployed API", { skip: true }, () => {
    // A skip rather than a silent absence: a suite that says nothing about the deployed dispatch path
    // reads exactly like one where it passed.
  });
} else {
  const AGENT_SECRET = "a".repeat(64);
  const AGENT_ID = "agent-choreography-1";
  const cp = generateAgentKeyPairs();
  const owner = generateAgentKeyPairs();

  // Read at module load by `db.ts`, so they must be set before it is imported.
  process.env.MONGO_URL = mongoUrl;
  process.env.CONTROL_CENTER_DB = `choreography_api_${process.pid}`;
  // The control plane behaves as agent-v1 unless this is explicitly on, and v2 envelopes need it.
  process.env.CONTROL_CENTER_AGENT_PROTOCOL_V2 = "true";
  process.env.CONTROL_CENTER_TASK_SIGNING_PRIVATE_KEY = cp.signingPrivateKey;
  // Setting this makes `createTask` verify the owner signature itself. Without it the control plane's
  // layer-2 boundary is inert and only the executor would check.
  process.env.CONTROL_CENTER_OWNER_PUBLIC_KEY = owner.signingPublicKey;

  const { app } = await import("../../api/src/server.js");
  const { connectDb, collections, client } = await import("../../api/src/db.js");
  const { createTask } = await import("../../api/src/tasks.js");
  const security = await fixtureForgeSecurity({ orgId: "unassigned", serverId: "unassigned" });
  const { pollOnce } = await import("../../agent/src/agent.js");
  const { writeEnforcement, readEnforcement } = await import("../../agent/src/reviewEnforcement.js");
  const { saveConfig, agentConfigSchema, stateDir } = await import("../../agent/src/config.js");
  const { ExecutionJournal } = await import("../../agent/src/executionJournal.js");
  // The agent's own digest of an environment file, so the payload commits to the same bytes the
  // deployment will read. Re-deriving it here would be a second implementation of one contract.
  const { configurationDigest } = await import("../../agent/src/configurationDeployment.js");

  const oid = (c: string) => c.repeat(40).slice(0, 40);
  const dig = (c: string) => c.repeat(64).slice(0, 64);
  let counter = 0;
  const idem = (principalId: string) => ({ principalId, scope: "t", key: `k-${counter++}`, requestHash: "h" });

  const MUTATIONS = [
    { name: "DATABASE_URL", operation: "update" as const, secret: true, versionId: "v-000000000001", valueRef: "ref-1" },
    { name: "FEATURE_X", operation: "enable" as const, secret: false, versionId: "v-000000000002", valueRef: "ref-2" },
  ];

  const binding = (): CandidateBinding => ({
    subject: {
      kind: "configuration.change", changeDigest: configurationChangeDigest(MUTATIONS),
      environmentId: "env-000000000001", targetProfileId: "profile-00000001", targetProfileRevision: 3,
    },
    projectId: "crafters-market", repository: "williams342-maker/operation", baseBranch: "main",
    baseCommit: oid("a"), candidateCommit: oid("b"), candidateTree: oid("c"), patchDigest: dig("1"),
    artifactDigest: dig("3"), manifestDigest: dig("4"), dependencyLockDigests: [], testPlanVersion: "tp-1",
    testResultDigest: dig("2"), targetEnvironmentClass: "staging", authorIdentity: "claude",
    requestedReviewerClass: "independent", authorityRef: "OWNER-2026-09-02",
    createdAt: "2026-09-02T00:00:00.000Z", occurrenceId: "occ-seed",
  } as CandidateBinding);

  const deployment = (over: Record<string, unknown>) => ({
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

  /** The released-candidate fixture — the one place a direct store write is permitted. */
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
        candidateId: id, action, billingClass: "INTERNAL_QA_TEST", at,
        occurrenceId: `w-${action}`, idempotency: idem("claude"),
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

  /** The gate, reached only over HTTP with a bearer credential. */
  async function gate(url: string, credential: string, endpoint: string, body: unknown,
    headers: Record<string, string> = {}) {
    const response = await fetch(`${url}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}`, ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  // Connected once for the whole file: `connectDb` and the socket are process-wide, and a per-test
  // teardown that closed the client would leave every later case without a database.
  await connectDb();
  const apiServer = app.listen(0);
  await new Promise((resolve) => apiServer.once("listening", resolve));
  const apiUrl = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;

  after(async () => {
    apiServer.closeAllConnections();
    await new Promise((resolve) => { apiServer.close(resolve); });
    await client.db(process.env.CONTROL_CENTER_DB).dropDatabase();
    await client.close();
  });

  test("§B step 10: the full §2.6 sequence through the DEPLOYED control-center API", async (t) => {
    const orgId = new ObjectId();
    const serverId = new ObjectId();
    const now = new Date();

    await collections.organizations.insertOne({
      _id: orgId, orgId, name: "Choreography", slug: `choreography-${process.pid}`,
      createdAt: now, updatedAt: now,
    } as never);
    await collections.servers.insertOne({
      _id: serverId, orgId, name: "target", hostname: "target.test",
      agentId: AGENT_ID,
      // What `requireSignedAgent` verifies the agent's HMAC against.
      agentSecretHash: agentSigningKey(AGENT_SECRET),
      credentialVersion: 1,
      // v2 for control-plane-signed ENVELOPES; dual so the agent's v1-signed REQUESTS are still
      // accepted, which is what its client actually sends.
      keyProtocolVersion: "agent-v2", migrationState: "dual", legacyCredentialUsable: true,
      status: "online", createdAt: now, updatedAt: now,
    } as never);

    // ── the gate, and the review that already happened ──────────────────────────────────────────
    const store = new InMemoryReviewGateStore();
    const cast = await castOf([
      { principalId: "owner", roles: ["owner"] },
      { principalId: "claude", roles: ["author"] },
      { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
      { principalId: "binder-1", roles: ["binder"], targetScopes: [{ orgId: orgId.toHexString(), serverId: serverId.toHexString() }] },
      { principalId: AGENT_ID, roles: ["executor"], targetScopes: [{ orgId: orgId.toHexString(), serverId: serverId.toHexString() }] },
    ], store);
    await releaseCandidate(store, "c1", binding());

    const gateServer = buildApp(store).listen(0);
    await new Promise((resolve) => gateServer.once("listening", resolve));
    const gateUrl = `http://127.0.0.1:${(gateServer.address() as AddressInfo).port}`;

    t.after(async () => {
      gateServer.closeAllConnections();
      await new Promise((resolve) => { gateServer.close(resolve); });
    });

    // STEP 3 — the OWNER mints, over HTTP, naming both principals. The target is the API's own
    // org and server ids, so the gate and the control plane are talking about the same host.
    const minted = await gate(gateUrl, cast.credentialFor("owner"), "/candidates/c1/owner-decision", {
      attestations: [{
        kind: "configuration.apply", orgId: orgId.toHexString(), serverId: serverId.toHexString(),
        audiencePrincipalId: AGENT_ID, bindingPrincipalId: "binder-1",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }],
    }, { "idempotency-key": "mint-api" });
    assert.equal(minted.status, 200, JSON.stringify(minted));
    const attestationId = (minted.body as unknown as { attestationIds: string[] }).attestationIds[0];

    // STEPS 4 & 6 — the BINDER reserves and binds, over HTTP, with its own credential.
    const reserved = await gate(gateUrl, cast.credentialFor("binder-1"),
      `/attestations/${attestationId}/reserve`, { leaseSeconds: 3600 });
    assert.equal(reserved.status, 200, JSON.stringify(reserved));
    const leaseId = (reserved.body as unknown as { leaseId: string }).leaseId;

    // PARSED BEFORE ANYTHING IS BOUND OR SIGNED, and that is not a formality.
    //
    // `payloadDigest` is `sha256(JSON.stringify(payload))` with NO canonicalisation, so it is sensitive
    // to KEY ORDER -- and everything downstream digests the ZOD-PARSED payload, whose keys come out in
    // schema-declaration order. A hand-built object with the same keys in a different order produces a
    // different digest at every one of the three places that take one, and this test hit two of them
    // before getting here:
    //
    //   - `createTask` verified the owner signature against the parsed payload and refused it
    //     ("Owner authorization invalid");
    //   - the gate had bound the hand-built sub-payload, so the executor's digest of the payload the
    //     control plane actually stored did not match and acquire was refused
    //     (`action_digest_mismatch`).
    //
    // Both fail CLOSED, so neither is a hole. Both are live traps for the real workflow: whoever binds
    // and whoever signs offline must serialise exactly as the schema will, or correct authorizations
    // are refused for a reason nothing reports. Parsing first is what those tools have to do.
    const core = taskPayloadSchema.parse({
      projects: [], httpHealthChecks: [], mongoChecks: [],
      configurationDeployment: deployment({ reviewAuthorization: { attestationId, leaseId } }),
    });
    const configurationDeployment = core.configurationDeployment;

    // STEP 6 — the BINDER binds the sub-payload AS THE CONTROL PLANE WILL STORE IT.
    const bound = await gate(gateUrl, cast.credentialFor("binder-1"),
      `/attestations/${attestationId}/bind`, { leaseId, payload: configurationDeployment });
    assert.equal(bound.status, 200, JSON.stringify(bound));
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const payload = {
      ...core,
      ownerAuthorization: {
        signature: signOwnerAuthorization(owner.signingPrivateKey, {
          taskType: "configuration.apply", orgId: orgId.toHexString(), serverId: serverId.toHexString(),
          actionDigest: privilegedActionDigest(core), expiresAt, nonce: "owner-nonce-api",
          keyVersion: "owner-v1",
        }),
        issuedAt: new Date().toISOString(), expiresAt, nonce: "owner-nonce-api", keyVersion: "owner-v1",
      },
    };

    // STEP 10 — DISPATCH, through the control-center's own task creation. This verifies the owner
    // authorization before queueing: a bad signature never becomes a task at all.
    const task = await createTask({
      orgId,
      server: { _id: serverId, orgId, agentId: AGENT_ID } as never,
      type: "configuration.apply", payload: payload as never,
      idempotencyKey: "choreography-api-1",
    });
    assert.ok(task._id, "the control plane queued the task");

    // STEP 12 — an ENFORCING executor holding only its own credentials.
    fs.rmSync(PROCESS_STATE_DIR, { recursive: true, force: true });
    writeEnforcement(PROCESS_STATE_DIR, { state: "ENFORCING", by: "owner", reason: "step 10 gate" });
    // ASSERTED, not assumed. A record written where the agent does not look leaves it ADVISORY, and an
    // advisory run applies the deployment and never touches the gate -- which looks like a passing
    // dispatch and proves nothing about enforcement. Read it back through the agent's OWN resolution
    // so the location is the one the process derives, not the one this test chose.
    assert.equal(stateDir(), PROCESS_STATE_DIR,
      "the agent must derive the same state directory this test wrote to");
    assert.equal(readEnforcement(stateDir()).state, "ENFORCING",
      "this executor must actually be enforcing before the poll means anything");
    security.setTarget({ orgId: orgId.toHexString(), serverId: serverId.toHexString() });
    saveConfig(agentConfigSchema.parse({
      orgId: orgId.toHexString(), serverId: serverId.toHexString(),
      controlCenterUrl: apiUrl,
      agentId: AGENT_ID, agentSecret: AGENT_SECRET, keyProtocolVersion: "agent-v2",
      controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey,
      // The EXECUTOR's gate credential. The binder's never enters this process.
      reviewGate: { url: gateUrl, credential: cast.credentialFor(AGENT_ID), timeoutMs: 5000 },
    }));

    // STEP 11 — poll. The real API authenticates the agent, claims the task, and signs the envelope
    // with the control-plane key; the executor verifies it, acquires, applies, and redeems.
    //
    // The effect cannot succeed on a test machine — no docker, and the fixture's health check is
    // refused by the agent's own SSRF guard. That is downstream of everything measured here: what
    // matters is that acquisition happened BEFORE the effect and settlement happened whatever it did.
    const pollError = await pollOnce().then(() => null, (error: Error) => error.message);

    // STEP 18 — the terminal gate state. CONSUMED means this executor acquired and redeemed.
    //
    // The diagnostic is gathered BEFORE asserting, because "still RESERVED_BOUND" has several very
    // different causes -- the task was never claimed, the envelope failed verification, the host was
    // not enforcing, the gate refused -- and a bare state comparison cannot tell them apart.
    const record = await store.loadAttestation(attestationId);
    const storedTask = await collections.agentTasks.findOne({ _id: task._id });
    const audits = await collections.auditEvents.find({ orgId }).toArray();
    const journalNow = fs.existsSync(path.join(PROCESS_STATE_DIR, "execution-journal"))
      ? new ExecutionJournal(path.join(PROCESS_STATE_DIR, "execution-journal")).list() : [];
    const diagnostic = JSON.stringify({
      pollError,
      journalEntries: journalNow.length,
      journal: journalNow.map((e) => ({ id: e.attestationId, outcome: e.outcome })),
      attestationState: record?.state,
      enforcementAtEnd: readEnforcement(stateDir()).state,
      resultDetail: JSON.stringify(storedTask?.result).slice(0, 300),
      taskState: storedTask?.state,
      claimedAt: Boolean(storedTask?.claimedAt),
      resultSummary: storedTask?.resultSummary,
      errorCategory: storedTask?.errorCategory,
      audit: audits.map((entry) => `${entry.action}:${entry.result}`),
    });
    assert.equal(record?.state, "CONSUMED", `expected a settled attestation. ${diagnostic}`);

    // STEP 13/14 — the durable claim, and the digest it claimed is the SUB-payload's, which is what
    // the binder bound — not the outer task payload the control plane signed.
    const entries = new ExecutionJournal(path.join(PROCESS_STATE_DIR, "execution-journal")).list();
    assert.equal(entries.length, 1, "exactly one durable attempt on this host");
    assert.equal(entries[0].attestationId, attestationId);
    assert.equal(entries[0].actionDigest, privilegedActionDigest(configurationDeployment));
    assert.ok(entries[0].startedAt, "the claim was durable before the effect");
    assert.ok(entries[0].finishedAt, "and it was settled, not left dangling");

    // The control plane's OWN record of the same execution: it claimed the task and was told how it
    // ended, through the real acknowledgement route.
    const stored = storedTask;
    assert.ok(stored, "the task is still in the control plane's collection");
    assert.ok(["failed", "running", "succeeded"].includes(String(stored?.state)),
      `the control plane recorded an outcome, not a queued task: ${stored?.state}`);
    assert.ok(stored?.claimedAt, "and it records that the agent claimed it by polling");

    // The attempt token is single-delivery and lives only in the executor's memory.
    const journalDir = path.join(PROCESS_STATE_DIR, "execution-journal");
    const journalText = fs.readdirSync(journalDir)
      .map((entry) => fs.readFileSync(path.join(journalDir, entry), "utf8")).join("|");
    assert.ok(!/attemptToken/i.test(journalText), "the attempt token must not be journalled");

    // And the control plane audited the claim, which is the evidence a human would look for.
    const claims = await collections.auditEvents.countDocuments({ orgId, action: "task.claim" });
    assert.equal(claims, 1, "the dispatch path audited exactly one claim");
  });

  test("§B step 10: a gate REFUSAL reaches the control plane as a refusal, not a phantom deployment", async (t) => {
    // THE DEFECT THIS HARNESS FOUND, and it could only appear with the real API in the loop.
    //
    // `acknowledgeTask` parses every failed configuration acknowledgement with
    // `deploymentProgressSchema`. The executor's refusal result did not fit that schema, so the
    // acknowledgement came back 400, `executeTask` threw, and the poll loop's catch then reported a
    // FABRICATED generic failure -- `phase: failed, progress: 100, errorCategory: unknown` -- for a task
    // where nothing had been applied at all. The gate's actual reason never reached the control plane,
    // and an operator reading the task saw "Configuration deployment failed" for a deployment that
    // never started.
    //
    // The stub in `choreography.test.ts` accepted any acknowledgement shape, which is exactly why it
    // could not have caught this.
    const agentId = "agent-choreography-refused";
    const orgId = new ObjectId();
    const serverId = new ObjectId();
    const now = new Date();
    await collections.organizations.insertOne({
      _id: orgId, orgId, name: "Choreography refusal", slug: `choreography-refused-${process.pid}`,
      createdAt: now, updatedAt: now,
    } as never);
    await collections.servers.insertOne({
      _id: serverId, orgId, name: "target", hostname: "target-refused.test",
      agentId, agentSecretHash: agentSigningKey(AGENT_SECRET), credentialVersion: 1,
      keyProtocolVersion: "agent-v2", migrationState: "dual", legacyCredentialUsable: true,
      status: "online", createdAt: now, updatedAt: now,
    } as never);

    const store = new InMemoryReviewGateStore();
    const scope = [{ orgId: orgId.toHexString(), serverId: serverId.toHexString() }];
    const cast = await castOf([
      { principalId: "owner", roles: ["owner"] },
      { principalId: "claude", roles: ["author"] },
      { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
      { principalId: "binder-1", roles: ["binder"], targetScopes: scope },
      { principalId: agentId, roles: ["executor"], targetScopes: scope },
    ], store);
    await releaseCandidate(store, "c1", binding());

    const gateServer = buildApp(store).listen(0);
    await new Promise((resolve) => gateServer.once("listening", resolve));
    const gateUrl = `http://127.0.0.1:${(gateServer.address() as AddressInfo).port}`;
    t.after(async () => {
      gateServer.closeAllConnections();
      await new Promise((resolve) => { gateServer.close(resolve); });
    });

    const minted = await gate(gateUrl, cast.credentialFor("owner"), "/candidates/c1/owner-decision", {
      attestations: [{
        kind: "configuration.apply", orgId: orgId.toHexString(), serverId: serverId.toHexString(),
        audiencePrincipalId: agentId, bindingPrincipalId: "binder-1",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }],
    }, { "idempotency-key": "mint-refused" });
    assert.equal(minted.status, 200, JSON.stringify(minted));
    const attestationId = (minted.body as unknown as { attestationIds: string[] }).attestationIds[0];
    const reserved = await gate(gateUrl, cast.credentialFor("binder-1"),
      `/attestations/${attestationId}/reserve`, { leaseSeconds: 3600 });
    const leaseId = (reserved.body as unknown as { leaseId: string }).leaseId;

    // The binder binds ONE payload; the control plane dispatches a DIFFERENT one. That is the shape of
    // a payload substituted after review, and the gate refuses it with `action_digest_mismatch`.
    const reviewed = taskPayloadSchema.parse({
      projects: [], httpHealthChecks: [], mongoChecks: [],
      configurationDeployment: deployment({ reviewAuthorization: { attestationId, leaseId } }) as never,
    });
    const boundOk = await gate(gateUrl, cast.credentialFor("binder-1"),
      `/attestations/${attestationId}/bind`, { leaseId, payload: reviewed.configurationDeployment });
    assert.equal(boundOk.status, 200, JSON.stringify(boundOk));

    const substituted = taskPayloadSchema.parse({
      projects: [], httpHealthChecks: [], mongoChecks: [],
      configurationDeployment: deployment({
        reviewAuthorization: { attestationId, leaseId }, composeProject: "somewhere-else",
      }) as never,
    });
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const payload = {
      ...substituted,
      ownerAuthorization: {
        signature: signOwnerAuthorization(owner.signingPrivateKey, {
          taskType: "configuration.apply", orgId: orgId.toHexString(),
          serverId: serverId.toHexString(), actionDigest: privilegedActionDigest(substituted),
          expiresAt, nonce: "owner-nonce-refused", keyVersion: "owner-v1",
        }),
        issuedAt: new Date().toISOString(), expiresAt, nonce: "owner-nonce-refused",
        keyVersion: "owner-v1",
      },
    };
    const task = await createTask({
      orgId, server: { _id: serverId, orgId, agentId } as never,
      type: "configuration.apply", payload: payload as never, idempotencyKey: "choreography-refused-1",
    });

    fs.rmSync(PROCESS_STATE_DIR, { recursive: true, force: true });
    writeEnforcement(PROCESS_STATE_DIR, { state: "ENFORCING", by: "owner", reason: "refusal case" });
    security.setTarget({ orgId: orgId.toHexString(), serverId: serverId.toHexString() });
    saveConfig(agentConfigSchema.parse({
      orgId: orgId.toHexString(), serverId: serverId.toHexString(),
      controlCenterUrl: apiUrl,
      agentId, agentSecret: AGENT_SECRET, keyProtocolVersion: "agent-v2",
      controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey,
      reviewGate: { url: gateUrl, credential: cast.credentialFor(agentId), timeoutMs: 5000 },
    }));
    assert.equal(readEnforcement(stateDir()).state, "ENFORCING");

    const pollError = await pollOnce().then(() => null, (error: Error) => error.message);

    // NOTHING WAS APPLIED, and the gate still holds the binding.
    assert.equal((await store.loadAttestation(attestationId))?.state, "RESERVED_BOUND",
      "a refused executor must not have taken execution");
    const journalDir = path.join(PROCESS_STATE_DIR, "execution-journal");
    const entries = fs.existsSync(journalDir) ? new ExecutionJournal(journalDir).list() : [];
    assert.equal(entries.length, 0, "and must not have claimed anything on this host");

    // AND THE CONTROL PLANE WAS TOLD SO. This is the half that was broken: the acknowledgement has to
    // survive the API's schema, or the refusal is replaced by a fabricated deployment failure.
    const stored = await collections.agentTasks.findOne({ _id: task._id });
    const result = stored?.result as Record<string, unknown> | undefined;
    assert.equal(stored?.state, "failed", `poll error was ${pollError}`);
    assert.equal(result?.errorCategory, "review_gate",
      `the refusal must be recorded as one: ${JSON.stringify(result)}`);
    assert.equal(result?.reviewGate, "action_digest_mismatch",
      "and the gate's specific code must survive, or nobody can tell WHY it refused");
    // The fabricated failure claimed 100% progress. The truthful one claims none.
    assert.equal(result?.progress, 0, "nothing ran, so no progress may be reported");
    assert.equal(result?.changedVariables, 0);
    assert.match(String(stored?.resultSummary), /review_gate/,
      "the operator-visible summary must name the refusal, not 'unknown'");

    // AND THE AUDIT ENTRY STANDS ALONE. Audit events are queried on their own, and without these an
    // executor refused permission and an ordinary failed deployment produce the same line.
    const completion = await collections.auditEvents.findOne({ orgId, action: "task.complete" });
    assert.equal(completion?.metadata?.errorCategory, "review_gate",
      `the audit entry must carry the refusal: ${JSON.stringify(completion?.metadata)}`);
    assert.equal(completion?.metadata?.reviewGate, "action_digest_mismatch");
  });


  test("a binder that posts the sub-payload in a different KEY ORDER still binds the digest the executor computes",
    async (t) => {
      // THE TRAP THE STEP 10 NOTE ABOVE DESCRIBES, now closed rather than only documented.
      //
      // `payloadDigest` is `sha256(JSON.stringify(...))` with no canonicalisation, so key order decides
      // it. The control plane stores what `taskPayloadSchema` PARSED and signs the envelope over that,
      // and the envelope's own `payloadDigest` check is what forces the executor's copy to be in the
      // same order -- a wire payload in any other order fails envelope verification before anything
      // else. So the executor's action digest is always over schema-declaration order.
      //
      // `bind` used to digest the JSON body the BINDER posted. A binder that sent the same fields in a
      // different order therefore bound a digest the executor could never reproduce, and every acquire
      // was refused `action_digest_mismatch` with nothing naming the cause. It failed closed, so it was
      // never an opening -- but a correct authorization that is refused for an unreportable reason is
      // an unusable protocol, and the way that gets "fixed" in a hurry is by turning enforcement off.
      //
      // `bind` now digests the payload `validatePayload` parsed, in the same call, against the same
      // schema. This case is the end-to-end proof: the binder posts a scrambled body, and the executor
      // -- which knows nothing about that -- acquires and redeems.
      const agentId = "agent-choreography-reordered";
      const orgId = new ObjectId();
      const serverId = new ObjectId();
      const now = new Date();
      await collections.organizations.insertOne({
        _id: orgId, orgId, name: "Choreography reorder", slug: `choreography-reorder-${process.pid}`,
        createdAt: now, updatedAt: now,
      } as never);
      await collections.servers.insertOne({
        _id: serverId, orgId, name: "target", hostname: "target-reordered.test",
        agentId, agentSecretHash: agentSigningKey(AGENT_SECRET), credentialVersion: 1,
        keyProtocolVersion: "agent-v2", migrationState: "dual", legacyCredentialUsable: true,
        status: "online", createdAt: now, updatedAt: now,
      } as never);

      const store = new InMemoryReviewGateStore();
      const scope = [{ orgId: orgId.toHexString(), serverId: serverId.toHexString() }];
      const cast = await castOf([
        { principalId: "owner", roles: ["owner"] },
        { principalId: "claude", roles: ["author"] },
        { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
        { principalId: "binder-1", roles: ["binder"], targetScopes: scope },
        { principalId: agentId, roles: ["executor"], targetScopes: scope },
      ], store);
      await releaseCandidate(store, "c1", binding());

      const gateServer = buildApp(store).listen(0);
      await new Promise((resolve) => gateServer.once("listening", resolve));
      const gateUrl = `http://127.0.0.1:${(gateServer.address() as AddressInfo).port}`;
      t.after(async () => {
        gateServer.closeAllConnections();
        await new Promise((resolve) => { gateServer.close(resolve); });
      });

      const minted = await gate(gateUrl, cast.credentialFor("owner"), "/candidates/c1/owner-decision", {
        attestations: [{
          kind: "configuration.apply", orgId: orgId.toHexString(), serverId: serverId.toHexString(),
          audiencePrincipalId: agentId, bindingPrincipalId: "binder-1",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }],
      }, { "idempotency-key": "mint-reordered" });
      assert.equal(minted.status, 200, JSON.stringify(minted));
      const attestationId = (minted.body as unknown as { attestationIds: string[] }).attestationIds[0];
      const reserved = await gate(gateUrl, cast.credentialFor("binder-1"),
        `/attestations/${attestationId}/reserve`, { leaseSeconds: 900 });
      const leaseId = (reserved.body as unknown as { leaseId: string }).leaseId;

      const core = taskPayloadSchema.parse({
        projects: [], httpHealthChecks: [], mongoChecks: [],
        configurationDeployment: deployment({ reviewAuthorization: { attestationId, leaseId } }),
      });
      const configurationDeployment = core.configurationDeployment as Record<string, unknown>;

      // THE SAME SUB-PAYLOAD, one pair of keys swapped. Identical as an object; different bytes.
      const scrambled = {
        action: configurationDeployment.action,
        schemaVersion: configurationDeployment.schemaVersion,
        ...Object.fromEntries(Object.entries(configurationDeployment)
          .filter(([key]) => key !== "action" && key !== "schemaVersion")),
      };
      assert.notEqual(JSON.stringify(scrambled), JSON.stringify(configurationDeployment),
        "the bodies must really differ as bytes, or this proves nothing");
      assert.deepEqual(scrambled, configurationDeployment, "and be the same object");

      const bound = await gate(gateUrl, cast.credentialFor("binder-1"),
        `/attestations/${attestationId}/bind`, { leaseId, payload: scrambled });
      assert.equal(bound.status, 200, JSON.stringify(bound));
      // The gate bound the digest of the PARSE, which is the one the executor will compute -- not the
      // digest of what was posted.
      assert.equal((bound.body as unknown as { actionDigest: string }).actionDigest,
        privilegedActionDigest(configurationDeployment),
        "the bound digest must be the parsed payload's");

      // The control plane dispatches the payload it parsed, exactly as it always does.
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      const payload = {
        ...core,
        ownerAuthorization: {
          signature: signOwnerAuthorization(owner.signingPrivateKey, {
            taskType: "configuration.apply", orgId: orgId.toHexString(),
            serverId: serverId.toHexString(), actionDigest: privilegedActionDigest(core),
            expiresAt, nonce: "owner-nonce-reordered", keyVersion: "owner-v1",
          }),
          issuedAt: new Date().toISOString(), expiresAt, nonce: "owner-nonce-reordered",
          keyVersion: "owner-v1",
        },
      };
      const task = await createTask({
        orgId, server: { _id: serverId, orgId, agentId } as never,
        type: "configuration.apply", payload: payload as never,
        idempotencyKey: "choreography-reordered-1",
      });

      fs.rmSync(PROCESS_STATE_DIR, { recursive: true, force: true });
      writeEnforcement(PROCESS_STATE_DIR, { state: "ENFORCING", by: "owner", reason: "reorder case" });
      security.setTarget({ orgId: orgId.toHexString(), serverId: serverId.toHexString() });
      saveConfig(agentConfigSchema.parse({
        orgId: orgId.toHexString(), serverId: serverId.toHexString(),
        controlCenterUrl: apiUrl,
        agentId, agentSecret: AGENT_SECRET, keyProtocolVersion: "agent-v2",
        controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey,
        reviewGate: { url: gateUrl, credential: cast.credentialFor(agentId), timeoutMs: 5000 },
      }));
      assert.equal(readEnforcement(stateDir()).state, "ENFORCING");

      const pollError = await pollOnce().then(() => null, (error: Error) => error.message);

      const record = await store.loadAttestation(attestationId);
      const storedTask = await collections.agentTasks.findOne({ _id: task._id });
      const result = storedTask?.result as Record<string, unknown> | undefined;
      // ACQUIRED AND SETTLED. Before the fix this was `RESERVED_BOUND` with the control plane recording
      // `reviewGate: action_digest_mismatch` -- the shape of the refusal case above, for a payload
      // nobody had substituted.
      assert.equal(record?.state, "CONSUMED",
        `a reordered bind must not refuse a correct executor. pollError=${pollError} ` +
        `result=${JSON.stringify(result)}`);
      assert.notEqual(result?.reviewGate, "action_digest_mismatch");
    });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // CHECKLIST §B STEP 15 — "if execution exceeds the initial window, extend with the current
  // credential and token", driven BY THE CHOREOGRAPHY rather than only by a unit test.
  //
  // WHY THE HEADER ABOVE USED TO SAY THIS WAS OUT OF REACH, and what was actually wrong with that.
  //
  // The stated obstacle was the ten-minute initial window: a test cannot spend ten minutes. That much
  // is true, and the window is now a deployment tunable — `AttestationService`'s `initialExecutionMs`,
  // reachable in production as REVIEW_GATE_INITIAL_EXECUTION_MS — so a short one is available. But
  // shortening the window ALONE does not produce an extension here, and the reason is invisible from
  // the gate's side, so it is recorded:
  //
  //   THE EFFECT IN THIS FILE FINISHED ABOUT 2 ms AFTER ACQUIRE. Measured. The fixture's health check
  //   is `http://localhost:8080/health`, which the agent's own SSRF guard refuses inside
  //   `validateHttpCheckUrl` before one file is touched. The keeper schedules its first tick with
  //   `setTimeout(..., 0)`; the effect throws inside the same event-loop turn and `keeper.stop()`
  //   clears that timer before the loop ever reaches a timers phase. The keeper never ran at all — at
  //   a 20 ms window or a 140 ms one the deadline was never moved and the attestation was left
  //   EXECUTING. An extension needs an EXECUTION, not merely a short deadline.
  //
  // So the deployment below is real: a temporary repository root, a real environment file whose digest
  // the payload commits to, a real backup, a real atomic write of the rotated secret, and a real
  // rollback. That is worth having on its own — until now this choreography proved a gate sequence
  // around an effect that never started.
  //
  // WHAT MUST NOT BE REAL IS DOCKER. `docker compose up -d` would be an external mutation on whatever
  // machine ran the suite, and on CI it would try to pull an image. §14 of the handoff asks for a
  // stubbed harness that exercises control flow faithfully while preventing real external mutations,
  // and this is one — placed at the PROCESS boundary, not injected into the executor. A hooks or
  // timing parameter threaded through `executeTask` is exactly what two earlier review rounds
  // rejected, and rightly: it would mean the thing under test was configured by the test.
  //
  // Instead PATH is replaced, for the duration of the case, by a directory holding one file. So
  // `execFixed("docker", ...)` resolves through the same `execFile` call it makes in production, with
  // the same `shell: false`, and finds the stub. The stub is a copy of — or a link to — THE NODE
  // BINARY, which is not decoration: a shell script needs a shebang and fails on Windows, and Node
  // refuses to spawn a `.cmd` without a shell. A Node binary needs neither. Its first argument is
  // always `compose`, and `execFixed` runs it with `cwd` set to the deployment's own repository root,
  // so the script it executes is `<repositoryRoot>/compose`, which the host fixture writes. That
  // script records what it was asked to do and what the environment file said at the instant
  // activation would have happened, sleeps for a fixed time, and exits NON-ZERO — so activation fails,
  // the deployment rolls back, and no health probe ever leaves the machine. The whole effect is
  // offline, and its duration is a constant of this file rather than a property of the machine.
  // ───────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The gate's initial execution window for the two cases below, and the ONE irreducible race in them.
   *
   * WHAT IS GUARANTEED. The effect does not end until the keeper's extension request has been ANSWERED
   * and the original deadline has passed: the stubbed `docker compose` blocks until the recording proxy
   * below has seen the answer, then sleeps until half a second past the deadline acquire granted. So
   * `consumedAt > acquiredAt + initialExecutionMs` holds by construction rather than by arithmetic on
   * two guessed sleeps, and a slower runner cannot shorten it.
   *
   * WHAT IS NOT, AND CANNOT BE. The keeper's extension must REACH the gate before that deadline, or the
   * gate correctly refuses `execution_deadline_passed` and the case fails without a defect. Nothing this
   * test can do makes a scheduler promise: the keeper's first tick is a `setTimeout(..., 0)` inside the
   * executor, and neither the gate's clock nor the executor's timing is injectable -- deliberately, since
   * two earlier review rounds rejected exactly that. A finite window is therefore a tolerance, not a
   * guarantee, and this comment says so rather than implying otherwise.
   *
   * The history is worth keeping. 250 ms came from an unloaded local run, where acquire -> keeper tick ->
   * localhost fetch is single-digit milliseconds. That is a measurement, not a bound, and it was wrong:
   * the SAME code passed `verify` on one GitHub runner and failed on another minutes apart (run
   * `33934596754`, attestation still EXECUTING, `executionDeadline` exactly `acquiredAt + 250 ms` and
   * never moved, both compose calls captured). An independent review had said so before CI did.
   *
   * Twenty seconds is chosen so that exceeding it means the runner is wedged rather than busy -- a stall
   * that long between acquire and one localhost fetch would break most other things in this job first.
   * The cases cost about that long each, because the effect must outlive the window and there is no way
   * to prove an overrun without spending one. When it does fail, it now fails NAMED: the proxy records
   * the extension exchange, so the assertion says the extension was refused and with which code, rather
   * than leaving a bare EXECUTING for someone to interpret.
   */
  const GATE_INITIAL_WINDOW_MS = 20_000;

  /** How long the effect runs past the deadline before settling. Only needs to be non-zero. */
  const OVERRUN_MS = 500;

  /** How long the stub waits for the extension to be answered before giving up and failing loudly. */
  const STUB_WAIT_MS = 60_000;

  type Exchange = {
    path: string;
    status: number;
    /** The gate's refusal code, when it refused. This is the thing `settle` swallows. */
    code?: string;
    /** Present on a successful acquire: the deadline the gate granted, verbatim from its answer. */
    executionDeadline?: string;
  };

  /**
   * A recording proxy in front of the gate, on the path the EXECUTOR uses.
   *
   * It exists for two reasons an independent review asked for, and it changes nothing about what runs:
   * the agent's real `ReviewGateClient` talks to it, it forwards verbatim to the real gate, and it hands
   * the real answer back. The executor's credential travels through unchanged; the proxy neither mints
   * nor inspects authority.
   *
   *   1. IT SAYS WHICH REFUSAL HAPPENED. `settle` swallows the redeem refusal on purpose -- it must not
   *      replace a real execution error with a bookkeeping one -- so from outside, a redeem refused
   *      `execution_deadline_passed` and one refused `attestation_expired`, `wrong_audience`,
   *      `attempt_token_invalid` or `credential_rotated` all leave the same EXECUTING record. The
   *      previous version of the control case asserted only that state, plus that the attestation was
   *      still valid, and the comment claimed that made the execution deadline "the only thing redeem
   *      can have refused on". A reviewer correctly called that an overclaim: it excludes expiry and
   *      nothing else. Reading the gate's own answer settles it instead of arguing about it.
   *   2. IT LETS THE EFFECT SYNCHRONISE ON THE EXTENSION rather than race it. The first extension
   *      exchange -- granted or refused -- releases the stubbed compose, which then runs past the
   *      original deadline. That is what makes the overrun structural.
   */
  function recordingGateProxy(target: string, onExchange: (exchange: Exchange) => void) {
    const exchanges: Exchange[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        // Hop-by-hop and length headers are the proxy's business, not the client's; everything else --
        // authorization and idempotency-key included -- is forwarded exactly as it arrived.
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.headers)) {
          if (["host", "connection", "content-length"].includes(name)) continue;
          if (typeof value === "string") headers[name] = value;
        }
        void fetch(`${target}${req.url ?? ""}`, {
          method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
        }).then(async (upstream) => {
          const text = await upstream.text();
          let code: string | undefined;
          let executionDeadline: string | undefined;
          try {
            // `sendAttestation` spreads the result value at the TOP level beside `ok`, so the deadline
            // is a root field rather than nested. Read from the wire, never recomputed.
            const parsed = JSON.parse(text) as { code?: string; executionDeadline?: string };
            code = parsed.code;
            executionDeadline = parsed.executionDeadline;
          } catch { /* not JSON; the proxy still records the status */ }
          const exchange: Exchange = {
            path: req.url ?? "", status: upstream.status, code, executionDeadline,
          };
          exchanges.push(exchange);
          onExchange(exchange);
          res.writeHead(upstream.status, { "content-type": "application/json" });
          res.end(text);
        }).catch((error: Error) => {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, code: "proxy_error", detail: error.message }));
        });
      });
    });
    return {
      server,
      exchanges,
      /** The first exchange whose path ends in `suffix`, which is what every assertion here wants. */
      first: (suffix: string) => exchanges.find((exchange) => exchange.path.endsWith(suffix)),
    };
  }

  const ORIGINAL_ENV = "PUBLIC=value\nDATABASE_URL=old\n";
  /** Keyed by the `valueRef` of each mutation in MUTATIONS. */
  const SECRET_VALUES = { "ref-1": "postgres://rotated", "ref-2": "true" };

  /** The envelope the control plane's `encryptDeploymentValues` produces, built here from the key. */
  function encryptValues(values: Record<string, string>, signingKey: string) {
    const key = crypto.createHash("sha256").update(`configuration-deployment:${signingKey}`).digest();
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values)), cipher.final()]);
    return {
      algorithm: "aes-256-gcm" as const, ciphertext: ciphertext.toString("base64"),
      nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64"),
      keyVersion: "agent-signing-v1",
    };
  }

  // Made once for the file. A copy of the Node binary is ~100 MB on some platforms, so a symlink or a
  // hard link is taken wherever the platform allows one and nothing is copied at all.
  const STUB_BIN = fs.mkdtempSync(path.join(os.tmpdir(), "choreography-stub-bin-"));
  const DOCKER_STUB = path.join(STUB_BIN, process.platform === "win32" ? "docker.exe" : "docker");
  try {
    fs.symlinkSync(process.execPath, DOCKER_STUB, "file");
  } catch {
    try {
      fs.linkSync(process.execPath, DOCKER_STUB);
    } catch {
      fs.copyFileSync(process.execPath, DOCKER_STUB);
      fs.chmodSync(DOCKER_STUB, 0o755);
    }
  }
  after(() => { fs.rmSync(STUB_BIN, { recursive: true, force: true }); });

  /**
   * A real host to deploy to.
   *
   * The environment file is mode 0600 deliberately: `executeConfigurationDeployment` refuses a file any
   * group or other can write, and a fixture that tripped that check would die before the effect in
   * exactly the way the localhost health check did.
   */
  function deploymentHost() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "choreography-host-"));
    const environmentFilePath = path.join(root, ".env.staging");
    const composePath = path.join(root, "docker-compose.yml");
    fs.writeFileSync(environmentFilePath, ORIGINAL_ENV, { mode: 0o600 });
    fs.chmodSync(environmentFilePath, 0o600);
    fs.writeFileSync(composePath, "services:\n  web:\n    image: fixture\n");
    const capturePath = path.join(root, "captured-commands.jsonl");
    // The script the stubbed `docker` runs. CommonJS, because an extensionless entry point with no
    // package.json beside it is CommonJS. It is EVIDENCE, not an implementation: the command it was
    // given, and the environment file as it stood at the instant activation would have happened.
    fs.writeFileSync(path.join(root, "compose"), [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const captured = path.join(__dirname, "captured-commands.jsonl");',
      'const release = path.join(__dirname, "release-at");',
      "fs.appendFileSync(captured, JSON.stringify({",
      // The FIRST argument the executor passed is `compose`, and Node consumed it as this script's own
      // path -- which is the whole trick, so it is recorded rather than assumed.
      '  script: path.basename(process.argv[1]),',
      "  argv: process.argv.slice(2),",
      "  cwd: process.cwd(),",
      '  environmentFile: fs.readFileSync(path.join(__dirname, ".env.staging"), "utf8"),',
      '}) + "\\n");',
      'var seen = path.join(__dirname, "activation-seen");',
      "// ONLY THE FIRST INVOCATION WAITS: the activation is the one that must outlive the original",
      "// deadline, and the rollback that follows it must not pay for the same wait a second time. A",
      "// marker file rather than a line count, because counting newlines would mean escaping one",
      "// through two layers of source generation to say something this simple.",
      'var first = !fs.existsSync(seen);',
      'fs.writeFileSync(seen, "1");',
      "if (!first) { process.exit(1); }",
      // Poll for the release file the harness writes once the gate has ANSWERED the keeper's extension
      // -- granted or refused. Waiting for the ANSWER rather than for a fixed duration is what makes the
      // overrun structural instead of a race against the scheduler: the effect cannot end before the
      // extension has been decided, however slow the runner is.
      "var waited = 0;",
      "var timer = setInterval(function () {",
      "  waited += 25;",
      "  var until = null;",
      '  try { until = Number(fs.readFileSync(release, "utf8").trim()); } catch (error) { until = null; }',
      "  if (until && Date.now() >= until) { clearInterval(timer); process.exit(1); }",
      // Give up loudly rather than hanging the suite. The assertions then report what the gate actually
      // answered, which is more use than a timeout with no cause attached.
      "  if (waited >= " + STUB_WAIT_MS + ") { clearInterval(timer); process.exit(1); }",
      "}, 25);",
      "",
    ].join("\n"));
    return {
      root, environmentFilePath, composePath,
      captured: () => (fs.existsSync(capturePath) ? fs.readFileSync(capturePath, "utf8") : "")
        .split("\n").filter(Boolean)
        .map((line) => JSON.parse(line) as
          { script: string; argv: string[]; cwd: string; environmentFile: string }),
      backups: () => fs.readdirSync(root).filter((entry) => entry.includes(".backup-")),
    };
  }

  /** Everything §2.6 needs before the poll, for a host that is really going to be deployed to. */
  async function stageLongExecution(t: TestContext, options: { attestationExpiresInMs: number }) {
    counter += 1;
    const agentId = `agent-choreography-15-${counter}`;
    const orgId = new ObjectId();
    const serverId = new ObjectId();
    const now = new Date();
    await collections.organizations.insertOne({
      _id: orgId, orgId, name: "Choreography step 15", slug: `choreography-15-${counter}-${process.pid}`,
      createdAt: now, updatedAt: now,
    } as never);
    await collections.servers.insertOne({
      _id: serverId, orgId, name: "target", hostname: "target-step15.test",
      agentId, agentSecretHash: agentSigningKey(AGENT_SECRET), credentialVersion: 1,
      keyProtocolVersion: "agent-v2", migrationState: "dual", legacyCredentialUsable: true,
      status: "online", createdAt: now, updatedAt: now,
    } as never);

    const store = new InMemoryReviewGateStore();
    const scope = [{ orgId: orgId.toHexString(), serverId: serverId.toHexString() }];
    const cast = await castOf([
      { principalId: "owner", roles: ["owner"] },
      { principalId: "claude", roles: ["author"] },
      { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
      { principalId: "binder-1", roles: ["binder"], targetScopes: scope },
      { principalId: agentId, roles: ["executor"], targetScopes: scope },
    ], store);
    await releaseCandidate(store, "c1", binding());

    // THE ONLY DIFFERENCE FROM STEP 10's GATE is the initial execution window. Store, routes, service
    // and policy are the same object graph `main()` builds.
    const gateServer = buildApp(store, { initialExecutionMs: GATE_INITIAL_WINDOW_MS }).listen(0);
    await new Promise((resolve) => gateServer.once("listening", resolve));
    const gateUrl = `http://127.0.0.1:${(gateServer.address() as AddressInfo).port}`;

    const host = deploymentHost();

    // THE EXECUTOR'S PATH TO THE GATE, recorded. The binder and the owner below still talk to the gate
    // directly; only the executor goes through the proxy, because it is the executor's conversation --
    // acquire, extend, redeem -- that the two cases need to read.
    //
    // The release file is written on the FIRST extension exchange, granted or refused, and carries the
    // instant the effect may finish: half a second past the deadline ACQUIRE issued, which the proxy
    // takes from the acquire response rather than recomputing. That is what turns the overrun from a
    // race into a construction — the effect cannot end until the gate has decided the extension, and
    // then cannot end before the original deadline has passed.
    let acquiredDeadline: string | undefined;
    let released = false;
    const proxy = recordingGateProxy(gateUrl, (exchange) => {
      if (exchange.path.endsWith("/acquire") && exchange.status === 200) {
        acquiredDeadline = exchange.executionDeadline;
      }
      if (exchange.path.endsWith("/extend-execution") && !released && acquiredDeadline) {
        released = true;
        fs.writeFileSync(path.join(host.root, "release-at"),
          String(Date.parse(acquiredDeadline) + OVERRUN_MS));
      }
    });
    proxy.server.listen(0);
    await new Promise((resolve) => proxy.server.once("listening", resolve));
    const executorGateUrl = `http://127.0.0.1:${(proxy.server.address() as AddressInfo).port}`;

    const previousPath = process.env.PATH;
    // Nothing else on it. A real `docker` further down PATH would otherwise win on a developer machine
    // that has one — and would then really deploy something.
    process.env.PATH = STUB_BIN;
    t.after(async () => {
      process.env.PATH = previousPath;
      proxy.server.closeAllConnections();
      await new Promise((resolve) => { proxy.server.close(resolve); });
      gateServer.closeAllConnections();
      await new Promise((resolve) => { gateServer.close(resolve); });
      fs.rmSync(host.root, { recursive: true, force: true });
    });

    const minted = await gate(gateUrl, cast.credentialFor("owner"), "/candidates/c1/owner-decision", {
      attestations: [{
        kind: "configuration.apply", orgId: orgId.toHexString(), serverId: serverId.toHexString(),
        audiencePrincipalId: agentId, bindingPrincipalId: "binder-1",
        expiresAt: new Date(Date.now() + options.attestationExpiresInMs).toISOString(),
      }],
    }, { "idempotency-key": `mint-${agentId}` });
    assert.equal(minted.status, 200, JSON.stringify(minted));
    const attestationId = (minted.body as unknown as { attestationIds: string[] }).attestationIds[0];

    const reserved = await gate(gateUrl, cast.credentialFor("binder-1"),
      `/attestations/${attestationId}/reserve`, { leaseSeconds: 900 });
    assert.equal(reserved.status, 200, JSON.stringify(reserved));
    const leaseId = (reserved.body as unknown as { leaseId: string }).leaseId;

    // Parsed before anything is bound or signed, for the key-order reason set out at length above.
    const core = taskPayloadSchema.parse({
      projects: [], httpHealthChecks: [], mongoChecks: [],
      configurationDeployment: deployment({
        reviewAuthorization: { attestationId, leaseId },
        repositoryRoot: host.root,
        environmentFilePath: host.environmentFilePath,
        composePath: host.composePath,
        // A PUBLIC IP LITERAL, and both halves of that matter. `net.isIP` short-circuits before any
        // DNS, so validation costs nothing and depends on no resolver; and it is a routable-looking
        // address, so the SSRF guard passes it instead of refusing the deployment outright the way it
        // refuses the `localhost` check the other cases use. Nothing ever connects to it: activation
        // fails at the stub, so neither the deployment nor the rollback reaches a health probe.
        healthChecks: [{ id: "web", url: "http://203.0.113.10:8080/health", timeoutMs: 100 }],
        // The values the mutations reference, sealed to THIS agent's signing key.
        encryptedValues: encryptValues(SECRET_VALUES, agentSigningKey(AGENT_SECRET)),
        expectedConfigurationDigest: configurationDigest(ORIGINAL_ENV),
      }),
    });
    const configurationDeployment = core.configurationDeployment;
    const bound = await gate(gateUrl, cast.credentialFor("binder-1"),
      `/attestations/${attestationId}/bind`, { leaseId, payload: configurationDeployment });
    assert.equal(bound.status, 200, JSON.stringify(bound));

    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const nonce = `owner-nonce-${agentId}`;
    const payload = {
      ...core,
      ownerAuthorization: {
        signature: signOwnerAuthorization(owner.signingPrivateKey, {
          taskType: "configuration.apply", orgId: orgId.toHexString(), serverId: serverId.toHexString(),
          actionDigest: privilegedActionDigest(core), expiresAt, nonce, keyVersion: "owner-v1",
        }),
        issuedAt: new Date().toISOString(), expiresAt, nonce, keyVersion: "owner-v1",
      },
    };
    const task = await createTask({
      orgId, server: { _id: serverId, orgId, agentId } as never,
      type: "configuration.apply", payload: payload as never, idempotencyKey: `step15-${agentId}`,
    });

    fs.rmSync(PROCESS_STATE_DIR, { recursive: true, force: true });
    writeEnforcement(PROCESS_STATE_DIR, { state: "ENFORCING", by: "owner", reason: "step 15" });
    assert.equal(stateDir(), PROCESS_STATE_DIR,
      "the agent must derive the same state directory this test wrote to");
    assert.equal(readEnforcement(stateDir()).state, "ENFORCING",
      "this executor must actually be enforcing before the poll means anything");
    security.setTarget({ orgId: orgId.toHexString(), serverId: serverId.toHexString() });
    saveConfig(agentConfigSchema.parse({
      orgId: orgId.toHexString(), serverId: serverId.toHexString(),
      controlCenterUrl: apiUrl,
      agentId, agentSecret: AGENT_SECRET, keyProtocolVersion: "agent-v2",
      controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey,
      // THE PROXY, not the gate. Same conversation, recorded.
      reviewGate: { url: executorGateUrl, credential: cast.credentialFor(agentId), timeoutMs: 30_000 },
    }));

    return { agentId, orgId, store, attestationId, host, task, configurationDeployment, proxy };
  }

  test("§B step 15: an execution that OUTLIVES its initial window is extended, and only then redeems",
    async (t) => {
      const staged = await stageLongExecution(t, { attestationExpiresInMs: 3600_000 });

      const pollError = await pollOnce().then(() => null, (error: Error) => error.message);

      const record = await staged.store.loadAttestation(staged.attestationId);
      const storedTask = await collections.agentTasks.findOne({ _id: staged.task._id });
      const journal = new ExecutionJournal(path.join(PROCESS_STATE_DIR, "execution-journal")).list();
      const diagnostic = JSON.stringify({
        pollError, attestationState: record?.state,
        acquiredAt: record?.acquiredAt, consumedAt: record?.consumedAt,
        executionDeadline: record?.executionDeadline,
        capturedCommands: staged.host.captured().length,
        journal: journal.map((entry) => ({ outcome: entry.outcome, phase: entry.terminalPhase })),
        taskState: storedTask?.state, resultSummary: storedTask?.resultSummary,
      });

      // ── THE EFFECT WAS REAL, AND TOOK REAL TIME ───────────────────────────────────────────────
      //
      // Asserted first, because every timing claim below is worthless if the deployment died at a
      // validation step the way it used to. The stub recorded the environment file as it stood at each
      // activation: the rotated secret at the first, the original text at the rollback.
      const captured = staged.host.captured();
      assert.equal(captured.length, 2,
        `activation and rollback activation, both through execFixed. ${diagnostic}`);
      // The exact command the executor's own builder produced, not a paraphrase of it.
      assert.equal(captured[0].script, "compose", "invoked as `docker compose ...`");
      assert.deepEqual(captured[0].argv, [
        "-f", staged.host.composePath, "-p", "app", "up", "-d", "--no-deps", "--force-recreate", "web",
      ], "and with the activation arguments configurationDeployment.ts builds");
      assert.equal(captured[0].cwd, fs.realpathSync(staged.host.root),
        "run in the deployment's own repository root, which is what execFixed passes as cwd");
      assert.deepEqual(captured[1].argv, captured[0].argv,
        "the rollback re-runs the same activation, which is why the second capture exists");
      assert.match(captured[0].environmentFile, /DATABASE_URL=postgres:\/\/rotated/,
        "the deployment had really written the rotated secret before activation");
      assert.match(captured[0].environmentFile, /FEATURE_X=true/);
      assert.equal(captured[1].environmentFile, ORIGINAL_ENV,
        "and had really restored the original before the rollback activation");
      assert.equal(fs.readFileSync(staged.host.environmentFilePath, "utf8"), ORIGINAL_ENV,
        "the host is left as it was found");
      assert.equal(staged.host.backups().length, 1, "with exactly one backup kept");

      // ── THE GATE SETTLED IT ───────────────────────────────────────────────────────────────────
      assert.equal(record?.state, "CONSUMED", `expected a settled attestation. ${diagnostic}`);

      const acquiredAt = Date.parse(record!.acquiredAt!);
      const consumedAt = Date.parse(record!.consumedAt!);
      const finalDeadline = Date.parse(record!.executionDeadline!);

      // ── STEP 15 ITSELF, IN TWO HALVES ─────────────────────────────────────────────────────────
      //
      // FIRST: an extension actually moved the deadline. Acquire clamps to `now + initialExecutionMs`,
      // so the window this attempt was granted was GATE_INITIAL_WINDOW_MS. Nothing but a granted
      // extension can put a deadline a quarter of an hour out on that record.
      assert.ok(finalDeadline - acquiredAt > 10 * 60_000,
        `the deadline must have been extended far beyond the ${GATE_INITIAL_WINDOW_MS} ms acquire ` +
        `granted, and stood at ${finalDeadline - acquiredAt} ms. ${diagnostic}`);
      // ...and by ONE extension of the keeper's 15-minute increment, not a run of them: after a grant
      // the keeper reschedules ten minutes out, so nothing asks again inside this effect.
      assert.ok(finalDeadline - acquiredAt < 20 * 60_000,
        `a single 15-minute extension, not a run of them: ${finalDeadline - acquiredAt} ms`);
      assert.ok(finalDeadline - acquiredAt <= 30 * 60_000,
        "and never past the absolute cumulative cap");

      // ...and the gate SAID SO, on the executor's own connection. The store shows a deadline that
      // moved; this shows the request that moved it, answered 200 on the `/extend` route, carrying the
      // attempt token from memory. Without it the deadline could in principle have been moved by
      // something other than the keeper.
      const extension = staged.proxy.first("/extend-execution");
      assert.ok(extension, `the keeper must have asked for an extension. ${diagnostic}`);
      assert.equal(extension?.status, 200,
        `and the gate must have granted it: ${JSON.stringify(extension)}. ${diagnostic}`);
      assert.equal(extension?.executionDeadline, record!.executionDeadline,
        "and the deadline on the record is the one the gate returned, not one this executor chose");
      assert.equal(staged.proxy.first("/redeem")?.status, 200,
        `and redeem succeeded rather than being refused. ${diagnostic}`);

      // SECOND, AND THIS IS WHAT MAKES IT LOAD-BEARING: the execution genuinely outran the window it
      // was given. Redeem refuses `execution_deadline_passed` once the deadline has gone by, so
      // without the extension this redeem would have been refused and the attestation left EXECUTING
      // — which is precisely what the companion case below demonstrates.
      assert.ok(consumedAt - acquiredAt > GATE_INITIAL_WINDOW_MS,
        `the execution must outrun the ${GATE_INITIAL_WINDOW_MS} ms initial window, and took ` +
        `${consumedAt - acquiredAt} ms. ${diagnostic}`);

      // ── AND THE REST OF THE SEQUENCE STILL HOLDS ──────────────────────────────────────────────
      assert.equal(journal.length, 1, "exactly one durable attempt on this host");
      assert.equal(journal[0].attestationId, staged.attestationId);
      assert.equal(journal[0].actionDigest, privilegedActionDigest(staged.configurationDeployment));
      assert.ok(journal[0].finishedAt, "settled, not left dangling");
      assert.ok(storedTask?.claimedAt, "the control plane records that the agent claimed it by polling");
      assert.ok(["failed", "running", "succeeded"].includes(String(storedTask?.state)),
        `the control plane recorded an outcome, not a queued task: ${storedTask?.state}`);

      // The extension carries the attempt token, and it is still never written down.
      const journalDir = path.join(PROCESS_STATE_DIR, "execution-journal");
      const journalText = fs.readdirSync(journalDir)
        .map((entry) => fs.readFileSync(path.join(journalDir, entry), "utf8")).join("|");
      assert.ok(!/attemptToken/i.test(journalText), "the attempt token must not be journalled");
    });

  test("§B step 15 (control): with extension impossible, the same overrun is REFUSED at redeem",
    async (t) => {
      // THE OTHER HALF OF THE CLAIM. The case above shows an extension happening, which on its own is
      // also consistent with redeem not caring about the deadline at all. This one holds the execution
      // and the window fixed and removes only the extension, by minting an attestation that expires in
      // two minutes: an extension's absolute bound is `min(acquiredAt + MAX_EXECUTION_MS, expiresAt)`,
      // so the keeper's request for `now + 15 min` is refused `beyond_absolute_deadline` and the
      // deadline never moves. Two minutes and not twenty seconds so that the margin over the effect is
      // the same order as the one above -- the attestation must not expire underneath a slow runner, or
      // this case would refuse for the wrong reason and still look like it passed.
      //
      // That is the collapse an earlier review round found when the two windows were equal, reproduced
      // on purpose: a short-lived attestation makes extension IMPOSSIBLE rather than quick, which is
      // why shortening `expiresAt` was never a way to test step 15.
      const staged = await stageLongExecution(t, { attestationExpiresInMs: 120_000 });

      const pollError = await pollOnce().then(() => null, (error: Error) => error.message);

      const record = await staged.store.loadAttestation(staged.attestationId);
      const journal = new ExecutionJournal(path.join(PROCESS_STATE_DIR, "execution-journal")).list();
      const diagnostic = JSON.stringify({
        pollError, state: record?.state, acquiredAt: record?.acquiredAt,
        executionDeadline: record?.executionDeadline, consumedAt: record?.consumedAt,
        expiresAt: record?.expiresAt, now: new Date().toISOString(),
        captured: staged.host.captured().length,
      });

      // The same real effect ran, and outran the same window.
      assert.equal(staged.host.captured().length, 2, `the effect ran. ${diagnostic}`);

      const acquiredAt = Date.parse(record!.acquiredAt!);
      const deadline = Date.parse(record!.executionDeadline!);
      assert.equal(deadline - acquiredAt, GATE_INITIAL_WINDOW_MS,
        `the deadline must be exactly what acquire granted — no extension. ${diagnostic}`);

      // AND REDEEM REFUSED IT. Not CONSUMED: the work outlived its authorization, so the record stays
      // EXECUTING and becomes the reconciliation signal the gate is built around. `settle` swallows the
      // refusal deliberately — it must not replace a real execution error with a bookkeeping one — so
      // the attestation state IS the report.
      assert.equal(record?.state, "EXECUTING",
        `an overrun with no extension must not settle as CONSUMED. ${diagnostic}`);
      assert.equal(record?.consumedAt, undefined, "and must not be recorded as consumed");

      // FOR THE RIGHT REASON, READ FROM THE GATE'S OWN ANSWER rather than argued from the state.
      //
      // `settle` swallows the redeem refusal deliberately -- it must not replace a real execution error
      // with a bookkeeping one -- so the attestation state is all the store can tell this test, and
      // EXECUTING is equally what a redeem refused `attestation_expired`, `wrong_audience`,
      // `attempt_token_invalid`, `credential_rotated`, `claim_not_authorizable` or
      // `execution_deadline_missing` would leave behind. An earlier version of this case asserted the
      // state plus "the attestation is still valid" and claimed that made the execution deadline the
      // only possible cause. An independent review correctly called that an overclaim: it excludes
      // expiry, and nothing else on that list.
      //
      // The proxy in front of the executor recorded the answer, so there is nothing left to infer.
      const refusedExtension = staged.proxy.first("/extend-execution");
      assert.ok(refusedExtension, `the keeper must have ASKED for an extension. ${diagnostic}`);
      assert.equal(refusedExtension?.code, "beyond_absolute_deadline",
        `and been refused for the reason this case constructs. ${diagnostic}`);
      const refusedRedeem = staged.proxy.first("/redeem");
      assert.ok(refusedRedeem, `and redeem must have been attempted. ${diagnostic}`);
      assert.equal(refusedRedeem?.code, "execution_deadline_passed",
        `and refused on the DEADLINE specifically, not on expiry or identity. ${diagnostic}`);
      // Which is only meaningful because the record was still inside its own validity when it happened.
      assert.ok(Date.now() < Date.parse(record!.expiresAt),
        `the attestation must not have expired underneath this case. ${diagnostic}`);

      // The host still recorded its own attempt, which is what a reconciliation reads.
      assert.equal(journal.length, 1, "the durable local claim survives the refused redeem");
      assert.ok(journal[0].finishedAt, "and records how the effect ended");
    });
}
