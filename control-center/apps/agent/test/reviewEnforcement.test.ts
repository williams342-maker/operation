import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { generateAgentKeyPairs, signTaskEnvelopeV2, payloadDigest, signOwnerAuthorization, privilegedActionDigest, privilegedSubPayload, readReviewAuthorization, configurationDeploymentPayloadSchema } from "@control-center/shared";
import { agentConfigSchema } from "../src/config.js";
import { readEnforcement, writeEnforcement, resolveEnforcement } from "../src/reviewEnforcement.js";
import { ExecutionJournal } from "../src/executionJournal.js";
import { ReviewGateClient } from "../src/reviewGateClient.js";
import { acquireForEffect, keepExecutionAlive, recordEffect, type Acquired } from "../src/reviewEnforcedExecution.js";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = "test";
const { verifyTask } = await import("../src/agent.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "review-enforcement-"));

/**
 * Read a TypeScript SOURCE file, from wherever this test happens to be running.
 *
 * Structural assertions below are about the source, and this suite runs from two places: `test/` under
 * tsx, and `build-tests/test/` as compiled JavaScript — the latter so a sandbox that forbids child
 * processes can still execute it. A path relative to `import.meta.url` is correct in exactly one of those.
 */
function source(relative: string): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up++) {
    const candidate = path.join(dir, "src", relative);
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`cannot locate src/${relative} from ${import.meta.url}`);
}

function repositoryFile(relative: string): Buffer {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 8; up++) {
    const candidate = path.join(dir, relative);
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
    dir = path.dirname(dir);
  }
  throw new Error(`cannot locate ${relative} from ${import.meta.url}`);
}

const cp = generateAgentKeyPairs();
const owner = generateAgentKeyPairs();
const baseConfig = agentConfigSchema.parse({ controlCenterUrl: "https://cc.test", agentId: "agent-1", agentSecret: "unused-legacy-secret", keyProtocolVersion: "agent-v2", controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey });

/**
 * A fully valid layer-1 + layer-2 privileged task; layer 3 varies.
 *
 * WHERE THE REFERENCE GOES. Inside `configurationDeployment`, because that is where
 * `configurationDeploymentPayloadSchema` puts it — `taskPayloadSchema` is `.strict()` and has no such
 * field. An earlier version of this fixture put it at the top of the task payload, which made the tests
 * agree with a defect: the executor read it from there too, so nothing failed here while an activated
 * executor would have refused every privileged task in production. `wrongLevel` below pins that.
 */
function privilegedTask(
  review?: { attestationId: string; leaseId: string },
  ownerAuth: "valid" | "forged" = "valid",
  wrongLevel = false,
) {
  const deployment = review && !wrongLevel
    ? { planId: "plan-1", reviewAuthorization: review }
    : { planId: "plan-1" };
  const core = { projects: [], httpHealthChecks: [], mongoChecks: [], configurationDeployment: deployment };
  const payload = review && wrongLevel ? { ...core, reviewAuthorization: review } : core;
  const nonce = "owner-nonce-1"; const keyVersion = "owner-v1"; const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  // The owner signs the action digest, which EXCLUDES ownerAuthorization but includes reviewAuthorization.
  const signature = signOwnerAuthorization(ownerAuth === "forged" ? generateAgentKeyPairs().signingPrivateKey : owner.signingPrivateKey, { taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", actionDigest: privilegedActionDigest(payload), expiresAt, nonce, keyVersion });
  const signed = { ...payload, ownerAuthorization: { signature, issuedAt: new Date().toISOString(), expiresAt, nonce, keyVersion } };
  const unsigned = { protocolVersion: "task-v1" as const, taskId: "task-1", taskType: "configuration.apply" as const, orgId: "org-1", serverId: "server-1", agentId: "agent-1", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), nonce: "envelope-nonce", payloadDigest: payloadDigest(signed), signingKeyVersion: "cp-ed25519-v1" };
  return { envelope: { ...unsigned, signature: signTaskEnvelopeV2(cp.signingPrivateKey, unsigned) }, payload: signed };
}

const REVIEW = { attestationId: "att-1", leaseId: "lease-1" };

/**
 * A SCHEMA-VALID privileged sub-payload, which the direct `acquireForEffect` cases below now need.
 *
 * They used to pass `{ configurationDeployment: { planId: "plan-1" }, reviewAuthorization: REVIEW }`,
 * which is wrong twice over and was wrong before this fixture existed: it is a TASK-payload shape, and
 * `acquireForEffect` is documented to take the SUB-payload; and no schema would ever accept it, so an
 * acquisition that "succeeded" with it was asserting something that cannot happen — the deployment
 * would have been refused by `executeConfigurationDeployment` moments later.
 *
 * It matters now because `acquireForEffect` digests the PARSE, so that the gate and the executor agree
 * on key order without either trusting the other's serialization. A payload the schema refuses cannot
 * be canonicalised, and is refused before the gate is called.
 */
const subPayload = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "configuration-deployment-v1", action: "configuration.apply.v1",
  planId: "plan-00000000001", planRevision: 1, deploymentId: "deploy-000000001",
  environmentId: "env-000000000001", environmentKind: "staging", protected: false,
  targetProfileId: "profile-00000001", targetProfileRevision: 3, repositoryRoot: "/srv/app",
  environmentFilePath: "/srv/app/.env", composePath: "/srv/app/docker-compose.yml",
  composeProject: "app", statelessServices: ["web"], protectedServices: [],
  healthChecks: [{ id: "web", url: "https://health.example.test/healthz", timeoutMs: 1000 }],
  mutations: [{ name: "DATABASE_URL", versionId: "v-000000000001", secret: true,
    operation: "update" as const, valueRef: "ref-1" }],
  encryptedValues: { algorithm: "aes-256-gcm", ciphertext: "Y2lwaGVy", nonce: "bm9uY2U=",
    authTag: "dGFn", keyVersion: "agent-signing-v1" },
  expectedConfigurationDigest: "e".repeat(64), reviewAuthorization: REVIEW,
  automaticRollback: true, ...over,
});
/** The journal treats an action digest as a filename, so it insists on a real sha256 hex. */
const digestOf = (label: string) => crypto.createHash("sha256").update(label).digest("hex");

