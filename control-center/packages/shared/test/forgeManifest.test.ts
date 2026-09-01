import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  forgeBuildManifestSchema,
  forgeTargetBindingSchema,
  forgeBuildDigest,
  forgeBuildStatement,
  forgeTargetBindingDigest,
  forgeTargetBindingStatement,
  forgeOwnerAuthorizationMessage,
  assertFlatDocument,
  findSecretShapedField,
  verifyForgeDeployment,
  type ForgeBuildManifest,
  type ForgeTargetBinding,
  type ForgeAttestationEvidence,
  type AttestedForgeBuild,
  type ForgeDeploymentVerificationInput
} from "../src/forgeManifest.js";
import { generateAgentKeyPairs, signWithAgentKey } from "../src/agentKeys.js";
import type { OwnerAuthorization } from "../src/tasks.js";

// Disposable dev owner keypair. The production owner private key is offline and never handled in-repo.
const owner = generateAgentKeyPairs();
const NOW = Date.parse("2026-09-01T00:00:00.000Z");
const HOUR = 3600_000;
const COMMIT = "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b";
const PRIOR_COMMIT = "467a3138e8c8d4cd3e397bdfa32562b09a5332f8";
const BUILDER = "https://github.com/williams342-maker/operation/.github/workflows/control-center-release.yml@refs/tags/v0.1.2-operate";
const img = (name: string, byte: string) => `ghcr.io/williams342-maker/${name}@sha256:${byte.repeat(64)}`;
const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function build(overrides: Partial<ForgeBuildManifest> = {}): ForgeBuildManifest {
  return {
    schemaVersion: "forge-build-v1",
    buildId: "forge-build-20260901-0001",
    sourceRepository: "https://github.com/williams342-maker/operation",
    sourceCommit: COMMIT,
    sourceTree: "322b1275e498aa0d4c0c1cbb0a2f2ab5f4e6d7c8",
    sourceTag: "v0.1.2-operate",
    backendImageDigest: img("backend", "a"),
    frontendImageDigest: img("frontend", "b"),
    builderIdentity: BUILDER,
    builderRunnerEnvironment: "github-hosted",
    issuedAt: new Date(NOW).toISOString(),
    ...overrides
  } as ForgeBuildManifest;
}

function priorBuild(overrides: Partial<ForgeBuildManifest> = {}): ForgeBuildManifest {
  return build({ buildId: "forge-build-20260808-0001", sourceCommit: PRIOR_COMMIT, sourceTree: "f599b3a2b078aa0d4c0c1cbb0a2f2ab5f4e6d7c8", sourceTag: "v0.1.1-operate", backendImageDigest: img("backend", "c"), frontendImageDigest: img("frontend", "d"), ...overrides });
}

function binding(candidate: ForgeBuildManifest, rollback: ForgeBuildManifest, overrides: Partial<ForgeTargetBinding> = {}): ForgeTargetBinding {
  return {
    schemaVersion: "forge-target-binding-v1",
    bindingId: "forge-binding-20260901-0001",
    buildDigest: forgeBuildDigest(candidate),
    rollbackBuildDigest: forgeBuildDigest(rollback),
    targetEnvironment: "beta",
    targetOrgId: "org-000000000001",
    targetServerId: "server-000000000001",
    composeProjectName: "opsworkbench-beta",
    authorizedServices: ["backend", "frontend"],
    requiredCapabilities: ["docker", "compose", "dockerComposeActivation"],
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + HOUR).toISOString(),
    nonce: "forge-nonce-000000001",
    ...overrides
  } as ForgeTargetBinding;
}

const bytesOf = (b: ForgeBuildManifest) => sha(JSON.stringify(b));

function attestation(b: ForgeBuildManifest, overrides: Partial<ForgeAttestationEvidence> = {}): ForgeAttestationEvidence {
  // No `verified` field exists any more: the existence of this value IS the claim, and only real
  // Sigstore verification (apps/agent/src/forgeAttestation.ts) can produce one.
  return { builderId: b.builderIdentity, runnerEnvironment: b.builderRunnerEnvironment, sourceCommit: b.sourceCommit, subjectSha256: bytesOf(b), ...overrides };
}

