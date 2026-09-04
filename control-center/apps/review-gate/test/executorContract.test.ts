import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { configurationChangeDigest, privilegedActionDigest } from "@control-center/shared";
import { buildApp } from "../src/server.js";
import { AttestationService } from "../src/attestationService.js";
import { contentDigest, candidateDigest, type CandidateBinding } from "../src/policy.js";
import type { CandidateRecord } from "../src/store.js";
import type { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { castOf, type Person } from "./principals.js";
// The EXECUTOR'S OWN client, imported across the workspace boundary on purpose.
//
// Everything either side of this seam was tested in isolation, which is exactly how a contract mismatch
// survives: the gate's route tests never exercised acquire over HTTP, and the executor's tests answered
// its own fetch with a fixture it wrote itself. Both suites can be green while the two disagree about
// status codes, body shape, or field names — and the failure would appear for the first time in front of
// a real host. This file runs the real router over a real socket against the real client.
//
// It is a TEST-ONLY import. No runtime dependency exists in either direction: the executor must not
// depend on the gate's code, or the thing being checked would be shipping alongside the checker.
import { ReviewGateClient } from "../../agent/src/reviewGateClient.js";
import { acquireForEffect, recordEffect } from "../../agent/src/reviewEnforcedExecution.js";
import { ExecutionJournal } from "../../agent/src/executionJournal.js";

const oid = (c: string) => c.repeat(40).slice(0, 40);
const dig = (c: string) => c.repeat(64).slice(0, 64);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "executor-contract-"));