/** A gate that records what it was asked and answers however the test says. */
function fakeGate(answers: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; authorization: string; body: any }[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, authorization: String((init?.headers as any)?.authorization ?? ""), body: JSON.parse(String(init?.body ?? "{}")) });
    const key = url.includes("/acquire") ? "acquire" : "redeem";
    // A successful acquire MUST carry the attempt token: the client fails closed on a 200 without one,
    // because proceeding tokenless would mean acting on something the gate never issued.
    const fallback = key === "acquire"
      ? { status: 200, body: { ok: true, attemptToken: "attempt-token-fake", executionDeadline: "2026-09-02T04:00:00.000Z" } }
      : { status: 200, body: { ok: true } };
    const answer = answers[key] ?? fallback;
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { calls, client: (credential = "executor-own-credential") => new ReviewGateClient({ url: "https://gate.test", credential, timeoutMs: 1000 }, impl) };
}

// ── the durable enforcement state ──────────────────────────────────────────────────────────────────

test("an executor with no record is DISABLED, and activation is durable and audited", () => {
  const dir = tmp();
  assert.equal(readEnforcement(dir).state, "DISABLED");
  writeEnforcement(dir, { state: "ENFORCING", by: "owner", reason: "activated for staging" });
  assert.equal(readEnforcement(dir).state, "ENFORCING");
  // Deactivation is as loud as activation: the history keeps both, so turning enforcement off leaves a trace.
  writeEnforcement(dir, { state: "DISABLED", by: "owner", reason: "rolled back" });
  const record = readEnforcement(dir);
  assert.equal(record.state, "DISABLED");
  assert.deepEqual(record.history.map((h) => h.state), ["DISABLED", "ENFORCING", "DISABLED"]);
});

test("a CORRUPTED enforcement record throws — it is never read as DISABLED", () => {
  const dir = tmp();
  writeEnforcement(dir, { state: "ENFORCING", by: "owner", reason: "activated" });
  // If corrupting one file downgraded this executor to advisory, corrupting one file would be the bypass.
  fs.writeFileSync(path.join(dir, "review-enforcement.json"), '{"state":"ENFORCING"}');
  assert.throws(() => readEnforcement(dir), /unreadable/);
  fs.writeFileSync(path.join(dir, "review-enforcement.json"), "not json at all");
  assert.throws(() => readEnforcement(dir));
});

test("a record whose state CONTRADICTS its history throws", () => {
  const dir = tmp();
  writeEnforcement(dir, { state: "ENFORCING", by: "owner", reason: "activated" });
  // Semantically corrupt rather than syntactically corrupt: every field is well-formed and the newest
  // history entry says ENFORCING, but the top-level state — the only value that was ever read — says
  // DISABLED. An independent review found this passed the schema and resolved advisory, which is the
  // difference between "a corrupted record throws" as a description and as a mechanism.
  fs.writeFileSync(path.join(dir, "review-enforcement.json"), JSON.stringify({
    state: "DISABLED",
    history: [{ state: "ENFORCING", at: "2026-09-02T00:00:00.000Z", by: "owner", reason: "activated" }],
  }));
  assert.throws(() => readEnforcement(dir), /unreadable/);
  assert.throws(() => resolveEnforcement({ stateDir: dir, gate: { url: "https://gate.test", credential: "c" } }));

  // The other direction too: claiming ENFORCING over a history that ends DISABLED is equally inconsistent.
  fs.writeFileSync(path.join(dir, "review-enforcement.json"), JSON.stringify({
    state: "ENFORCING",
    history: [{ state: "DISABLED", at: "2026-09-02T00:00:00.000Z", by: "owner", reason: "rolled back" }],
  }));
  assert.throws(() => readEnforcement(dir), /unreadable/);
});