const attested = (b: ForgeBuildManifest, overrides: Partial<AttestedForgeBuild> = {}): AttestedForgeBuild => ({ manifest: b, manifestSha256: bytesOf(b), attestation: attestation(b), ...overrides });

function ownerAuth(bind: ForgeTargetBinding, opts: { expiresAt?: string; nonce?: string; keyVersion?: string; signWith?: string; digest?: string } = {}): OwnerAuthorization {
  const expiresAt = opts.expiresAt ?? new Date(NOW + HOUR).toISOString();
  const nonce = opts.nonce ?? "owner-nonce-000000001";
  const keyVersion = opts.keyVersion ?? "owner-v1";
  const signature = signWithAgentKey(opts.signWith ?? owner.signingPrivateKey, forgeOwnerAuthorizationMessage({
    bindingDigest: opts.digest ?? forgeTargetBindingDigest(bind), targetOrgId: bind.targetOrgId, targetServerId: bind.targetServerId, expiresAt, nonce, keyVersion
  }));
  return { signature, issuedAt: new Date(NOW).toISOString(), expiresAt, nonce, keyVersion };
}

function input(overrides: Partial<ForgeDeploymentVerificationInput> = {}): ForgeDeploymentVerificationInput {
  const candidate = build();
  const rollback = priorBuild();
  const bind = binding(candidate, rollback);
  return { candidate: attested(candidate), rollback: attested(rollback), binding: bind, ownerAuthorization: ownerAuth(bind), ownerPublicKey: owner.signingPublicKey, agentAdvertisedCapabilities: ["docker", "compose", "dockerComposeActivation", "system"], now: NOW, ...overrides };
}

const reason = (d: ReturnType<typeof verifyForgeDeployment>) => (d as { reason: string }).reason;

test("an attested candidate, an attested rollback, and an owner-authorized binding verify", () => {
  const decision = verifyForgeDeployment(input());
  assert.equal(decision.verified, true);
});

// --- The split --------------------------------------------------------------------------------------

test("a build carries NO target — a target is not knowable at build time", () => {
  for (const field of ["targetServerId", "targetOrgId", "targetEnvironment", "composeProjectName"]) {
    assert.equal(forgeBuildManifestSchema.safeParse({ ...build(), [field]: "x" }).success, false, `build must not accept ${field}`);
  }
});

test("a build carries no expiry and no nonce — it is a permanent fact, not an authorization", () => {
  assert.equal(forgeBuildManifestSchema.safeParse({ ...build(), expiresAt: new Date(NOW + HOUR).toISOString() }).success, false);
  assert.equal(forgeBuildManifestSchema.safeParse({ ...build(), nonce: "forge-nonce-000000001" }).success, false);
  // The same build stays verifiable long after it was made; only the binding expires.
  const decision = verifyForgeDeployment(input({ now: NOW + 30 * 24 * HOUR }));
  assert.equal(reason(decision), "expired", "the BINDING expires, and that is what stops an old build being deployed");
});

test("a binding authorizes the build it names, not whichever build is handed alongside it", () => {
  const candidate = build();
  const other = build({ buildId: "forge-build-20260901-9999", backendImageDigest: img("backend", "e") });
  const rollback = priorBuild();
  const bind = binding(candidate, rollback);
  // Same binding, different candidate presented.
  assert.equal(reason(verifyForgeDeployment(input({ candidate: attested(other), binding: bind, ownerAuthorization: ownerAuth(bind) }))), "binding-build-mismatch");
});

test("a substituted rollback is caught by the binding join", () => {
  const candidate = build();
  const rollback = priorBuild();
  const otherRollback = priorBuild({ buildId: "forge-build-20260807-0001", backendImageDigest: img("backend", "f") });
  const bind = binding(candidate, rollback);
  assert.equal(reason(verifyForgeDeployment(input({ rollback: attested(otherRollback), binding: bind, ownerAuthorization: ownerAuth(bind) }))), "binding-rollback-mismatch");
});

