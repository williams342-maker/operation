import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { generateAgentKeyPairs, signTaskEnvelopeV2, payloadDigest, signOwnerAuthorization, privilegedActionDigest } from "@control-center/shared";
import { buildApp } from "../src/server.js";
import { AttestationService } from "../src/attestationService.js";
import { contentDigest, candidateDigest, type CandidateBinding } from "../src/policy.js";
import type { CandidateRecord } from "../src/store.js";
import type { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { castOf, type Person } from "./principals.js";
import { configurationChangeDigest } from "@control-center/shared";

// THE EFFECT POINT, driven through `executeTask` itself.
//
// The previous round of this candidate got a NO-GO here, twice over, and both defects shared one shape:
// every test exercised a HELPER with arguments the test chose, so the tests agreed with my description of
// the wiring instead of measuring the wiring.
//
//   - enforcement arrived at `executeTask` as an optional argument that defaulted to advisory, so any
//     caller that omitted it bypassed the gate on an ENFORCING host. Tests passed it explicitly, always.
//   - `acquireForEffect` was handed the TASK payload while the gate binds and validates the DEPLOYMENT
//     sub-payload, so an activated executor would have refused every privileged task in production. The
//     contract test passed because I fed it the gate's payload shape rather than the agent's.
//
// So this file calls `executeTask(config, task)` — the real exported function, with the real two-argument
// signature, a real task envelope, a real owner signature, a real gate on a socket, and a durable
// ENFORCING record on disk. Nothing about enforcement is passed in; it has to be found.

// THE PROCESS'S state directory, established BEFORE the agent module loads.
//
// `configPath` in the agent's config module is a constant resolved once at import from this variable, and
// the enforcement record's location is derived from it. That is the round-2 fix: the location is a
// property of the process, so no argument to `executeTask` can point it somewhere else. Setting it here
// is therefore the only way a test can activate this executor — which is exactly the property under test.
process.env.NODE_ENV = "test";
const PROCESS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "effect-point-home-"));
process.env.CONTROL_CENTER_AGENT_CONFIG = path.join(PROCESS_HOME, "agent.json");
const PROCESS_STATE_DIR = path.join(PROCESS_HOME, "agent-state");

// EVERY agent import is dynamic, and that is load-bearing rather than stylistic: a static import is
// hoisted above the assignment above it, so the agent config module would resolve its path before this
// test could set it — and the executor would look for its record somewhere else entirely.
const { executeTask } = await import("../../agent/src/agent.js");
const { writeEnforcement } = await import("../../agent/src/reviewEnforcement.js");
const { agentConfigSchema } = await import("../../agent/src/config.js");
const { ExecutionJournal } = await import("../../agent/src/executionJournal.js");

const oid = (c: string) => c.repeat(40).slice(0, 40);
const dig = (c: string) => c.repeat(64).slice(0, 64);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "effect-point-"));

const PEOPLE: Person[] = [
  { principalId: "owner", roles: ["owner"] },
  { principalId: "claude", roles: ["author"] },
  { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
  { principalId: "agent-1", roles: ["executor"], audienceFor: [{ orgId: "org-1", serverId: "server-1" }] },
  { principalId: "binder-1", roles: ["binder"], audienceFor: [{ orgId: "org-1", serverId: "server-1" }] },
];

const MUTATIONS = [
  { name: "DATABASE_URL", operation: "update" as const, secret: true, versionId: "v-000000000001", valueRef: "ref-1" },
  { name: "FEATURE_X", operation: "enable" as const, secret: false, versionId: "v-000000000002", valueRef: "ref-2" },
];

const binding = (): CandidateBinding => ({
  subject: { kind: "configuration.change", changeDigest: configurationChangeDigest(MUTATIONS), environmentId: "env-000000000001", targetProfileId: "profile-00000001", targetProfileRevision: 3 },
  projectId: "crafters-market", repository: "williams342-maker/operation", baseBranch: "main",
  baseCommit: oid("a"), candidateCommit: oid("b"), candidateTree: oid("c"), patchDigest: dig("1"),
  artifactDigest: dig("3"), manifestDigest: dig("4"), dependencyLockDigests: [], testPlanVersion: "tp-1",
  testResultDigest: dig("2"), targetEnvironmentClass: "staging", authorIdentity: "claude",
  requestedReviewerClass: "independent", authorityRef: "OWNER-2026-09-02",
  createdAt: "2026-09-02T00:00:00.000Z", occurrenceId: "occ-seed",
} as CandidateBinding);

/** The DEPLOYMENT payload — what the gate validates and binds. It nests inside the task payload. */
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
function valueOf<T>(result: { ok: boolean; value?: unknown; code?: string }): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value as T;
}