test("a plaintext gate URL is not usable configuration", () => {
  const dir = tmp();
  writeEnforcement(dir, { state: "ENFORCING", by: "owner", reason: "activated" });
  // The executor sends its bearer credential to this URL and treats a 200 as permission. Over http that
  // hands the credential to anyone on the path and accepts a spoofed positive answer, so the client's
  // fail-closed behaviour on transport errors buys nothing.
  for (const url of ["http://gate.internal", "http://10.0.0.5:8080", "http://gate.internal.corp/path"]) {
    assert.throws(() => resolveEnforcement({ stateDir: dir, gate: { url, credential: "c" } }), /refuses to start/);
  }
  assert.equal(resolveEnforcement({ stateDir: dir, gate: { url: "https://gate.internal", credential: "c" } }).enforcing, true);
  // Loopback is exempt because there "no TLS" means "no network" — and it is what the contract tests use.
  assert.equal(resolveEnforcement({ stateDir: dir, gate: { url: "http://127.0.0.1:4000", credential: "c" } }).enforcing, true);
  assert.equal(resolveEnforcement({ stateDir: dir, gate: { url: "http://localhost:4000", credential: "c" } }).enforcing, true);
});

test("an ENFORCING executor with no usable gate configuration REFUSES TO START", () => {
  const dir = tmp();
  writeEnforcement(dir, { state: "ENFORCING", by: "owner", reason: "activated" });
  assert.throws(() => resolveEnforcement({ stateDir: dir }), /refuses to start/);
  assert.throws(() => resolveEnforcement({ stateDir: dir, gate: { url: "https://gate.test" } }), /refuses to start/);
  // Losing the credential is losing the configuration; it must not read as "not enforcing".
  assert.throws(() => resolveEnforcement({ stateDir: dir, gate: { url: "https://gate.test", credential: "" } }), /refuses to start/);
  const ok = resolveEnforcement({ stateDir: dir, gate: { url: "https://gate.test", credential: "c" } });
  assert.equal(ok.enforcing, true);
});

test("a DISABLED executor resolves to advisory even with gate configuration present", () => {
  // Configuration alone must not activate enforcement; activation is the durable record's job.
  assert.equal(resolveEnforcement({ stateDir: tmp(), gate: { url: "https://gate.test", credential: "c" } }).enforcing, false);
});

// ── the per-host journal ───────────────────────────────────────────────────────────────────────────

test("the journal admits ONE attempt per action on this host, across restarts", () => {
  const dir = tmp();
  const claim = { actionDigest: digestOf("action-a"), attestationId: "att-1", leaseId: "lease-1", serverId: "server-1", at: new Date().toISOString() };
  assert.equal(new ExecutionJournal(dir).claim(claim).claimed, true);

  // A NEW journal object over the same directory is the restart case: the file, not memory, decides.
  const restarted = new ExecutionJournal(dir);
  const second = restarted.claim(claim);
  assert.equal(second.claimed, false);
  // Nothing recorded an outcome, so the previous attempt may have changed the host and died. Refusing is
  // the only honest answer; retrying would be a second application.
  assert.equal(second.claimed === false && second.reason, "in_flight_or_indeterminate");

  restarted.complete({ actionDigest: digestOf("action-a"), outcome: "SUCCEEDED", at: new Date().toISOString() });
  const third = new ExecutionJournal(dir).claim(claim);
  assert.equal(third.claimed === false && third.reason, "already_applied");

  // A different action is unaffected — the journal fences one action, not the executor.
  assert.equal(new ExecutionJournal(dir).claim({ ...claim, actionDigest: digestOf("action-b") }).claimed, true);
});

test("a FAILED attempt is still terminal — a failure is not a licence to try again", () => {
  const dir = tmp();
  const journal = new ExecutionJournal(dir);
  const claim = { actionDigest: digestOf("action-f"), attestationId: "att-1", leaseId: "lease-1", serverId: "server-1", at: new Date().toISOString() };
  journal.claim(claim);
  journal.complete({ actionDigest: digestOf("action-f"), outcome: "FAILED", error: "apply blew up", at: new Date().toISOString() });
  const again = new ExecutionJournal(dir).claim(claim);
  assert.equal(again.claimed === false && again.reason, "already_applied");
});

test("the journal refuses an action digest that is not a sha256 hex", () => {
  const journal = new ExecutionJournal(tmp());
  // The digest becomes a filename. A gate or control-center that could choose that filename could make
  // this executor claim, or overwrite, any file it likes.
  for (const bad of ["../../escape", "digest-a", "", "a".repeat(63), "A".repeat(64), "/etc/passwd"]) {
    assert.throws(() => journal.claim({ actionDigest: bad, attestationId: "a", leaseId: "l", serverId: "s", at: new Date().toISOString() }), /sha256/);
  }
});

// ── the gate client fails closed ───────────────────────────────────────────────────────────────────

