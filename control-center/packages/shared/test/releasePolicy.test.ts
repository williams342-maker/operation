import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  ed25519PublicKeyId,
  evaluateProductionPublication,
  evaluateStagingBurnIn,
  isStagingActionAllowed,
  publicationAuthorizationDigest,
  releaseCandidateEvidenceDigest,
  releasePolicyDigest,
  releasePolicySchema,
  type PublicationAuthorization,
  type ReleaseCandidateEvidence,
  type ReleasePolicy,
  type SignedReleasePolicy
} from "../src/releasePolicy.js";

function basePolicy(ownerKeyId: string): ReleasePolicy {
  return releasePolicySchema.parse({
    schemaVersion: "opsworkbench-release-policy-v1",
    policyId: "Staging-BurnIn",
    version: 1,
    authority: [
      ["build", "ai", true],
      ["test", "ai", true],
      ["security_validation", "ai", true],
      ["staging_deployment", "ai", true],
      ["burn_in_monitoring", "ai", true],
      ["staging_rollback", "ai", true],
      ["release_candidate_creation", "ai", true],
      ["production_publication", "owner_ed25519_signature", false]
    ].map(([stage, authority, autonomous]) => ({ stage, authority, autonomous })),
    roles: [
      { role: "owner", responsibilities: ["holds_offline_key"] },
      { role: "operations_administrator", responsibilities: ["reviews_monitoring"] },
      { role: "publisher", responsibilities: ["verifies_signature"] }
    ],
    monitoring: {
      availabilityPercentMinimum: 99.9,
      httpErrorRatePercentMaximum: 1,
      p95LatencyMsMaximum: 500,
      agentHeartbeatGapSecondsMaximum: 60,
      diskWarningPercent: 80,
      diskCriticalPercent: 90
    },
    stagingProfile: {
      name: "Staging-BurnIn-v1",
      version: 1,
      allowedActions: ["deploy", "restart", "rollback", "collect_telemetry", "browser_validation", "security_validation"],
      deniedActions: ["production_publish", "database_migration", "dns_changes", "payment_activation", "secret_rotation", "signing"]
    },
    observation: {
      minimumHours: 24,
      resetOn: ["unexpected_restart", "critical_alert", "latency_threshold_breach", "availability_threshold_breach", "agent_heartbeat_threshold_breach"]
    },
    publication: {
      ownerKeyId,
      requireValidOwnerSignature: true,
      requirePolicySignature: true,
      requireSecurityValidation: true,
      requireStagingValidation: true,
      requireTelemetryThresholds: true,
      requireRollbackCheckpoint: true
    }
  });
}

function signedFixture() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const keyId = ed25519PublicKeyId(publicKeyPem);
  const policy = basePolicy(keyId);
  const policyDigest = releasePolicyDigest(policy);
  const signedPolicy: SignedReleasePolicy = {
    policy,
    policyDigest,
    signatureKeyId: keyId,
    signature: crypto.sign(null, Buffer.from(policyDigest, "hex"), privateKey).toString("base64")
  };
  const evidence: ReleaseCandidateEvidence = {
    schemaVersion: "opsworkbench-release-candidate-evidence-v1",
    releaseId: "release-1",
    releaseDigest: "a".repeat(64),
    policyDigest,
    targetEnvironment: "production",
    observationStartedAt: "2026-07-20T00:00:00.000Z",
    observedAt: "2026-07-21T00:01:00.000Z",
    availabilityPercent: 99.95,
    httpErrorRatePercent: 0.25,
    p95LatencyMs: 350,
    maximumAgentHeartbeatGapSeconds: 55,
    maximumDiskPercent: 79,
    unexpectedRestarts: 0,
    criticalAlerts: 0,
    securityValidationPassed: true,
    stagingValidationPassed: true,
    rollbackCheckpointDigest: "b".repeat(64)
  };
  const unsignedAuthorization = {
    schemaVersion: "opsworkbench-publication-authorization-v1" as const,
    releaseId: evidence.releaseId,
    releaseDigest: evidence.releaseDigest,
    policyDigest,
    evidenceDigest: releaseCandidateEvidenceDigest(evidence),
    signedAt: "2026-07-21T00:02:00.000Z",
    signatureKeyId: keyId
  };
  const authorization: PublicationAuthorization = {
    ...unsignedAuthorization,
    signature: crypto.sign(null, Buffer.from(publicationAuthorizationDigest(unsignedAuthorization), "hex"), privateKey).toString("base64")
  };
  return { signedPolicy, evidence, authorization, ownerPublicKeyPem: publicKeyPem };
}

test("staging profile permits autonomous staging work and denies publication controls", () => {
  const fixture = signedFixture();
  assert.equal(isStagingActionAllowed(fixture.signedPolicy.policy, "deploy"), true);
  assert.equal(isStagingActionAllowed(fixture.signedPolicy.policy, "rollback"), true);
  assert.equal(isStagingActionAllowed(fixture.signedPolicy.policy, "production_publish"), false);
  assert.equal(isStagingActionAllowed(fixture.signedPolicy.policy, "signing"), false);
});

