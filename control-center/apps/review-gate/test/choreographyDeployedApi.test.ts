import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
// STILL NOT COVERED HERE: step 15. Driving a real extension needs an effect that outlives its window,
// and the initial window is min(now + 10 min, expiresAt). A test cannot spend ten minutes in a
// deployment that fails in milliseconds. Extension is covered where it can be measured — through the
// real service in `attestationService.test.ts`, and through the real client and keeper in the agent
// suite.
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
  const { pollOnce } = await import("../../agent/src/agent.js");
  const { writeEnforcement, readEnforcement } = await import("../../agent/src/reviewEnforcement.js");
  const { saveConfig, agentConfigSchema, stateDir } = await import("../../agent/src/config.js");
  const { ExecutionJournal } = await import("../../agent/src/executionJournal.js");

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
    saveConfig(agentConfigSchema.parse({
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
    saveConfig(agentConfigSchema.parse({
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
}
