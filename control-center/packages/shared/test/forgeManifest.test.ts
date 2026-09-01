import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  forgeDeploymentManifestSchema,
  forgeManifestDigest,
  forgeManifestStatement,
  forgeOwnerAuthorizationMessage,
  assertFlatManifest,
  findSecretShapedField,
  verifyForgeManifest,
  type ForgeDeploymentManifest,
  type ForgeAttestationEvidence,
  type ForgeManifestVerificationInput
} from "../src/forgeManifest.js";
import { generateAgentKeyPairs, signWithAgentKey } from "../src/agentKeys.js";
import type { OwnerAuthorization } from "../src/tasks.js";

// Disposable dev owner keypair. The production owner private key is offline and never handled in-repo.
const owner = generateAgentKeyPairs();
const NOW = Date.parse("2026-09-01T00:00:00.000Z");
const HOUR = 3600_000;
const COMMIT = "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b";
const TREE = "322b1275e498aa0d4c0c1cbb0a2f2ab5f4e6d7c8";
const BUILDER = "https://github.com/williams342-maker/operation/.github/workflows/control-center-release.yml@refs/tags/v0.1.2-operate";
const img = (name: string, byte: string) => `ghcr.io/williams342-maker/${name}@sha256:${byte.repeat(64)}`;

function manifest(overrides: Partial<ForgeDeploymentManifest> = {}): ForgeDeploymentManifest {
  return {
    schemaVersion: "forge-deployment-v1",
    manifestId: "forge-20260901-0001",
    sourceRepository: "https://github.com/williams342-maker/operation",
    sourceCommit: COMMIT,
    sourceTree: TREE,
    sourceTag: "v0.1.2-operate",
    backendImageDigest: img("backend", "a"),
    frontendImageDigest: img("frontend", "b"),
    targetEnvironment: "beta",
    targetServerId: "server-000000000001",
    targetOrgId: "org-000000000001",
    composeProjectName: "opsworkbench-beta",
    authorizedServices: ["backend", "frontend"],
    rollbackBackendImageDigest: img("backend", "c"),
    rollbackFrontendImageDigest: img("frontend", "d"),
    rollbackSourceCommit: "467a3138e8c8d4cd3e397bdfa32562b09a5332f8",
    builderIdentity: BUILDER,
    builderRunnerEnvironment: "github-hosted",
    requiredCapabilities: ["docker", "compose", "dockerComposeActivation"],
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + HOUR).toISOString(),
    nonce: "forge-nonce-000000001",
    ...overrides
  } as ForgeDeploymentManifest;
}

const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const manifestBytes = (m: ForgeDeploymentManifest) => sha(JSON.stringify(m));

function attestation(m: ForgeDeploymentManifest, overrides: Partial<ForgeAttestationEvidence> = {}): ForgeAttestationEvidence {
  return { verified: true, builderId: m.builderIdentity, runnerEnvironment: m.builderRunnerEnvironment, sourceCommit: m.sourceCommit, subjectSha256: manifestBytes(m), ...overrides };
}

function ownerAuth(m: ForgeDeploymentManifest, opts: { expiresAt?: string; nonce?: string; keyVersion?: string; signWith?: string; digest?: string } = {}): OwnerAuthorization {
  const expiresAt = opts.expiresAt ?? new Date(NOW + HOUR).toISOString();
  const nonce = opts.nonce ?? "owner-nonce-000000001";
  const keyVersion = opts.keyVersion ?? "owner-v1";
  const signature = signWithAgentKey(opts.signWith ?? owner.signingPrivateKey, forgeOwnerAuthorizationMessage({
    manifestDigest: opts.digest ?? forgeManifestDigest(m), targetOrgId: m.targetOrgId, targetServerId: m.targetServerId, expiresAt, nonce, keyVersion
  }));
  return { signature, issuedAt: new Date(NOW).toISOString(), expiresAt, nonce, keyVersion };
}

function input(m: ForgeDeploymentManifest, overrides: Partial<ForgeManifestVerificationInput> = {}): ForgeManifestVerificationInput {
  return { manifest: m, manifestSha256: manifestBytes(m), attestation: attestation(m), ownerAuthorization: ownerAuth(m), ownerPublicKey: owner.signingPublicKey, agentAdvertisedCapabilities: ["docker", "compose", "dockerComposeActivation", "system"], now: NOW, ...overrides };
}