test("production publication requires every policy, telemetry, rollback, and signature check", () => {
  const fixture = signedFixture();
  assert.equal(ed25519PublicKeyId(fixture.ownerPublicKeyPem), fixture.signedPolicy.signatureKeyId);
  const result = evaluateProductionPublication(fixture);
  assert.equal(result.publishEnabled, true, JSON.stringify(result));
  assert.equal(result.checks.every((check) => check.passed), true);
  assert.deepEqual(result.warnings, []);
});

test("publication fails closed for a forged release signature", () => {
  const fixture = signedFixture();
  fixture.authorization.signature = Buffer.alloc(64).toString("base64");
  const result = evaluateProductionPublication(fixture);
  assert.equal(result.publishEnabled, false);
  assert.equal(result.checks.find((check) => check.name === "owner_release_signature_valid")?.passed, false);
});

test("publication fails closed when burn-in resets or thresholds are breached", () => {
  const fixture = signedFixture();
  fixture.evidence.observationStartedAt = "2026-07-20T12:00:00.000Z";
  fixture.evidence.unexpectedRestarts = 1;
  fixture.evidence.p95LatencyMs = 500;
  fixture.evidence.maximumDiskPercent = 91;
  const result = evaluateProductionPublication(fixture);
  assert.equal(result.publishEnabled, false);
  assert.equal(result.checks.find((check) => check.name === "minimum_observation_complete")?.passed, false);
  assert.equal(result.checks.find((check) => check.name === "no_unexpected_restarts")?.passed, false);
  assert.equal(result.checks.find((check) => check.name === "latency_threshold")?.passed, false);
  assert.equal(result.checks.find((check) => check.name === "disk_critical_threshold")?.passed, false);
});

test("policy schema rejects any staging permission to publish or sign", () => {
  const fixture = signedFixture();
  const unsafe = structuredClone(fixture.signedPolicy.policy);
  unsafe.stagingProfile.allowedActions.push("production_publish");
  assert.equal(releasePolicySchema.safeParse(unsafe).success, false);
});

test("burn-in starts at the first healthy sample after a failure and completes only after the minimum window", () => {
  const policy = basePolicy("OWNER_ED25519_KEY_ID_REQUIRED");
  const initial = [
    { collectedAt: "2026-07-24T19:56:00.000Z", httpHealth: [{ success: false, latencyMs: 4 }], maximumDiskPercent: 65 },
    { collectedAt: "2026-07-24T19:57:00.000Z", httpHealth: [{ success: true, latencyMs: 54 }], maximumDiskPercent: 65 }
  ];
  const observing = evaluateStagingBurnIn(policy, initial, new Date("2026-07-24T19:57:30.000Z"));
  assert.equal(observing.state, "observing");
  assert.equal(observing.observationStartedAt, "2026-07-24T19:57:00.000Z");
  assert.deepEqual(observing.lastResetReasons, ["availability_threshold_breach"]);
  assert.ok(observing.completionPercent > 0);

  const samples = [...initial, ...Array.from({ length: 1440 }, (_, index) => ({
    collectedAt: new Date(Date.parse("2026-07-24T19:57:30.000Z") + index * 60_000).toISOString(),
    httpHealth: [{ success: true, latencyMs: index % 2 ? 60 : 54 }],
    maximumDiskPercent: 66
  }))];
  const complete = evaluateStagingBurnIn(policy, samples, new Date("2026-07-25T19:57:01.000Z"));
  assert.equal(complete.state, "complete");
  assert.equal(complete.metrics.availabilityPercent, 100);
  assert.equal(complete.metrics.p95LatencyMs, 60);
});

test("heartbeat gaps and container restart increments reset burn-in at the current healthy sample", () => {
  const policy = basePolicy("OWNER_ED25519_KEY_ID_REQUIRED");
  const result = evaluateStagingBurnIn(policy, [
    { collectedAt: "2026-07-24T20:00:00.000Z", httpHealth: [{ success: true, latencyMs: 40 }], docker: [{ name: "api", state: "running", restartCount: 0 }] },
    { collectedAt: "2026-07-24T20:02:00.000Z", httpHealth: [{ success: true, latencyMs: 42 }], docker: [{ name: "api", state: "running", restartCount: 1 }] }
  ], new Date("2026-07-24T20:03:00.000Z"));
  assert.equal(result.state, "observing");
  assert.equal(result.observationStartedAt, "2026-07-24T20:02:00.000Z");
  assert.deepEqual(new Set(result.lastResetReasons), new Set(["agent_heartbeat_threshold_breach", "unexpected_restart"]));
  assert.equal(result.sampleCount, 1);
});