test("PROOF: the rollback build is held to the SAME provenance standard as the candidate", () => {
  const rollback = priorBuild();
  // An unattested rollback is how a "safe" rollback becomes the delivery mechanism.
  assert.equal(reason(verifyForgeDeployment(input({ rollback: attested(rollback, { attestation: attestation(rollback, { builderId: "https://github.com/attacker/repo/.github/workflows/x.yml@refs/heads/main" }) }) }))), "builder-identity-mismatch");
  assert.equal(reason(verifyForgeDeployment(input({ rollback: attested(rollback, { manifestSha256: sha("tampered") }) }))), "attestation-subject-mismatch");
});

test("a candidate that is its own rollback is rejected", () => {
  const candidate = build();
  assert.equal(forgeTargetBindingSchema.safeParse(binding(candidate, candidate)).success, false);
});

// --- Canonicalization -------------------------------------------------------------------------------

test("canonical statements are ordered joins, stable under key reordering", () => {
  const b = build();
  const reorderedBuild = Object.fromEntries(Object.entries(b).reverse()) as ForgeBuildManifest;
  assert.equal(forgeBuildDigest(b), forgeBuildDigest(reorderedBuild));
  assert.equal(forgeBuildStatement(b).split("\n").length, 13);

  const bind = binding(b, priorBuild());
  const reorderedBinding = Object.fromEntries(Object.entries(bind).reverse()) as ForgeTargetBinding;
  assert.equal(forgeTargetBindingDigest(bind), forgeTargetBindingDigest(reorderedBinding));
  assert.equal(forgeTargetBindingStatement(bind).split("\n").length, 13);
});

test("REGRESSION: the replacer idiom would collide here; the ordered join does not", () => {
  // The hazard, reproduced directly: JSON.stringify's array replacer is an allowlist applied to EVERY
  // object in the graph, so nested keys vanish silently and two different targets digest the same.
  const nestedA = { schemaVersion: "x", target: { env: "beta", server: "AAA" } };
  const nestedB = { schemaVersion: "x", target: { env: "beta", server: "BBB" } };
  const keys = Object.keys(nestedA).sort();
  assert.equal(JSON.stringify(nestedA, keys), JSON.stringify(nestedB, keys), "precondition: the replacer idiom collides on nested input");

  // Both forge documents are flat and ordered-joined, so the same distinction survives.
  const c = build();
  const r = priorBuild();
  assert.notEqual(forgeTargetBindingDigest(binding(c, r, { targetServerId: "server-00000000000A" })), forgeTargetBindingDigest(binding(c, r, { targetServerId: "server-00000000000B" })));
});

test("every build field participates in the build digest", () => {
  const changes: Partial<ForgeBuildManifest>[] = [
    { buildId: "forge-build-20260901-0002" }, { sourceRepository: "https://github.com/williams342-maker/other" },
    { sourceCommit: "0".repeat(40) }, { sourceTree: "1".repeat(40) }, { sourceTag: "v0.1.1-operate" },
    { backendImageDigest: img("backend", "e") }, { frontendImageDigest: img("frontend", "e") },
    { releaseBundleSha256: "f".repeat(64) }, { releaseManifestDigest: "e".repeat(64) },
    { builderIdentity: "https://github.com/other/repo/.github/workflows/x.yml@refs/heads/main" },
    { builderRunnerEnvironment: "self-hosted" }, { issuedAt: new Date(NOW - HOUR).toISOString() }
  ];
  const seen = new Set([forgeBuildDigest(build())]);
  for (const change of changes) {
    const digest = forgeBuildDigest(build(change));
    assert.ok(!seen.has(digest), `changing ${Object.keys(change)[0]} did not change the build digest`);
    seen.add(digest);
  }
});