async function atGo(store: InMemoryReviewGateStore, id: string, b: CandidateBinding) {
  await store.registerCandidate({
    acting: { principalId: "claude", credentialEpoch: 1 },
    record: { candidateId: id, digest: candidateDigest(b), contentDigest: contentDigest(b), binding: b,
      state: "BUILT", participants: [{ identity: b.authorIdentity, role: "author", at: "2026-09-02T00:00:00.000Z" }],
      occurrences: [], verdicts: [] } as CandidateRecord,
    idempotency: idem("claude"),
  });
  const at = "2026-09-02T01:00:00.000Z";
  for (const action of ["submit-tests", "freeze", "request-review", "claim-review"] as const) {
    const moved = await store.applyAction({
      acting: { principalId: action === "claim-review" ? "codex" : "claude", credentialEpoch: 1 },
      candidateId: id, action, billingClass: "INTERNAL_QA_TEST", at, occurrenceId: `w-${action}`,
      idempotency: idem("claude"),
    });
    assert.equal(moved.applied, true, `${action}: ${JSON.stringify(moved)}`);
  }
  const go = await store.applyVerdict({
    acting: { principalId: "codex", credentialEpoch: 1 },
    candidateId: id, expectedState: "REVIEW_IN_PROGRESS", nextState: "GO",
    occurrence: { occurrenceId: "w-GO", from: "REVIEW_IN_PROGRESS", to: "GO", actorIdentity: "codex", billingClass: "INTERNAL_REVIEW", at },
    verdict: { verdictId: "v1", reviewerIdentity: "codex", verdict: "GO", findings: [], resolves: [], submittedAt: at, at },
    addParticipant: { identity: "codex", role: "reviewer", at },
    idempotency: idem("codex"),
  });
  assert.equal(go.applied, true, JSON.stringify(go));
}

const cp = generateAgentKeyPairs();
const owner = generateAgentKeyPairs();

/**
 * Everything an executor meets at dispatch: a gate holding a bound attestation, a stub control-center to
 * acknowledge to, a durable enforcement record, and a signed task carrying the reviewed deployment.
 */
async function estate(options: { enforcing: boolean } = { enforcing: true }) {
  const cast = await castOf(PEOPLE);
  const store = cast.store;
  let ids = 0;
  const svc = new AttestationService(store, { clock: () => new Date().toISOString(), ids: () => `att-${ids++}` });

  await atGo(store, "c1", binding());
  const decision = await svc.recordOwnerDecision(cast.who("owner"), {
    candidateId: "c1", idempotencyKey: "k",
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-1", audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: new Date(Date.now() + 3600_000).toISOString() }],
  });
  const [attestationId] = valueOf<{ attestationIds: string[] }>(decision).attestationIds;
  const { leaseId } = valueOf<{ leaseId: string }>(await svc.reserve(cast.who("binder-1"), { attestationId, leaseSeconds: 600 }));
  const configurationDeployment = deployment({ reviewAuthorization: { attestationId, leaseId } });
  assert.equal((await svc.bind(cast.who("binder-1"), { attestationId, leaseId, payload: configurationDeployment })).ok, true);

  const gateServer = buildApp(store).listen(0);
  await new Promise((resolve) => gateServer.once("listening", resolve));
  const gateUrl = `http://127.0.0.1:${(gateServer.address() as AddressInfo).port}`;

  // A stub control-center that accepts acknowledgements and records them.
  const acks: { event: string; message?: string }[] = [];
  const ccServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (body) acks.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  }).listen(0);
  await new Promise((resolve) => ccServer.once("listening", resolve));

  // One record, at the location the PROCESS derives. Toggled per test rather than relocated, because
  // relocating it is precisely the bypass round 2 found.
  fs.rmSync(PROCESS_STATE_DIR, { recursive: true, force: true });
  writeEnforcement(PROCESS_STATE_DIR, {
    state: options.enforcing ? "ENFORCING" : "DISABLED",
    by: "owner",
    reason: options.enforcing ? "test activation" : "test deactivation",
  });

  // NOTE: no state directory here. There is no such field any more.
  const config = agentConfigSchema.parse({
    controlCenterUrl: `http://127.0.0.1:${(ccServer.address() as AddressInfo).port}`,
    agentId: "agent-1", agentSecret: "a".repeat(64), keyProtocolVersion: "agent-v2",
    controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey,
    reviewGate: { url: gateUrl, credential: cast.credentialFor("agent-1"), timeoutMs: 5000 },
  });

  return {
    store, attestationId, leaseId, configurationDeployment, config, acks,
    stateDir: PROCESS_STATE_DIR,
    journal: new ExecutionJournal(path.join(PROCESS_STATE_DIR, "execution-journal")),
    state: async () => (await store.loadAttestation(attestationId))!.state,
    close: async () => {
      await new Promise((resolve) => gateServer.close(resolve));
      await new Promise((resolve) => ccServer.close(resolve));
    },
  };
}