test("the gate client fails closed on every unhappy answer", async () => {
  const cases: [string, { status: number; body: unknown }, RegExp][] = [
    ["a refusal", { status: 409, body: { ok: false, code: "attestation_not_reserved" } }, /attestation_not_reserved/],
    ["a server error", { status: 500, body: { ok: false } }, /gate_status_500/],
    ["a 200 that does not say ok", { status: 200, body: { result: "fine" } }, /gate_status_200/],
  ];
  for (const [name, answer, expected] of cases) {
    const gate = fakeGate({ acquire: answer });
    const outcome = await gate.client().acquire({ attestationId: "att-1", leaseId: "l", actionDigest: "d", orgId: "o", serverId: "s", kind: "configuration.apply", idempotencyKey: "idem-test" });
    assert.equal(outcome.ok, false, name);
    assert.match(outcome.ok === false ? outcome.code : "", expected, name);
  }
});

test("an unreachable or unreadable gate is a refusal, never a pass", async () => {
  const unreachable = new ReviewGateClient({ url: "https://gate.test", credential: "c", timeoutMs: 1000 }, async () => { throw new Error("ECONNREFUSED"); });
  const down = await unreachable.acquire({ attestationId: "a", leaseId: "l", actionDigest: "d", orgId: "o", serverId: "s", kind: "k", idempotencyKey: "idem-test" });
  assert.equal(down.ok === false && down.code, "gate_unreachable");

  const garbage = new ReviewGateClient({ url: "https://gate.test", credential: "c", timeoutMs: 1000 }, async () => new Response("<html>proxy error</html>", { status: 200 }));
  const unreadable = await garbage.acquire({ attestationId: "a", leaseId: "l", actionDigest: "d", orgId: "o", serverId: "s", kind: "k", idempotencyKey: "idem-test" });
  assert.equal(unreadable.ok === false && unreadable.code, "gate_unreadable");
});

test("a real HTTPS gate client cannot start without the owner-bound CA", () => {
  assert.throws(() => new ReviewGateClient({ url: "https://gate.test", credential: "c", timeoutMs: 1000 }), /owner-bound CA/);
});