test("every binding field participates in the binding digest", () => {
  const c = build();
  const r = priorBuild();
  const other = priorBuild({ buildId: "forge-build-20260806-0001", backendImageDigest: img("backend", "9") });
  const changes: Partial<ForgeTargetBinding>[] = [
    { bindingId: "forge-binding-20260901-0002" }, { rollbackBuildDigest: forgeBuildDigest(other) },
    { targetEnvironment: "staging" }, { targetOrgId: "org-000000000002" }, { targetServerId: "server-000000000002" },
    { composeProjectName: "other-project" }, { authorizedServices: ["backend"] }, { requiredCapabilities: ["docker"] },
    { issuedAt: new Date(NOW - HOUR).toISOString() }, { expiresAt: new Date(NOW + 2 * HOUR).toISOString() },
    { nonce: "forge-nonce-000000002" }
  ];
  const seen = new Set([forgeTargetBindingDigest(binding(c, r))]);
  for (const change of changes) {
    const digest = forgeTargetBindingDigest(binding(c, r, change));
    assert.ok(!seen.has(digest), `changing ${Object.keys(change)[0]} did not change the binding digest`);
    seen.add(digest);
  }
});

test("an absent optional is unambiguous — it cannot collide with a present value", () => {
  const without = build();
  delete (without as Partial<ForgeBuildManifest>).sourceTag;
  assert.notEqual(forgeBuildDigest(without), forgeBuildDigest(build({ sourceTag: "v0.1.2-operate" })));
  assert.ok(forgeBuildStatement(without).includes("\n\n"), "absent optional serializes as an empty field");
});

test("array order carries no meaning and does not change the digest", () => {
  const c = build();
  const r = priorBuild();
  assert.equal(forgeTargetBindingDigest(binding(c, r, { authorizedServices: ["backend", "frontend"] })), forgeTargetBindingDigest(binding(c, r, { authorizedServices: ["frontend", "backend"] })));
});

// --- Flatness ---------------------------------------------------------------------------------------

test("PROOF: a nested document is rejected at schema level", () => {
  const nestedBuild = { ...build(), sourceCommit: { sha: COMMIT } };
  assert.equal(forgeBuildManifestSchema.safeParse(nestedBuild).success, false);
  assert.equal(reason(verifyForgeDeployment({ ...input(), candidate: { manifest: nestedBuild, manifestSha256: sha("x"), attestation: attestation(build()) } })), "candidate-build-invalid");

  const c = build();
  const nestedBinding = { ...binding(c, priorBuild()), targetServerId: { id: "server-000000000001" } };
  assert.equal(forgeTargetBindingSchema.safeParse(nestedBinding).success, false);
  assert.equal(reason(verifyForgeDeployment({ ...input(), binding: nestedBinding })), "binding-invalid");
});

test("the flatness guard catches a nested field a future schema edit might allow", () => {
  const order = ["schemaVersion", "buildId"];
  assert.throws(() => assertFlatDocument({ schemaVersion: "x", buildId: { nested: true } }, order), /not flat/);
  assert.throws(() => assertFlatDocument({ schemaVersion: "x", buildId: [{ n: 1 }] }, order), /not flat/);
  assert.throws(() => assertFlatDocument({ schemaVersion: "x", buildId: null }, order), /not flat/);
});

test("a field outside the canonical order is refused rather than signed around", () => {
  // A field the schema accepted but the ordered join omits would be present in the document and absent
  // from the digest — signed around. Fail closed instead.
  assert.throws(() => assertFlatDocument({ schemaVersion: "x", undeclared: "value" }, ["schemaVersion"]), /outside the canonical field order/);
});

test("separator injection cannot forge extra fields", () => {
  assert.equal(forgeBuildManifestSchema.safeParse(build({ buildId: "a\nb" })).success, false);
  assert.equal(forgeTargetBindingSchema.safeParse(binding(build(), priorBuild(), { composeProjectName: "a,b" })).success, false);
});

test("an invalid document is never digestible — a bad document cannot be signed at all", () => {
  assert.throws(() => forgeBuildDigest({ ...build(), backendImageDigest: "ghcr.io/x/y:latest" } as ForgeBuildManifest));
  assert.throws(() => forgeTargetBindingDigest({ ...binding(build(), priorBuild()), targetServerId: "short" } as ForgeTargetBinding));
});