/**
 * Run the executor and swallow only the DEPLOYMENT's failure.
 *
 * The effect cannot succeed here: there is no docker on a test machine, and the fixture's health-check URL
 * is refused by the agent's own SSRF guard. That is downstream of everything these tests measure — the
 * point is that acquisition happened BEFORE the effect was attempted, and that settlement happened
 * whatever the effect did. An error from acquisition itself would show up as an unacquired attestation,
 * which every assertion below checks explicitly.
 */
async function runExecutor(config: unknown, claimed: unknown): Promise<string | null> {
  try {
    await executeTask(config as never, claimed as never);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/** A real signed task carrying the deployment the gate bound. */
let nonceCounter = 0;
function task(configurationDeployment: unknown, taskId = "task-1") {
  const core = { projects: [], httpHealthChecks: [], mongoChecks: [], configurationDeployment };
  const nonce = "owner-nonce-1"; const keyVersion = "owner-v1";
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const signature = signOwnerAuthorization(owner.signingPrivateKey, {
    taskType: "configuration.apply", orgId: "org-1", serverId: "server-1",
    actionDigest: privilegedActionDigest(core), expiresAt, nonce, keyVersion,
  });
  const payload = { ...core, ownerAuthorization: { signature, issuedAt: new Date().toISOString(), expiresAt, nonce, keyVersion } };
  const unsigned = {
    protocolVersion: "task-v1" as const, taskId, taskType: "configuration.apply" as const,
    orgId: "org-1", serverId: "server-1", agentId: "agent-1", issuedAt: new Date().toISOString(),
    expiresAt, nonce: `envelope-nonce-${nonceCounter++}-padding`, payloadDigest: payloadDigest(payload),
    signingKeyVersion: "cp-ed25519-v1",
  };
  return { envelope: { ...unsigned, signature: signTaskEnvelopeV2(cp.signingPrivateKey, unsigned) }, payload };
}

test("executeTask finds enforcement itself — there is no argument to omit", async (t) => {
  const world = await estate({ enforcing: true });
  t.after(() => world.close());

  // TWO ARGUMENTS. The previous shape took a third that defaulted to advisory, so this exact call
  // bypassed the gate on an ENFORCING host. It must now acquire.
  await runExecutor(world.config, task(world.configurationDeployment));

  assert.equal(await world.state(), "CONSUMED",
    "an enforcing executor must acquire and redeem, without being told to");
  const entries = world.journal.list();
  assert.equal(entries.length, 1, "the host recorded its own durable claim");
  assert.equal(entries[0].attestationId, world.attestationId);
  // Settled, not left dangling — the effect failed and the journal says so rather than staying STARTED.
  assert.equal(entries[0].outcome, "FAILED");
  assert.ok(entries[0].finishedAt);
});

test("the digest the executor sends is the one the gate bound — the sub-payload, not the task payload", async (t) => {
  const world = await estate({ enforcing: true });
  t.after(() => world.close());
  await runExecutor(world.config, task(world.configurationDeployment));

  // The task payload wraps the deployment and their digests differ. Sending the wrapper's digest would
  // refuse every privileged task in production while every unit test still passed.
  const bound = privilegedActionDigest(world.configurationDeployment);
  const wrapper = privilegedActionDigest({ projects: [], httpHealthChecks: [], mongoChecks: [], configurationDeployment: world.configurationDeployment });
  assert.notEqual(bound, wrapper, "the two scopes must actually differ, or this test proves nothing");
  assert.equal(world.journal.list()[0].actionDigest, bound);
});

test("an ENFORCING executor refuses a task the gate has not authorized, and applies nothing", async (t) => {
  const world = await estate({ enforcing: true });
  t.after(() => world.close());

  // The same deployment with one field changed after review: a different action than the one bound.
  const tampered = { ...world.configurationDeployment, composeProject: "somewhere-else" };
  await runExecutor(world.config, task(tampered, "task-2"));

  assert.equal(await world.state(), "RESERVED_BOUND", "the attestation must be untouched");
  assert.equal(world.journal.list().length, 0, "nothing was claimed on this host");
  const failure = world.acks.find((ack) => ack.event === "failed");
  assert.ok(failure, `expected a failed acknowledgement, got ${JSON.stringify(world.acks)}`);
  assert.match(String(failure.message), /Review gate refused execution/);
});

test("an ENFORCING executor with an unreachable gate deploys nothing", async (t) => {
  const world = await estate({ enforcing: true });
  t.after(() => world.close());
  // Point at a port nothing is listening on. Fail closed means the deployment stops, not that it proceeds.
  const config = { ...world.config, reviewGate: { ...world.config.reviewGate!, url: "http://127.0.0.1:1", timeoutMs: 300 } };
  await runExecutor(config, task(world.configurationDeployment));

  assert.equal(await world.state(), "RESERVED_BOUND");
  assert.equal(world.journal.list().length, 0);
  assert.ok(world.acks.some((ack) => ack.event === "failed"));
});

test("a config naming a different state directory cannot downgrade enforcement", async (t) => {
  const world = await estate({ enforcing: true });
  t.after(() => world.close());

  // ROUND 2's DEFECT, as a test. The executor's real record says ENFORCING. This caller hands over a
  // config that names an empty directory instead — the previous version read the location from exactly
  // there and reported itself advisory, applying the task with no gate involvement at all.
  const elsewhere = tmp();
  const doctored = { ...world.config, stateDir: elsewhere } as typeof world.config;
  await runExecutor(doctored, task(world.configurationDeployment));

  assert.equal(await world.state(), "CONSUMED", "enforcement must have applied regardless of the config");
  assert.equal(world.journal.list().length, 1, "the claim was written to the PROCESS's journal");
  assert.equal(fs.existsSync(path.join(elsewhere, "execution-journal")), false,
    "nothing was written where the caller pointed");
});

test("a DISABLED executor is unchanged — the gate is never consulted", async (t) => {
  const world = await estate({ enforcing: false });
  t.after(() => world.close());
  // No review reference is needed and no acquisition happens: exactly today's behaviour. The deployment
  // itself then fails on this machine, which is the point — it got past the gate because there is none.
  await runExecutor(world.config, task(world.configurationDeployment));

  assert.equal(await world.state(), "RESERVED_BOUND", "a disabled executor must not touch the attestation");
  assert.equal(world.journal.list().length, 0);
});

test("a second delivery of the same task cannot acquire twice", async (t) => {
  const world = await estate({ enforcing: true });
  t.after(() => world.close());
  await runExecutor(world.config, task(world.configurationDeployment));
  assert.equal(await world.state(), "CONSUMED");

  // Redelivered with a different taskId — same action, same attestation. The gate is CONSUMED and this
  // host's journal already holds the claim, so both winners refuse.
  await runExecutor(world.config, task(world.configurationDeployment, "task-redelivered"));
  assert.equal(world.journal.list().length, 1, "no second claim was taken");
  assert.ok(world.acks.filter((ack) => ack.event === "failed").length >= 1);
});