const PEOPLE: Person[] = [
  { principalId: "owner", roles: ["owner"] },
  { principalId: "claude", roles: ["author"] },
  { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
  { principalId: "agent-1", roles: ["executor"], targetScopes: [{ orgId: "org-1", serverId: "server-1" }] },
  { principalId: "binder-1", roles: ["binder"], targetScopes: [{ orgId: "org-1", serverId: "server-1" }] },
];

const MUTATIONS = [
  { name: "DATABASE_URL", operation: "update" as const, secret: true, versionId: "v-000000000001", valueRef: "ref-1" },
  { name: "FEATURE_X", operation: "enable" as const, secret: false, versionId: "v-000000000002", valueRef: "ref-2" },
];

const configSubject = () => ({
  kind: "configuration.change" as const,
  changeDigest: configurationChangeDigest(MUTATIONS),
  environmentId: "env-000000000001",
  targetProfileId: "profile-00000001",
  targetProfileRevision: 3,
});

const binding = (): CandidateBinding => ({
  subject: configSubject(), projectId: "crafters-market", repository: "williams342-maker/operation",
  baseBranch: "main", baseCommit: oid("a"), candidateCommit: oid("b"), candidateTree: oid("c"),
  patchDigest: dig("1"), artifactDigest: dig("3"), manifestDigest: dig("4"), dependencyLockDigests: [],
  testPlanVersion: "tp-1", testResultDigest: dig("2"), targetEnvironmentClass: "staging",
  authorIdentity: "claude", requestedReviewerClass: "independent", authorityRef: "OWNER-2026-09-02",
  createdAt: "2026-09-02T00:00:00.000Z", occurrenceId: "occ-seed",
} as CandidateBinding);

const configPayload = (over: Record<string, unknown> = {}) => ({
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

/** Walk a candidate to GO by named actions, so an owner decision is legal. */
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

/**
 * A real gate on a real socket, with a candidate carried through review to an attestation that is minted,
 * reserved and bound — the state the executor actually meets at dispatch time.
 */
async function liveGate() {
  const cast = await castOf(PEOPLE);
  const store = cast.store;
  let ids = 0;
  // THE REAL CLOCK, because the live server the client talks to uses one. A fixed test clock here would
  // mint leases and attestations that the running gate considers already expired.
  const svc = new AttestationService(store, { clock: () => new Date().toISOString(), ids: () => `att-${ids++}` });

  await atGo(store, "c1", binding());
  const decision = await svc.recordOwnerDecision(cast.who("owner"), {
    candidateId: "c1", idempotencyKey: "k",
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-1", audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: new Date(Date.now() + 3600_000).toISOString() }],
  });
  const [attestationId] = valueOf<{ attestationIds: string[] }>(decision).attestationIds;
  const { leaseId } = valueOf<{ leaseId: string }>(await svc.reserve(cast.who("binder-1"), { attestationId, leaseSeconds: 600 }));
  // The payload the executor will be handed, naming the attestation and lease it must redeem.
  const payload = configPayload({ reviewAuthorization: { attestationId, leaseId } });
  assert.equal((await svc.bind(cast.who("binder-1"), { attestationId, leaseId, payload })).ok, true);

  const server = buildApp(store).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    store, svc, attestationId, leaseId, payload, url,
    client: (credential = cast.credentialFor("agent-1")) => new ReviewGateClient({ url, credential, timeoutMs: 5000 }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("the executor's client and the gate's routes actually agree", async (t) => {
  const gate = await liveGate();
  t.after(() => gate.close());
  const journal = new ExecutionJournal(tmp());

  const acquired = await acquireForEffect({
    gate: gate.client(), journal, payload: gate.payload, taskType: "configuration.apply",
    orgId: "org-1", serverId: "server-1", at: new Date().toISOString(),
  });
  assert.equal(acquired.refused, false, JSON.stringify(acquired));
  if (acquired.refused) return;
  // The digest the executor computed from the payload it holds is the one the gate bound at review time.
  assert.equal(acquired.actionDigest, privilegedActionDigest(gate.payload));
  assert.equal((await gate.store.loadAttestation(gate.attestationId))!.state, "EXECUTING");

  const settled = await recordEffect({ gate: gate.client(), journal, acquired, succeeded: true, terminalPhase: "succeeded", at: new Date().toISOString() });
  assert.equal(settled.redeemed, true, settled.redeemCode);
  assert.equal((await gate.store.loadAttestation(gate.attestationId))!.state, "CONSUMED");
});

test("a SECOND executor cannot acquire what the first already took", async (t) => {
  const gate = await liveGate();
  t.after(() => gate.close());
  const first = await acquireForEffect({ gate: gate.client(), journal: new ExecutionJournal(tmp()), payload: gate.payload, taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", at: new Date().toISOString() });
  assert.equal(first.refused, false);

  // A duplicate delivery of the same task to a DIFFERENT host: its own journal is empty, so nothing local
  // stops it. The gate is the only thing that can, and this is the case it exists for.
  const second = await acquireForEffect({ gate: gate.client(), journal: new ExecutionJournal(tmp()), payload: gate.payload, taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", at: new Date().toISOString() });
  assert.equal(second.refused, true);
});

test("a payload altered after review cannot acquire", async (t) => {
  const gate = await liveGate();
  t.after(() => gate.close());
  // Same attestation, same lease, one changed field — the executor computes the digest from the bytes it
  // is about to apply, so the gate sees a different action than the one that was reviewed.
  const tampered = { ...gate.payload, composeProject: "somewhere-else" };
  const outcome = await acquireForEffect({ gate: gate.client(), journal: new ExecutionJournal(tmp()), payload: tampered, taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", at: new Date().toISOString() });
  assert.equal(outcome.refused, true);
  assert.equal((await gate.store.loadAttestation(gate.attestationId))!.state, "RESERVED_BOUND");
});

test("an executor acquiring for a target it was not provisioned for is refused", async (t) => {
  const gate = await liveGate();
  t.after(() => gate.close());
  const outcome = await acquireForEffect({ gate: gate.client(), journal: new ExecutionJournal(tmp()), payload: gate.payload, taskType: "configuration.apply", orgId: "org-1", serverId: "server-9", at: new Date().toISOString() });
  assert.equal(outcome.refused, true);
});

test("a bad executor credential acquires nothing", async (t) => {
  const gate = await liveGate();
  t.after(() => gate.close());
  const outcome = await acquireForEffect({ gate: gate.client("not-a-real-credential"), journal: new ExecutionJournal(tmp()), payload: gate.payload, taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", at: new Date().toISOString() });
  assert.equal(outcome.refused, true);
  assert.equal((await gate.store.loadAttestation(gate.attestationId))!.state, "RESERVED_BOUND");
});