// --- Party A: provenance ----------------------------------------------------------------------------

test("PROOF 1 (tamper): a build that is not the attestation's subject is rejected", () => {
  assert.equal(reason(verifyForgeDeployment(input({ candidate: attested(build(), { manifestSha256: sha("tampered") }) }))), "attestation-subject-mismatch");
});

test("PROOF (wrong builder): a VALID attestation from another workflow is rejected", () => {
  const c = build();
  assert.equal(reason(verifyForgeDeployment(input({ candidate: attested(c, { attestation: attestation(c, { builderId: "https://github.com/attacker/repo/.github/workflows/release.yml@refs/heads/main" }) }) }))), "builder-identity-mismatch");
});

test("PROOF (runner substitution): a self-hosted runner cannot stand in for github-hosted", () => {
  const c = build();
  assert.equal(reason(verifyForgeDeployment(input({ candidate: attested(c, { attestation: attestation(c, { runnerEnvironment: "self-hosted" }) }) }))), "builder-runner-mismatch");
});

test("PROOF 8 (unbound artifact): attested commit must equal the build's sourceCommit", () => {
  const c = build();
  assert.equal(reason(verifyForgeDeployment(input({ candidate: attested(c, { attestation: attestation(c, { sourceCommit: "0".repeat(40) }) }) }))), "source-commit-mismatch");
});

test("REMEDIATION: there is no operator-settable verification flag left to trust", () => {
  // The previous design accepted `verified: true` from a JSON file, which let the same operator who
  // supplied every other document also play Party A. An independent review called that the central
  // design failure. The field is gone; evidence is now constructed only from a real Sigstore bundle
  // verification, proven in apps/agent/test/forgeAttestation.test.ts against a genuine published bundle.
  const m = build();
  const evidence = attestation(m) as Record<string, unknown>;
  assert.equal("verified" in evidence, false, "ForgeAttestationEvidence must carry no verification flag");
  // A subject digest that does not match the document is still rejected — that check is what ties the
  // attestation to the bytes actually read.
  assert.equal(reason(verifyForgeDeployment(input({ candidate: attested(m, { manifestSha256: sha("elsewhere") }) }))), "attestation-subject-mismatch");
});

// --- Party B: authorization -------------------------------------------------------------------------

test("PROOF (provenance is not authorization): fully attested builds with no owner statement are rejected", () => {
  assert.equal(reason(verifyForgeDeployment(input({ ownerAuthorization: undefined }))), "owner-authorization-missing");
});

test("an owner signature by the wrong key is rejected", () => {
  const bind = binding(build(), priorBuild());
  assert.equal(reason(verifyForgeDeployment(input({ binding: bind, ownerAuthorization: ownerAuth(bind, { signWith: generateAgentKeyPairs().signingPrivateKey }) }))), "owner-authorization-invalid");
});

test("PROOF 2 (wrong target): an authorization for server B does not authorize server A", () => {
  const c = build();
  const r = priorBuild();
  const forB = binding(c, r, { targetServerId: "server-00000000000B" });
  const forA = binding(c, r, { targetServerId: "server-00000000000A" });
  // Replay the statement signed for B against A.
  assert.equal(reason(verifyForgeDeployment(input({ binding: forA, ownerAuthorization: ownerAuth(forB) }))), "owner-authorization-invalid");
});

test("an authorization bound to a different binding digest does not transfer", () => {
  const bind = binding(build(), priorBuild());
  assert.equal(reason(verifyForgeDeployment(input({ binding: bind, ownerAuthorization: ownerAuth(bind, { digest: sha("some other binding") }) }))), "owner-authorization-invalid");
});

// --- Freshness --------------------------------------------------------------------------------------

test("PROOF 6 (stale candidate): an expired binding and a replayed nonce are both rejected", () => {
  assert.equal(reason(verifyForgeDeployment(input({ now: NOW + 2 * HOUR }))), "expired");
  assert.equal(reason(verifyForgeDeployment(input({ consumedNonces: new Set(["forge-nonce-000000001"]) }))), "replayed-nonce");
  assert.equal(reason(verifyForgeDeployment(input({ consumedNonces: new Set(["owner-nonce-000000001"]) }))), "replayed-nonce");
});