const reason = (d: ReturnType<typeof verifyForgeManifest>) => (d as { reason: string }).reason;

test("a fully attested and owner-authorized manifest verifies", () => {
  const decision = verifyForgeManifest(input(manifest()));
  assert.equal(decision.verified, true);
});

// --- Canonicalization -------------------------------------------------------------------------------

test("canonical statement is an ordered join, stable under key reordering", () => {
  const a = manifest();
  const reordered = Object.fromEntries(Object.entries(a).reverse()) as ForgeDeploymentManifest;
  assert.equal(forgeManifestDigest(a), forgeManifestDigest(reordered));
  assert.equal(forgeManifestStatement(a).split("\n").length, 24);
});

test("REGRESSION: the replacer idiom would collide here; the ordered join does not", () => {
  // The hazard, reproduced directly: JSON.stringify's array replacer is an allowlist applied to EVERY
  // object in the graph, so nested keys vanish silently and two different targets digest the same.
  const nestedA = { schemaVersion: "x", target: { env: "beta", server: "AAA" } };
  const nestedB = { schemaVersion: "x", target: { env: "beta", server: "BBB" } };
  const keys = Object.keys(nestedA).sort();
  assert.equal(JSON.stringify(nestedA, keys), JSON.stringify(nestedB, keys), "precondition: the replacer idiom collides on nested input");

  // forge-deployment-v1 is flat and ordered-joined, so the same distinction survives.
  assert.notEqual(forgeManifestDigest(manifest({ targetServerId: "server-00000000000A" })), forgeManifestDigest(manifest({ targetServerId: "server-00000000000B" })));
});

test("every field participates in the digest", () => {
  const base = manifest();
  const changes: Partial<ForgeDeploymentManifest>[] = [
    { manifestId: "forge-20260901-0002" }, { sourceRepository: "https://github.com/williams342-maker/other" },
    { sourceCommit: "0".repeat(40) }, { sourceTree: "1".repeat(40) }, { sourceTag: "v0.1.1-operate" },
    { backendImageDigest: img("backend", "e") }, { frontendImageDigest: img("frontend", "e") },
    { releaseBundleSha256: "f".repeat(64) }, { releaseManifestDigest: "e".repeat(64) },
    { targetEnvironment: "staging" }, { targetServerId: "server-000000000002" }, { targetOrgId: "org-000000000002" },
    { composeProjectName: "other-project" }, { authorizedServices: ["backend"] },
    { rollbackBackendImageDigest: img("backend", "f") }, { rollbackFrontendImageDigest: img("frontend", "f") },
    { rollbackSourceCommit: "2".repeat(40) }, { builderIdentity: "https://github.com/other/repo/.github/workflows/x.yml@refs/heads/main" },
    { builderRunnerEnvironment: "self-hosted" }, { requiredCapabilities: ["docker"] },
    { issuedAt: new Date(NOW - HOUR).toISOString() }, { expiresAt: new Date(NOW + 2 * HOUR).toISOString() },
    { nonce: "forge-nonce-000000002" }
  ];
  const seen = new Set([forgeManifestDigest(base)]);
  for (const change of changes) {
    const digest = forgeManifestDigest(manifest(change));
    assert.ok(!seen.has(digest), `changing ${Object.keys(change)[0]} did not change the digest`);
    seen.add(digest);
  }
});

test("an absent optional is unambiguous — it cannot collide with a present value", () => {
  const without = manifest();
  delete (without as Partial<ForgeDeploymentManifest>).sourceTag;
  assert.notEqual(forgeManifestDigest(without), forgeManifestDigest(manifest({ sourceTag: "v0.1.2-operate" })));
  assert.ok(forgeManifestStatement(without).includes("\n\n"), "absent optional serializes as an empty field");
});

test("array order carries no meaning and does not change the digest", () => {
  assert.equal(forgeManifestDigest(manifest({ authorizedServices: ["backend", "frontend"] })), forgeManifestDigest(manifest({ authorizedServices: ["frontend", "backend"] })));
});

// --- Flatness ---------------------------------------------------------------------------------------