test("the real HTTPS gate client uses only its supplied owner-bound CA", async () => {
  const certificate = repositoryFile("control-center/apps/agent/test/fixtures/review-gate-test-cert.pem");
  const key = repositoryFile("control-center/apps/agent/test/fixtures/review-gate-test-key.pem");
  const server = https.createServer({ cert: certificate, key }, (request, response) => {
    assert.equal(request.headers.authorization, "Bearer executor-only");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, attemptToken: "secret-attempt", executionDeadline: "2026-09-05T18:00:00.000Z" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    const client = new ReviewGateClient({ url: `https://127.0.0.1:${address.port}`, credential: "executor-only", timeoutMs: 1000 }, undefined, certificate);
    const outcome = await client.acquire({ attestationId: "a", leaseId: "l", actionDigest: digestOf("a"), orgId: "o", serverId: "s", kind: "k", idempotencyKey: "idem-tls" });
    assert.equal(outcome.ok, true, outcome.ok ? undefined : outcome.code);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("a gate that does not answer promptly is a gate that is unreachable", async () => {
  const hanging = new ReviewGateClient({ url: "https://gate.test", credential: "c", timeoutMs: 120 }, (_input, init) =>
    new Promise((_resolve, reject) => {
      // A gate that never answers must not hold a deployment open indefinitely, and must never be waited
      // out into a pass. The abort is the answer.
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
  const outcome = await hanging.acquire({ attestationId: "a", leaseId: "l", actionDigest: digestOf("a"), orgId: "o", serverId: "s", kind: "k", idempotencyKey: "idem-test" });
  assert.equal(outcome.ok === false && outcome.code, "gate_timeout");
});

test("an executor with NO owner public key is still stopped at the effect point", async () => {
  // Layer 2 is only enforced when an owner key is configured — pre-existing behaviour this change does not
  // alter. So for an executor missing that key, verification alone lets a privileged task through:
  const noOwnerKey = agentConfigSchema.parse({ controlCenterUrl: "https://cc.test", agentId: "agent-1", agentSecret: "unused-legacy-secret", keyProtocolVersion: "agent-v2", controlPlanePublicKey: cp.signingPublicKey });
  verifyTask(noOwnerKey, privilegedTask() as never, true); // does not throw

  // The effect point is what actually stops it, which is the whole point of enforcing at the mutation
  // rather than at a predicate: an unreviewed payload cannot acquire, whatever verification concluded.
  const gate = fakeGate({});
  const outcome = await acquireForEffect({ gate: gate.client(), journal: new ExecutionJournal(tmp()), payload: privilegedTask().payload, taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", at: new Date().toISOString() });
  assert.equal(outcome.refused === true && outcome.code, "review_authorization_missing");
  assert.equal(gate.calls.length, 0);
});

test("the executor authenticates to the gate with ITS OWN credential", async () => {
  const gate = fakeGate({});
  await gate.client("executor-own-credential").acquire({ attestationId: "att-1", leaseId: "l", actionDigest: "d", orgId: "o", serverId: "s", kind: "configuration.apply", idempotencyKey: "idem-test" });
  // An instruction is not authorization. If the control-center could supply the proof that its own
  // deployment was reviewed, the review would be decorative.
  assert.equal(gate.calls[0].authorization, "Bearer executor-own-credential");
  assert.match(gate.calls[0].url, /\/attestations\/att-1\/acquire$/);
});

// ── acquisition ordering: the actual enforcement point ─────────────────────────────────────────────

test("a payload with no review authorization never reaches the gate", async () => {
  const gate = fakeGate({});
  const outcome = await acquireForEffect({ gate: gate.client(), journal: new ExecutionJournal(tmp()), payload: { configurationDeployment: { planId: "p" } }, taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", at: new Date().toISOString() });
  assert.equal(outcome.refused === true && outcome.code, "review_authorization_missing");
  assert.equal(gate.calls.length, 0);
});

test("acquisition sends the digest of the payload ABOUT TO BE APPLIED", async () => {
  const gate = fakeGate({});
  const payload = subPayload();
  const outcome = await acquireForEffect({ gate: gate.client(), journal: new ExecutionJournal(tmp()), payload, taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", at: new Date().toISOString() });
  assert.equal(outcome.refused, false);
  // Computed here, with the same function layer 2 signs — not taken from the control-center.
  assert.equal(gate.calls[0].body.actionDigest, privilegedActionDigest(payload));
  assert.deepEqual([gate.calls[0].body.orgId, gate.calls[0].body.serverId, gate.calls[0].body.kind], ["org-1", "server-1", "configuration.apply"]);
});

test("the digest is over the PARSE, so a reordered payload still acquires the same action", async () => {
  // THE SERIALIZATION CONTRACT, on the executor's side. `payloadDigest` is
  // `sha256(JSON.stringify(...))` with no canonicalisation, so key order decides it. The gate binds the
  // digest of ITS parse; an executor that digested whatever bytes reached it would agree only while
  // whoever dispatched the task also parsed. The real control plane does -- `createTask` stores
  // `registry.payload.parse(...)` -- but that is an assumption about a component on the far side of a
  // trust boundary, and this removes the need for it.
  const ordered = subPayload();
  const scrambled = {
    action: ordered.action, schemaVersion: ordered.schemaVersion,
    ...Object.fromEntries(Object.entries(ordered)
      .filter(([key]) => key !== "action" && key !== "schemaVersion")),
  };
  assert.notEqual(JSON.stringify(scrambled), JSON.stringify(ordered),
    "the two must really differ as bytes, or this proves nothing");
  assert.notEqual(privilegedActionDigest(scrambled), privilegedActionDigest(ordered),
    "and their raw digests must differ, which is the trap");

  const gate = fakeGate({});
  const outcome = await acquireForEffect({
    gate: gate.client(), journal: new ExecutionJournal(tmp()), payload: scrambled,
    taskType: "configuration.apply", orgId: "o", serverId: "s", at: new Date().toISOString(),
  });
  assert.equal(outcome.refused, false);
  assert.equal(gate.calls[0].body.actionDigest,
    privilegedActionDigest(configurationDeploymentPayloadSchema.parse(scrambled)),
    "the executor must send the digest of the parse");
  assert.equal(gate.calls[0].body.actionDigest, privilegedActionDigest(ordered),
    "which is the same digest the schema-ordered payload produces, and the one the gate bound");
});

test("a privileged payload the schema refuses never reaches the gate", async () => {
  // Refused BEFORE the gate is called and before anything on this host is claimed. It would have been
  // refused later anyway -- `executeConfigurationDeployment` parses with the same schema -- but by then
  // the attestation is EXECUTING and this host holds a durable claim, so the honest outcome would be an
  // INDETERMINATE record needing human reconciliation for an action that could never have run.
  const gate = fakeGate({});
  const dir = tmp();
  const outcome = await acquireForEffect({
    gate: gate.client(), journal: new ExecutionJournal(dir),
    payload: { ...subPayload(), planRevision: "one" },
    taskType: "configuration.apply", orgId: "o", serverId: "s", at: new Date().toISOString(),
  });
  assert.equal(outcome.refused === true && outcome.code, "malformed_privileged_payload");
  assert.equal(gate.calls.length, 0, "the gate must not be asked");
  assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, 0, "and nothing claimed locally");
});

test("when the GATE refuses, this host's journal is left untouched", async () => {
  const dir = tmp();
  const gate = fakeGate({ acquire: { status: 409, body: { ok: false, code: "attestation_revoked" } } });
  const outcome = await acquireForEffect({ gate: gate.client(), journal: new ExecutionJournal(dir), payload: subPayload(), taskType: "configuration.apply", orgId: "o", serverId: "s", at: new Date().toISOString() });
  assert.equal(outcome.refused === true && outcome.code, "attestation_revoked");
  // A refusal must not poison the journal: the action never had permission, and a later authorized
  // attempt must not find a claim standing in its way.
  assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, 0);
  const retry = await acquireForEffect({ gate: fakeGate({}).client(), journal: new ExecutionJournal(dir), payload: subPayload(), taskType: "configuration.apply", orgId: "o", serverId: "s", at: new Date().toISOString() });
  assert.equal(retry.refused, false);
});

test("a prior unresolved attempt on this host refuses AFTER the gate has moved to EXECUTING", async () => {
  const dir = tmp();
  const payload = subPayload();
  const first = fakeGate({});
  await acquireForEffect({ gate: first.client(), journal: new ExecutionJournal(dir), payload, taskType: "configuration.apply", orgId: "o", serverId: "s", at: new Date().toISOString() });

  const second = fakeGate({});
  const outcome = await acquireForEffect({ gate: second.client(), journal: new ExecutionJournal(dir), payload, taskType: "configuration.apply", orgId: "o", serverId: "s", at: new Date().toISOString() });
  assert.equal(outcome.refused === true && outcome.code, "prior_attempt_unresolved");
  // The attestation is deliberately LEFT executing rather than redeemed: this host may already have
  // applied the action, and nothing here is entitled to decide that it did not.
  assert.equal(second.calls.filter((c) => c.url.includes("/redeem")).length, 0);
});

// ── settlement ordering ────────────────────────────────────────────────────────────────────────────

test("the journal is written BEFORE the gate is told", async () => {
  const dir = tmp();
  const journal = new ExecutionJournal(dir);
  const gate = fakeGate({});
  const acquired = await acquireForEffect({ gate: gate.client(), journal, payload: subPayload(), taskType: "configuration.apply", orgId: "o", serverId: "s", at: new Date().toISOString() });
  assert.equal(acquired.refused, false);
  if (acquired.refused) return;

  let journalledBeforeRedeem = false;
  const observing = new ReviewGateClient({ url: "https://gate.test", credential: "c", timeoutMs: 1000 }, async () => {
    // At the moment redeem is called, the durable local record must already say what happened.
    journalledBeforeRedeem = new ExecutionJournal(dir).claim({ actionDigest: acquired.actionDigest, attestationId: "att-1", leaseId: "l", serverId: "s", at: new Date().toISOString() }).claimed === false;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const settled = await recordEffect({ gate: observing, journal, acquired, succeeded: true, terminalPhase: "succeeded", at: new Date().toISOString() });
  assert.equal(settled.redeemed, true);
  assert.equal(journalledBeforeRedeem, true);
});

test("a failed redeem does not un-apply anything — it leaves the record for a human", async () => {
  const dir = tmp();
  const journal = new ExecutionJournal(dir);
  const gate = fakeGate({ redeem: { status: 503, body: { ok: false, code: "gate_unavailable" } } });
  const acquired = await acquireForEffect({ gate: gate.client(), journal, payload: subPayload(), taskType: "configuration.apply", orgId: "o", serverId: "s", at: new Date().toISOString() });
  if (acquired.refused) return assert.fail("acquisition should have succeeded");
  const settled = await recordEffect({ gate: gate.client(), journal, acquired, succeeded: true, at: new Date().toISOString() });
  assert.equal(settled.redeemed, false);
  // The local truth survives the gate being unreachable: this host did apply it, and says so.
  const after = new ExecutionJournal(dir).claim({ actionDigest: acquired.actionDigest, attestationId: "att-1", leaseId: "l", serverId: "s", at: new Date().toISOString() });
  assert.equal(after.claimed === false && after.reason, "already_applied");
});

// ── layer 3 as a precondition on verification ──────────────────────────────────────────────────────

test("ENFORCING requires the payload to name an attestation; ADVISORY is unchanged", () => {
  // Advisory (the default, and today's behaviour): a valid two-layer task passes with no review reference.
  verifyTask(baseConfig, privilegedTask() as never);
  verifyTask(baseConfig, privilegedTask(REVIEW) as never);
  // Enforcing: the reference is required before the executor will even attempt acquisition.
  assert.throws(() => verifyTask(baseConfig, privilegedTask() as never, true), /review-authorization-missing/);
  verifyTask(baseConfig, privilegedTask(REVIEW) as never, true);
});

test("a reference at the WRONG LEVEL is not a reference", () => {
  // The task payload carries `reviewAuthorization` at its top level instead of inside the deployment.
  // This is the exact shape of a defect an independent review round turned up: it must not satisfy
  // layer 3, or the executor and the gate would disagree about what was authorized.
  assert.throws(
    () => verifyTask(baseConfig, privilegedTask(REVIEW, "valid", true) as never, true),
    /review-authorization-missing/,
  );
});

test("privilegedSubPayload finds the payload the gate bound, and nothing else", () => {
  const upgrade = { upgradeId: "u-1", reviewAuthorization: REVIEW };
  const deploy = { planId: "plan-1", reviewAuthorization: REVIEW };
  const payload = { configurationDeployment: deploy, agentUpgrade: upgrade, reviewAuthorization: { attestationId: "decoy", leaseId: "decoy" } };
  assert.deepEqual(privilegedSubPayload("configuration.apply", payload), deploy);
  assert.deepEqual(privilegedSubPayload("configuration.rollback", payload), deploy);
  assert.deepEqual(privilegedSubPayload("agent.upgrade", payload), upgrade);
  // A task type nobody wired here yields nothing, so an enforcing executor refuses it rather than
  // applying it unauthorized. That is the safe direction for a type added later.
  assert.equal(privilegedSubPayload("configuration.something.new", payload), undefined);
  assert.equal(privilegedSubPayload("collect.system", payload), undefined);
  // readReviewAuthorization reads whatever object it is handed — it has no way to know it was given
  // the wrong one. That is precisely why the pairing matters: the sub-payload yields the real reference,
  // and reading the wrapper yields the decoy. The defect was a caller passing the wrapper.
  assert.equal(readReviewAuthorization(privilegedSubPayload("configuration.apply", payload))?.attestationId, REVIEW.attestationId);
  assert.equal(readReviewAuthorization(payload)?.attestationId, "decoy");
});

test("layer 3 does not weaken layers 1 and 2", () => {
  // A review reference is not a substitute for the owner's signature. A task carrying a perfectly good
  // attestation reference and a forged owner authorization must still be refused on layer 2.
  assert.throws(() => verifyTask(baseConfig, privilegedTask(REVIEW, "forged") as never, true), /owner-authorization-invalid/);
  assert.throws(() => verifyTask(baseConfig, privilegedTask(REVIEW, "forged") as never, false), /owner-authorization-invalid/);
});

// ── the wiring itself ──────────────────────────────────────────────────────────────────────────────

test("acquisition is wired BEFORE the effect, and settlement after it", () => {
  const text = source("agent.ts");
  const body = text.slice(text.indexOf("async function executeTask"), text.indexOf("async function pollOnce"));
  const acquire = body.indexOf("acquireForEffect");
  const apply = body.indexOf("executeConfigurationDeployment");
  const handoff = body.indexOf("handoffUpgrade");
  assert.ok(acquire > -1 && apply > -1 && handoff > -1);
  // Every privileged effect in this function is downstream of acquisition. If a new privileged case is
  // added above it, this fails.
  assert.ok(acquire < apply, "configuration deployment must not run before acquisition");
  assert.ok(acquire < handoff, "upgrade handoff must not run before acquisition");
  assert.ok(body.indexOf("settle(enforcement, acquired") > acquire, "settlement follows acquisition");
  // A refused acquisition returns; it does not fall through into the switch.
  assert.match(body.slice(acquire, apply), /outcome\.refused[\s\S]*?return;/);
});

test("a task cannot supply the credential the executor presents to the gate", async () => {
  const gate = fakeGate({});
  // Everything a task could plausibly smuggle in, offered at the acquire call site.
  await gate.client("executor-own-credential").acquire({
    attestationId: "att-1", leaseId: "l", actionDigest: digestOf("a"), orgId: "o", serverId: "s", kind: "k",
    credential: "attacker-supplied", authorization: "Bearer attacker-supplied", token: "attacker-supplied",
  } as never);
  // The header comes from configuration and nothing else: an instruction is not authorization.
  assert.equal(gate.calls[0].authorization, "Bearer executor-own-credential");
  // And none of it is forwarded to the gate as body fields it might trust.
  assert.deepEqual(Object.keys(gate.calls[0].body).sort(), ["actionDigest", "kind", "leaseId", "orgId", "serverId"]);
});

// ── the execution keeper ─────────────────────────────────────────────────────────────────────────
//
// An independent review found the checklist's extension step untested. It was worse than that: nothing
// in the executor ever called extend. `executionDeadline` came out of acquire, sat in a field, and was
// never read, so a privileged effect that outran its window ran on with a lapsed attempt.
//
// These drive the real client over a real socket, so the attempt token genuinely travels on the wire.

type ExtendRequest = { attemptToken?: string; requestedDeadline?: string };

/** A gate that records extension requests and answers with a deadline of its own choosing. */
function stubGate(reply: (n: number) => { status: number; body: Record<string, unknown> },
  delayMs = 0) {
  const seen: ExtendRequest[] = [];
  const received: number[] = [];
  let repliedAt = 0;
  let arrived: () => void = () => {};
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push(JSON.parse(body || "{}"));
      received.push(Date.now());
      // A slow gate, so a request can genuinely be IN FLIGHT while the caller tries to shut down.
      setTimeout(() => {
        const { status, body: payload } = reply(seen.length);
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
        repliedAt = Date.now();
        arrived();
      }, delayMs);
    });
  });
  return {
    server, seen, received,
    repliedAt: () => repliedAt,
    nextRequest: () => new Promise<void>((resolve) => { arrived = resolve; }),
    start: async () => {
      server.listen(0);
      await new Promise((resolve) => server.once("listening", resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    stop: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => { server.close(resolve); });
    },
  };
}

/**
 * Wait for the KEEPER to have recorded something, not for the server to have answered.
 *
 * The stub resolves as soon as it writes its response, which is strictly before the client has parsed
 * it and before the keeper has updated anything. Asserting on the server's timing measured a race.
 */
async function until(condition: () => boolean, label: string, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const acquiredFor = (deadlineMs: number): Acquired => ({
  refused: false, attestationId: "at-1", leaseId: "L1", actionDigest: "d".repeat(64),
  attemptToken: "attempt-token-1", executionDeadline: new Date(deadlineMs).toISOString(),
});

test("the keeper extends before the deadline, with the attempt token, and tracks what the gate GRANTED", async () => {
  // The gate clamps: it answers with a deadline EARLIER than the one requested. A keeper that believed
  // its own request would reschedule against time it had never been given.
  const grantedAt = new Date(Date.now() + 5_000).toISOString();
  const gate = stubGate(() => ({ status: 200, body: { ok: true, executionDeadline: grantedAt } }));
  const url = await gate.start();
  const client = new ReviewGateClient({ url, credential: "executor-credential", timeoutMs: 2000 });
  const keeper = keepExecutionAlive({
    gate: client, acquired: acquiredFor(Date.now() + 25),
    marginMs: 0, incrementMs: 60_000,
  });
  try {
    await until(() => keeper.granted() === 1, "the keeper to record a granted extension");
    assert.equal(gate.seen.length, 1);
    assert.equal(gate.seen[0].attemptToken, "attempt-token-1",
      "the token is what proves this is the winning attempt");
    assert.notEqual(gate.seen[0].requestedDeadline, grantedAt, "the gate granted something else");
    assert.equal(keeper.granted(), 1);
    assert.equal(keeper.deadline(), grantedAt, "the keeper must track the gate's answer, not its own ask");
    assert.equal(keeper.refusal(), undefined);
  } finally {
    keeper.stop();
    await gate.stop();
  }
});

test("a refused extension stops the keeper asking, and does not abort anything", async () => {
  // One refusal ends it. Asking again would either repeat a permanent answer -- a rotated credential,
  // a spent attestation -- or hammer a gate that is already unreachable.
  const gate = stubGate(() => ({ status: 409, body: { ok: false, code: "credential_rotated" } }));
  const url = await gate.start();
  const client = new ReviewGateClient({ url, credential: "executor-credential", timeoutMs: 2000 });
  const keeper = keepExecutionAlive({
    gate: client, acquired: acquiredFor(Date.now() + 25),
    marginMs: 0, incrementMs: 60_000,
  });
  try {
    await until(() => keeper.refusal() !== undefined, "the keeper to record the refusal");
    // And then genuinely stops, rather than merely not having asked again yet.
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(gate.seen.length, 1, "it asked once and stopped");
    assert.equal(keeper.granted(), 0);
    assert.equal(keeper.refusal(), "credential_rotated");
  } finally {
    keeper.stop();
    await gate.stop();
  }
});

test("stopping the keeper stops the extensions", async () => {
  const gate = stubGate(() => ({ status: 200, body: { ok: true, executionDeadline: new Date(Date.now() + 5_000).toISOString() } }));
  const url = await gate.start();
  const client = new ReviewGateClient({ url, credential: "executor-credential", timeoutMs: 2000 });
  const keeper = keepExecutionAlive({
    gate: client, acquired: acquiredFor(Date.now() + 10_000),
    marginMs: 0, incrementMs: 60_000,
  });
  keeper.stop();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(gate.seen, [], "a stopped keeper must not extend an attempt that is already settled");
  await gate.stop();
});

test("the executor releases the keeper on every exit from the effect", () => {
  // The `agent.upgrade` path RETURNS from inside the try block. A keeper released after the settle
  // rather than in a `finally` would go on extending an attempt that had already been redeemed.
  const text = source("agent.ts");
  assert.match(text, /finally\s*\{[\s\S]*keeper\?\.stop\(\)/,
    "the keeper must be released in a finally, not on the success path only");
});

test("stopping the keeper WAITS for an extension already in flight", async () => {
  // Clearing the timer was not enough. Once `tick()` had called the gate there was nothing to cancel,
  // so a request carrying the attempt token could still be in the air while settlement and redeem ran
  // -- a second use of the token after the attempt was over. An independent review found that race.
  const gate = stubGate(
    () => ({ status: 200, body: { ok: true, executionDeadline: new Date(Date.now() + 5_000).toISOString() } }),
    250);
  const url = await gate.start();
  const client = new ReviewGateClient({ url, credential: "executor-credential", timeoutMs: 2000 });
  const keeper = keepExecutionAlive({
    gate: client, acquired: acquiredFor(Date.now() + 25),
    marginMs: 0, incrementMs: 60_000,
  });
  try {
    // Wait until the gate has RECEIVED the request but has not answered it.
    await until(() => gate.received.length === 1, "the extension to reach the gate");
    assert.equal(gate.repliedAt(), 0, "the gate has not answered yet");

    await keeper.stop();
    const stoppedAt = Date.now();
    assert.notEqual(gate.repliedAt(), 0, "stop must not return while the request is still in flight");
    assert.ok(stoppedAt >= gate.repliedAt(),
      "the keeper's life must end after the request it started, not before");
  } finally {
    await keeper.stop();
    await gate.stop();
  }
});