test("expiresAt must be after issuedAt", () => {
  assert.equal(forgeTargetBindingSchema.safeParse(binding(build(), priorBuild(), { expiresAt: new Date(NOW - HOUR).toISOString() })).success, false);
});

// --- Shape checks -----------------------------------------------------------------------------------

test("PROOF 4 (MongoDB inclusion) stays a preflight check, not a binding check", () => {
  // Deliberate: the binding names WHICH services may be recreated; the preflight owns the stateful
  // exclusion rule (serviceLooksStateful). This test records that division so a later reader does not
  // assume the binding already blocks it.
  assert.equal(forgeTargetBindingSchema.safeParse(binding(build(), priorBuild(), { authorizedServices: ["backend", "mongo"] })).success, true);
});

test("PROOF 7 (secret leak): credential-shaped values in any field are rejected", () => {
  const leaky = build({ sourceRepository: "https://user:hunter2@github.com/williams342-maker/operation" });
  assert.equal(findSecretShapedField(leaky), "sourceRepository");
  assert.equal(reason(verifyForgeDeployment(input({ candidate: attested(leaky) }))), "secret-shaped-value");

  const leakyBinding = binding(build(), priorBuild(), { bindingId: "sk_live_abcdefghijklmnop" });
  assert.equal(findSecretShapedField(leakyBinding), "bindingId");
  assert.equal(reason(verifyForgeDeployment(input({ binding: leakyBinding }))), "secret-shaped-value");
});

test("legitimate documents contain no secret-shaped field", () => {
  assert.equal(findSecretShapedField(build()), undefined);
  assert.equal(findSecretShapedField(binding(build(), priorBuild())), undefined);
});

test("images must be digest-pinned; a mutable tag is not representable", () => {
  assert.equal(forgeBuildManifestSchema.safeParse(build({ backendImageDigest: "ghcr.io/williams342-maker/backend:latest" })).success, false);
  assert.equal(forgeBuildManifestSchema.safeParse(build({ backendImageDigest: "ghcr.io/williams342-maker/backend:v0.1.2" })).success, false);
});

test("a build whose backend and frontend images are identical is rejected", () => {
  assert.equal(forgeBuildManifestSchema.safeParse(build({ frontendImageDigest: img("backend", "a") })).success, false);
});

// --- Capabilities -----------------------------------------------------------------------------------

test("a capability outside the closed protocol enum is not representable", () => {
  assert.equal(forgeTargetBindingSchema.safeParse(binding(build(), priorBuild(), { requiredCapabilities: ["arbitraryShell"] as never })).success, false);
});

test("a capability the agent does not advertise is rejected", () => {
  const bind = binding(build(), priorBuild(), { requiredCapabilities: ["docker", "systemdActivation"] });
  assert.equal(reason(verifyForgeDeployment(input({ binding: bind, ownerAuthorization: ownerAuth(bind), agentAdvertisedCapabilities: ["docker", "compose"] }))), "capability-not-advertised");
});

test("duplicate services or capabilities are rejected", () => {
  assert.equal(forgeTargetBindingSchema.safeParse(binding(build(), priorBuild(), { authorizedServices: ["backend", "backend"] })).success, false);
  assert.equal(forgeTargetBindingSchema.safeParse(binding(build(), priorBuild(), { requiredCapabilities: ["docker", "docker"] })).success, false);
});

// --- Failure ordering -------------------------------------------------------------------------------

test("verification fails closed and never reports the first passing layer as success", () => {
  const c = build();
  const decision = verifyForgeDeployment({
    candidate: attested(c, { manifestSha256: sha("wrong"), attestation: attestation(c, { verified: false }) }),
    rollback: attested(priorBuild()),
    binding: binding(c, priorBuild()),
    ownerPublicKey: owner.signingPublicKey,
    agentAdvertisedCapabilities: [],
    now: NOW + 10 * HOUR
  });
  assert.equal(decision.verified, false);
});