test("PROOF: a nested manifest is rejected at schema level", () => {
  const valid = manifest();
  const nested = { ...valid, targetServerId: { id: "server-000000000001" } };
  assert.equal(forgeDeploymentManifestSchema.safeParse(nested).success, false);
  // Built by hand rather than through input(): the helper would have to digest the manifest to sign an
  // owner statement for it, and an invalid manifest is deliberately not digestible.
  assert.equal(reason(verifyForgeManifest({ ...input(valid), manifest: nested })), "schema-invalid");
});

test("an invalid manifest is never digestible — a bad manifest cannot be signed at all", () => {
  assert.throws(() => forgeManifestDigest({ ...manifest(), targetServerId: { id: "x" } } as unknown as ForgeDeploymentManifest));
  assert.throws(() => forgeManifestDigest({ ...manifest(), backendImageDigest: "ghcr.io/x/y:latest" } as ForgeDeploymentManifest));
});

test("the flatness guard catches a nested field a future schema edit might allow", () => {
  assert.throws(() => assertFlatManifest({ ...manifest(), extra: { nested: true } }), /not flat/);
  assert.throws(() => assertFlatManifest({ ...manifest(), authorizedServices: [{ name: "backend" }] }), /not flat/);
  assert.throws(() => assertFlatManifest({ ...manifest(), sourceCommit: null }), /not flat/);
});

test("a field outside the canonical order is refused rather than signed around", () => {
  // A field the schema accepted but the ordered join omits would be present in the manifest and absent
  // from the digest — signed around. Fail closed instead.
  assert.throws(() => assertFlatManifest({ ...manifest(), undeclaredField: "value" }), /outside the canonical field order/);
});

test("separator injection cannot forge extra fields", () => {
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ manifestId: "a\nb" })).success, false);
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ composeProjectName: "a,b" })).success, false);
});

// --- Party A: provenance ----------------------------------------------------------------------------

test("PROOF 1 (tamper): a manifest that is not the attestation's subject is rejected", () => {
  const m = manifest();
  assert.equal(reason(verifyForgeManifest(input(m, { manifestSha256: sha("tampered") }))), "attestation-subject-mismatch");
});

test("PROOF (wrong builder): a VALID attestation from another workflow is rejected", () => {
  const m = manifest();
  const other = attestation(m, { builderId: "https://github.com/attacker/repo/.github/workflows/release.yml@refs/heads/main" });
  assert.equal(reason(verifyForgeManifest(input(m, { attestation: other }))), "builder-identity-mismatch");
});

test("PROOF (runner substitution): a self-hosted runner cannot stand in for github-hosted", () => {
  const m = manifest();
  assert.equal(reason(verifyForgeManifest(input(m, { attestation: attestation(m, { runnerEnvironment: "self-hosted" }) }))), "builder-runner-mismatch");
});

test("PROOF 8 (unbound artifact): attested commit must equal the manifest's sourceCommit", () => {
  const m = manifest();
  assert.equal(reason(verifyForgeManifest(input(m, { attestation: attestation(m, { sourceCommit: "0".repeat(40) }) }))), "source-commit-mismatch");
});

test("an unverified attestation is rejected before anything else is trusted", () => {
  const m = manifest();
  assert.equal(reason(verifyForgeManifest(input(m, { attestation: attestation(m, { verified: false }) }))), "attestation-unverified");
});

// --- Party B: authorization -------------------------------------------------------------------------

test("PROOF (provenance is not authorization): a fully attested manifest with no owner statement is rejected", () => {
  assert.equal(reason(verifyForgeManifest(input(manifest(), { ownerAuthorization: undefined }))), "owner-authorization-missing");
});

test("an owner signature by the wrong key is rejected", () => {
  const m = manifest();
  assert.equal(reason(verifyForgeManifest(input(m, { ownerAuthorization: ownerAuth(m, { signWith: generateAgentKeyPairs().signingPrivateKey }) }))), "owner-authorization-invalid");
});

test("PROOF 2 (wrong target): an authorization for server B does not authorize server A", () => {
  const serverB = manifest({ targetServerId: "server-00000000000B", nonce: "forge-nonce-00000000B" });
  const forServerA = { ...manifest(), targetServerId: "server-00000000000A" } as ForgeDeploymentManifest;
  // Replay the statement signed for B against A.
  assert.equal(reason(verifyForgeManifest(input(forServerA, { ownerAuthorization: ownerAuth(serverB) }))), "owner-authorization-invalid");
});

test("an authorization bound to a different manifest digest does not transfer", () => {
  const m = manifest();
  assert.equal(reason(verifyForgeManifest(input(m, { ownerAuthorization: ownerAuth(m, { digest: sha("some other manifest") }) }))), "owner-authorization-invalid");
});

// --- Freshness --------------------------------------------------------------------------------------

test("PROOF 6 (stale candidate): an expired manifest and a replayed nonce are both rejected", () => {
  const m = manifest();
  assert.equal(reason(verifyForgeManifest(input(m, { now: NOW + 2 * HOUR }))), "expired");
  assert.equal(reason(verifyForgeManifest(input(m, { consumedNonces: new Set([m.nonce]) }))), "replayed-nonce");
  assert.equal(reason(verifyForgeManifest(input(m, { consumedNonces: new Set(["owner-nonce-000000001"]) }))), "replayed-nonce");
});

test("expiresAt must be after issuedAt", () => {
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ expiresAt: new Date(NOW - HOUR).toISOString() })).success, false);
});

// --- Target and shape checks ------------------------------------------------------------------------

test("PROOF 4 (MongoDB inclusion) is a preflight check, but a stateful service is still representable here", () => {
  // Deliberate: the manifest binds WHICH services may be recreated; the preflight owns the stateful
  // exclusion rule (serviceLooksStateful). This test records that division so a later reader does not
  // assume the manifest already blocks it.
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ authorizedServices: ["backend", "mongo"] })).success, true);
});

test("PROOF 7 (secret leak): credential-shaped values in any field are rejected", () => {
  const cases: Partial<ForgeDeploymentManifest>[] = [
    { sourceRepository: "https://user:hunter2@github.com/williams342-maker/operation" },
    { manifestId: "sk_live_abcdefghijklmnop" },
    { composeProjectName: "a".repeat(48) }
  ];
  for (const change of cases) {
    const m = manifest(change);
    const parsed = forgeDeploymentManifestSchema.safeParse(m);
    if (!parsed.success) continue; // rejected even earlier, by shape
    assert.ok(findSecretShapedField(m), `expected a secret-shaped finding for ${Object.keys(change)[0]}`);
    assert.equal(reason(verifyForgeManifest(input(m))), "secret-shaped-value");
  }
});

test("a legitimate manifest contains no secret-shaped field", () => {
  assert.equal(findSecretShapedField(manifest()), undefined);
});

test("images must be digest-pinned; a mutable tag is not representable", () => {
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ backendImageDigest: "ghcr.io/williams342-maker/backend:latest" })).success, false);
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ backendImageDigest: "ghcr.io/williams342-maker/backend:v0.1.2" })).success, false);
});

test("a candidate identical to its own rollback is rejected", () => {
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ rollbackBackendImageDigest: img("backend", "a") })).success, false);
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ rollbackFrontendImageDigest: img("frontend", "b") })).success, false);
});

// --- Capabilities -----------------------------------------------------------------------------------

test("a capability outside the closed protocol enum is not representable", () => {
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ requiredCapabilities: ["arbitraryShell"] as never })).success, false);
});

test("a capability the agent does not advertise is rejected", () => {
  const m = manifest({ requiredCapabilities: ["docker", "systemdActivation"] });
  assert.equal(reason(verifyForgeManifest(input(m, { agentAdvertisedCapabilities: ["docker", "compose"] }))), "capability-not-advertised");
});

test("duplicate services or capabilities are rejected", () => {
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ authorizedServices: ["backend", "backend"] })).success, false);
  assert.equal(forgeDeploymentManifestSchema.safeParse(manifest({ requiredCapabilities: ["docker", "docker"] })).success, false);
});

// --- Failure ordering -------------------------------------------------------------------------------

test("verification fails closed and never reports the first passing layer as success", () => {
  // Everything wrong at once: the reported reason must be a rejection, whichever layer fires first.
  const m = manifest();
  const decision = verifyForgeManifest({ manifest: m, manifestSha256: sha("wrong"), attestation: attestation(m, { verified: false, builderId: "https://github.com/x/y/.github/workflows/z.yml@refs/heads/main" }), ownerPublicKey: owner.signingPublicKey, agentAdvertisedCapabilities: [], now: NOW + 10 * HOUR });
  assert.equal(decision.verified, false);
});
