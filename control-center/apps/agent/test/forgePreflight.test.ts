import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BETA_STARTUP_SAFETY_FLAGS, runBetaDeploymentPreflight, type BetaDeploymentPreflightInput, type ImageInspection } from "../src/betaDeploymentPreflight.js";
import { forgeBuildDigest, forgeTargetBindingDigest, generateAgentKeyPairs, type ForgeBuildManifest, type ForgeTargetBinding } from "@control-center/shared";
import type { ForgeEvidenceOutcome } from "../src/forgePreflightEvidence.js";

// Forge evidence at the preflight layer — docs/forge-manifest-spec.md §8.2 and §9.
//
// The schema-layer proofs live in packages/shared/test/forgeManifest.test.ts. These are the proofs that
// only exist once the gate is integrated: a document can be internally perfect and still not describe
// the deployment actually in front of us. A proof against the pure function is not a proof against the
// integrated gate.

const flags = Object.fromEntries(BETA_STARTUP_SAFETY_FLAGS.map((name) => [name, "false"]));
const owner = generateAgentKeyPairs();
const NOW = new Date("2026-09-01T00:00:00.000Z");
const COMMIT = "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b";
const PRIOR_COMMIT = "467a3138e8c8d4cd3e397bdfa32562b09a5332f8";
const BUILDER = "https://github.com/williams342-maker/operation/.github/workflows/control-center-images.yml@refs/tags/v0.1.2-operate";
const CANDIDATE_BACKEND = `ghcr.io/williams342-maker/operation/control-center-api@sha256:${"a".repeat(64)}`;
const CANDIDATE_FRONTEND = `ghcr.io/williams342-maker/operation/control-center-web@sha256:${"b".repeat(64)}`;
const CANDIDATE_ADMIN = `ghcr.io/williams342-maker/operation/control-center-admin-web@sha256:${"e".repeat(64)}`;
const CANDIDATE_GATE = `ghcr.io/williams342-maker/operation/review-gate@sha256:${"1".repeat(64)}`;
const ROLLBACK_BACKEND = `ghcr.io/williams342-maker/operation/control-center-api@sha256:${"c".repeat(64)}`;
const ROLLBACK_FRONTEND = `ghcr.io/williams342-maker/operation/control-center-web@sha256:${"d".repeat(64)}`;
const ROLLBACK_ADMIN = `ghcr.io/williams342-maker/operation/control-center-admin-web@sha256:${"f".repeat(64)}`;
const ROLLBACK_GATE = `ghcr.io/williams342-maker/operation/review-gate@sha256:${"2".repeat(64)}`;

const buildManifest = (over: Partial<ForgeBuildManifest> = {}): ForgeBuildManifest => ({
  schemaVersion: "forge-build-v2", buildId: "forge-build-20260901-0001",
  sourceRepository: "https://github.com/williams342-maker/operation",
  sourceCommit: COMMIT, sourceTree: "322b1275e498aa0d4c0c1cbb0a2f2ab5f4e6d7c8", sourceTag: "v0.1.2-operate",
  backendImageDigest: CANDIDATE_BACKEND, frontendImageDigest: CANDIDATE_FRONTEND, adminImageDigest: CANDIDATE_ADMIN, reviewGateImageDigest: CANDIDATE_GATE,
  builderIdentity: BUILDER, builderRunnerEnvironment: "github-hosted", issuedAt: NOW.toISOString(), ...over
} as ForgeBuildManifest);

const rollbackManifest = (over: Partial<ForgeBuildManifest> = {}): ForgeBuildManifest => buildManifest({
  buildId: "forge-build-20260808-0001", sourceCommit: PRIOR_COMMIT, sourceTree: "f599b3a2b078aa0d4c0c1cbb0a2f2ab5f4e6d7c8",
  sourceTag: "v0.1.1-operate", backendImageDigest: ROLLBACK_BACKEND, frontendImageDigest: ROLLBACK_FRONTEND, adminImageDigest: ROLLBACK_ADMIN, reviewGateImageDigest: ROLLBACK_GATE, ...over
});

function fixture(options: { candidate?: ForgeBuildManifest; rollback?: ForgeBuildManifest; binding?: Partial<ForgeTargetBinding>; evidence?: ForgeEvidenceOutcome; omit?: string[]; revisions?: Record<string, string | undefined>; actualOrgId?: string; actualServerId?: string; consumedNonces?: string[] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-forge-preflight-"));
  const env = path.join(root, ".env.beta");
  const compose = path.join(root, "compose.yml");
  const override = path.join(root, "images.json");
  const rollbackOverride = path.join(root, "rollback-images.json");
  fs.writeFileSync(env, `APP_ENV=beta\nENVIRONMENT=beta\n${BETA_STARTUP_SAFETY_FLAGS.map((name) => `${name}=false`).join("\n")}\n`);
  fs.writeFileSync(compose, "services:\n  backend:\n    image: x\n  frontend:\n    image: y\n  admin:\n    image: z\n");
  fs.writeFileSync(override, `${JSON.stringify({ services: { backend: { image: CANDIDATE_BACKEND }, frontend: { image: CANDIDATE_FRONTEND }, admin: { image: CANDIDATE_ADMIN } } }, null, 2)}\n`);
  fs.writeFileSync(rollbackOverride, `${JSON.stringify({ services: { backend: { image: ROLLBACK_BACKEND }, frontend: { image: ROLLBACK_FRONTEND }, admin: { image: ROLLBACK_ADMIN } } }, null, 2)}\n`);

  const candidate = options.candidate ?? buildManifest();
  const rollback = options.rollback ?? rollbackManifest();
  const binding: ForgeTargetBinding = {
    schemaVersion: "forge-target-binding-v1", bindingId: "forge-binding-20260901-0001",
    buildDigest: forgeBuildDigest(candidate), rollbackBuildDigest: forgeBuildDigest(rollback),
    targetEnvironment: "beta", targetOrgId: "org-000000000001", targetServerId: "server-000000000001",
    composeProjectName: "opsworkbench-beta", authorizedServices: ["backend", "frontend", "admin"],
    requiredCapabilities: ["docker", "compose"], issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(), nonce: "forge-nonce-000000001",
    ...options.binding
  } as ForgeTargetBinding;

  // Evidence is injected through the hook seam. Real Sigstore verification is proven separately in
  // forgeAttestation.test.ts against a genuine published bundle; these tests prove everything
  // DOWNSTREAM of that verification, which is where the integrated gate lives.
  const paths: Record<string, string> = {
    forgeCandidateBuildPath: path.join(root, "candidate-build.json"),
    forgeCandidateAttestationPath: path.join(root, "candidate-bundle.json"),
    forgeRollbackBuildPath: path.join(root, "rollback-build.json"),
    forgeRollbackAttestationPath: path.join(root, "rollback-bundle.json"),
    forgeTargetBindingPath: path.join(root, "binding.json"),
    forgeOwnerAuthorizationPath: path.join(root, "owner-authorization.json"),
  };
  for (const key of options.omit || []) delete paths[key];
  const evidence: ForgeEvidenceOutcome = options.evidence ?? {
    state: "verified", candidate, rollback, binding, bindingDigest: forgeTargetBindingDigest(binding),
    nonces: [binding.nonce, "owner-nonce-000000001"],
  };
  const verifyEvidence = (given: Record<string, unknown>, context: { consumedNonces?: ReadonlySet<string> }): ForgeEvidenceOutcome => {
    const required = ["forgeCandidateBuildPath", "forgeCandidateAttestationPath", "forgeRollbackBuildPath", "forgeRollbackAttestationPath", "forgeTargetBindingPath", "forgeOwnerAuthorizationPath"];
    if (!required.some((key) => given[key])) return { state: "absent" };
    const missing = required.filter((key) => !given[key]);
    if (missing.length) return { state: "incomplete", missing };
    if (evidence.state === "verified" && evidence.nonces.some((nonce) => context.consumedNonces?.has(nonce))) return { state: "rejected", reason: "replayed-nonce" };
    return evidence;
  };

  const input: BetaDeploymentPreflightInput = {
    targetEnvironment: "beta", composeWorkingDirectory: root, composeProjectName: "opsworkbench-beta",
    composeFilePath: compose, environmentFilePath: env, composeOverrideFilePath: override,
    rollbackComposeOverrideFilePath: rollbackOverride,
    authorizedBackendImage: CANDIDATE_BACKEND, authorizedFrontendImage: CANDIDATE_FRONTEND,
    authorizedAdminImage: CANDIDATE_ADMIN, rollbackBackendImage: ROLLBACK_BACKEND, rollbackFrontendImage: ROLLBACK_FRONTEND,
    rollbackAdminImage: ROLLBACK_ADMIN, authorizedServices: ["backend", "frontend", "admin"], allowedComposeServices: ["backend", "frontend", "admin"],
    allowedHostnames: [], allowedDatabaseDestinations: [{ hostname: "mongo", databaseName: "beta" }],
    agentAdvertisedCapabilities: ["docker", "compose", "dockerComposeActivation"],
    actualOrgId: options.actualOrgId ?? "org-000000000001",
    actualServerId: options.actualServerId ?? "server-000000000001",
    consumedNonces: options.consumedNonces,
    ...paths,
  };

  const revisions = { candidateBackend: COMMIT, candidateFrontend: COMMIT, candidateAdmin: COMMIT, rollbackBackend: PRIOR_COMMIT, rollbackFrontend: PRIOR_COMMIT, rollbackAdmin: PRIOR_COMMIT, ...options.revisions };
  const model = { name: "opsworkbench-beta", services: {
    backend: { image: CANDIDATE_BACKEND, environment: { APP_ENV: "beta", ENVIRONMENT: "beta", ...flags, MONGO_URL: "mongodb://mongo:27017/beta" } },
    frontend: { image: CANDIDATE_FRONTEND, environment: {} },
    admin: { image: CANDIDATE_ADMIN, environment: {} },
  } };
  const images: Record<string, ImageInspection> = {
    [CANDIDATE_BACKEND]: { id: "sha256:cb", repoTags: [], revision: revisions.candidateBackend },
    [CANDIDATE_FRONTEND]: { id: "sha256:cf", repoTags: [], revision: revisions.candidateFrontend },
    [CANDIDATE_ADMIN]: { id: "sha256:ca", repoTags: [], revision: revisions.candidateAdmin },
    [ROLLBACK_BACKEND]: { id: "sha256:rb", repoTags: [], revision: revisions.rollbackBackend },
    [ROLLBACK_FRONTEND]: { id: "sha256:rf", repoTags: [], revision: revisions.rollbackFrontend },
    [ROLLBACK_ADMIN]: { id: "sha256:ra", repoTags: [], revision: revisions.rollbackAdmin },
  };
  const hooks = {
    now: () => NOW,
    verifyEvidence,
    composeConfig: async () => ({ code: 0, stdout: JSON.stringify(model), stderr: "" }),
    inspectImage: async (image: string) => images[image] || null,
  };
  return { root, input, hooks, paths, candidate, rollback, binding };
}

const failed = (result: Awaited<ReturnType<typeof runBetaDeploymentPreflight>>, name: string) =>
  result.checks.some((check) => check.name === name && !check.passed);

test("complete, verified Forge evidence still stops at operator approval", async () => {
  const item = fixture();
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "PASS — awaiting operator approval");
  // Verified evidence changes BLOCKED to awaiting-approval. It does not deploy and it does not approve.
  assert.equal(result.report.operatorApprovalStatus, "awaiting");
  assert.equal(result.report.forge?.state, "verified");
  assert.equal(result.report.forge?.sourceCommit, COMMIT);
  assert.equal(result.report.forge?.rollbackSourceCommit, PRIOR_COMMIT);
  assert.equal(result.report.forge?.builderIdentity, BUILDER);
});

test("INERT: with no Forge paths the preflight behaves exactly as before", async () => {
  const item = fixture();
  for (const key of Object.keys(item.paths)) delete (item.input as Record<string, unknown>)[key];
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "PASS — awaiting operator approval");
  // "Exactly as before" is asserted literally: the report carries no `forge` key, so a consumer written
  // against pre-Forge reports sees no difference at all. `{state:"absent"}` was still a difference.
  assert.equal(result.report.forge, undefined);
  assert.equal("forge" in result.report, false, "an unused feature must not appear in the report");
  assert.equal(result.checks.some((check) => check.name.startsWith("forge_")), false, "no forge check should run");
});

test("PROOF 8 (unbound artifact): an image whose revision label differs from the attested commit blocks", async () => {
  for (const role of ["candidateBackend", "candidateFrontend", "rollbackBackend", "rollbackFrontend"] as const) {
    const item = fixture({ revisions: { [role]: "0".repeat(40) } });
    const result = await runBetaDeploymentPreflight(item.input, item.hooks);
    assert.equal(result.status, "BLOCKED", `${role} mismatch must block`);
    assert.ok(failed(result, "forge_build_provenance"), `${role} must fail forge_build_provenance`);
  }
});

test("PROOF 8b: an image carrying NO revision label blocks — absence is not a pass", async () => {
  const item = fixture({ revisions: { candidateBackend: undefined } });
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.ok(failed(result, "forge_build_provenance"));
});

test("PROOF 3 (wrong environment): a binding for another environment blocks", async () => {
  const item = fixture({ binding: { targetEnvironment: "staging" } });
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.ok(failed(result, "forge_binding_target"));
});

test("a binding for another Compose project or a different service set blocks", async () => {
  for (const change of [{ composeProjectName: "someone-elses-project" }, { authorizedServices: ["backend"] }]) {
    const item = fixture({ binding: change as Partial<ForgeTargetBinding> });
    const result = await runBetaDeploymentPreflight(item.input, item.hooks);
    assert.equal(result.status, "BLOCKED");
    assert.ok(failed(result, "forge_binding_target"));
  }
});

test("candidate or rollback images that are not the attested pinned digests block", async () => {
  // Substitute an image everywhere the OPERATOR controls it — input, override file, and resolved model —
  // so the run reaches the Forge check instead of stopping at override validation. The only remaining
  // inconsistency is then exactly the one under test: the operator plan disagrees with the attested
  // build. That is the realistic shape of the attack; a substitution that fails the older checks was
  // already caught before Forge existed.
  const substitute = `ghcr.io/williams342-maker/operation/control-center-api@sha256:${"e".repeat(64)}`;
  const swapped = fixture();
  swapped.input.authorizedBackendImage = substitute;
  fs.writeFileSync(swapped.input.composeOverrideFilePath, `${JSON.stringify({ services: { backend: { image: substitute }, frontend: { image: CANDIDATE_FRONTEND }, admin: { image: CANDIDATE_ADMIN } } }, null, 2)}\n`);
  const swappedHooks = { ...swapped.hooks, composeConfig: async () => ({ code: 0, stdout: JSON.stringify({ name: "opsworkbench-beta", services: { backend: { image: substitute, environment: { APP_ENV: "beta", ENVIRONMENT: "beta", ...flags, MONGO_URL: "mongodb://mongo:27017/beta" } }, frontend: { image: CANDIDATE_FRONTEND, environment: {} }, admin: { image: CANDIDATE_ADMIN, environment: {} } } }), stderr: "" }), inspectImage: async (image: string) => (image === substitute ? { id: "sha256:sub", repoTags: [], revision: COMMIT } : swapped.hooks.inspectImage(image)) };
  const a = await runBetaDeploymentPreflight(swapped.input, swappedHooks);
  assert.equal(a.status, "BLOCKED");
  assert.ok(failed(a, "forge_binding_images"), "candidate image must be checked against the attested build");

  // The rollback image is not in the resolved model, so substituting it reaches the Forge check directly
  // once the rollback override agrees with the input.
  const rollbackSubstitute = `ghcr.io/williams342-maker/operation/control-center-api@sha256:${"f".repeat(64)}`;
  const rollback = fixture();
  rollback.input.rollbackBackendImage = rollbackSubstitute;
  // Optional on the type, always set by the fixture. Assert it rather than assume it, so a fixture
  // change fails loudly here instead of writing to `undefined`.
  const rollbackOverridePath = rollback.input.rollbackComposeOverrideFilePath;
  assert.ok(rollbackOverridePath, "the fixture must supply a rollback compose override path");
  fs.writeFileSync(rollbackOverridePath, `${JSON.stringify({ services: { backend: { image: rollbackSubstitute }, frontend: { image: ROLLBACK_FRONTEND }, admin: { image: ROLLBACK_ADMIN } } }, null, 2)}\n`);
  const rollbackHooks = { ...rollback.hooks, inspectImage: async (image: string) => (image === rollbackSubstitute ? { id: "sha256:rsub", repoTags: [], revision: PRIOR_COMMIT } : rollback.hooks.inspectImage(image)) };
  const b = await runBetaDeploymentPreflight(rollback.input, rollbackHooks);
  assert.equal(b.status, "BLOCKED");
  assert.ok(failed(b, "forge_binding_rollback_images"), "rollback image must be checked against the attested rollback build");
});

test("PARTIAL EVIDENCE NEVER PASSES: omitting any single document blocks", async () => {
  for (const key of ["forgeCandidateBuildPath", "forgeCandidateAttestationPath", "forgeRollbackBuildPath", "forgeRollbackAttestationPath", "forgeTargetBindingPath", "forgeOwnerAuthorizationPath"]) {
    const item = fixture({ omit: [key] });
    const result = await runBetaDeploymentPreflight(item.input, item.hooks);
    assert.equal(result.status, "BLOCKED", `omitting ${key} must block`);
    assert.ok(failed(result, "forge_evidence"), `omitting ${key} must fail forge_evidence`);
  }
});

test("PROOF (provenance is not authorization): attested builds without the owner statement block", async () => {
  const item = fixture({ omit: ["forgeOwnerAuthorizationPath"] });
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.notEqual(result.report.forge?.state, "verified");
});

test("any evidence rejection surfaces as a block, whatever the cryptographic cause", async () => {
  // Tamper, wrong builder, runner substitution, expiry, replay and capability all arrive here as a
  // rejected outcome. The CRYPTOGRAPHIC proofs live in forgeAttestation.test.ts, against a genuine
  // published Sigstore bundle — this asserts the gate refuses to proceed on any of them.
  for (const reason of ["attestation-subject-mismatch", "attestation-invalid", "builder-identity-mismatch", "builder-runner-mismatch", "source-commit-mismatch", "expired", "replayed-nonce", "capability-not-advertised", "owner-authorization-invalid"]) {
    const item = fixture({ evidence: { state: "rejected", reason } });
    const result = await runBetaDeploymentPreflight(item.input, item.hooks);
    assert.equal(result.status, "BLOCKED", `${reason} must block`);
    assert.ok(failed(result, "forge_evidence"), `${reason} must fail forge_evidence`);
    assert.equal(result.report.forge?.state, "rejected");
  }
});

test("BLOCKER (2026-09-01 review): an authorization for another server does not pass on this host", async () => {
  // Signing a target id creates no binding unless the verifier MEASURES the target and compares. The
  // actual identity comes from the agent's own configuration, never from operator input.
  const otherServer = fixture({ actualServerId: "server-00000000000B" });
  const a = await runBetaDeploymentPreflight(otherServer.input, otherServer.hooks);
  assert.equal(a.status, "BLOCKED");
  assert.ok(failed(a, "forge_binding_identity"), "a binding for another server must be rejected");

  const otherOrg = fixture({ actualOrgId: "org-00000000000B" });
  const b = await runBetaDeploymentPreflight(otherOrg.input, otherOrg.hooks);
  assert.equal(b.status, "BLOCKED");
  assert.ok(failed(b, "forge_binding_identity"), "a binding for another organization must be rejected");

  // And the host must know who it is at all — an unmeasured target cannot be compared.
  const unknown = fixture();
  delete (unknown.input as Record<string, unknown>).actualServerId;
  const c = await runBetaDeploymentPreflight(unknown.input, unknown.hooks);
  assert.equal(c.status, "BLOCKED");
  assert.ok(failed(c, "forge_binding_identity"));
});

test("BLOCKER (2026-09-01 review): a consumed nonce is refused on replay", async () => {
  const first = fixture();
  assert.equal((await runBetaDeploymentPreflight(first.input, first.hooks)).status, "PASS — awaiting operator approval");
  // Second presentation of the same authorization, with the nonce recorded as consumed.
  const replay = fixture({ consumedNonces: ["forge-nonce-000000001"] });
  const result = await runBetaDeploymentPreflight(replay.input, replay.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.ok(failed(result, "forge_evidence"));

  const ownerReplay = fixture({ consumedNonces: ["owner-nonce-000000001"] });
  assert.equal((await runBetaDeploymentPreflight(ownerReplay.input, ownerReplay.hooks)).status, "BLOCKED");
});

test("verified Forge evidence does not relax any existing preflight rule", async () => {
  // A stateful service in the binding is still blocked by the preflight's own rule. Forge evidence adds
  // a gate; it never removes one.
  const item = fixture({ binding: { authorizedServices: ["backend", "mongo"] } });
  item.input.authorizedServices = ["backend", "mongo"];
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.ok(failed(result, "mongodb_exclusion"));
});

test("the report stays value-free and carries no key material", async () => {
  const item = fixture();
  const serialized = JSON.stringify(await runBetaDeploymentPreflight(item.input, item.hooks));
  assert.equal(serialized.includes(owner.signingPrivateKey), false);
  assert.equal(serialized.includes(owner.signingPublicKey), false);
  assert.doesNotMatch(serialized, /BEGIN [A-Z ]*PRIVATE KEY/);
});

test("BLOCKER (round 2): the trust anchors are not reachable from operator input", () => {
  // The input type must not carry a trusted root or an owner key. Round 2 found both were selectable
  // through the same file that selects the evidence, so an operator could ship their own CA and their
  // own "owner" key and the chain would verify genuinely against authorities the attacker chose. Real
  // signature verification against a root the attacker picked proves nothing.
  const item = fixture();
  for (const forbidden of ["forgeTrustedRootPath", "forgeOwnerPublicKeyPath", "trustedRoot", "ownerPublicKey"]) {
    assert.equal(forbidden in item.input, false, `${forbidden} must not be an input field`);
  }
});

test("BLOCKER (round 2): with no root-owned anchors, evidence is rejected rather than trusted", async () => {
  // An unanchored verification is not a weaker verification, it is no verification at all.
  const item = fixture();
  const unanchored = await runBetaDeploymentPreflight(item.input, {
    ...item.hooks,
    verifyEvidence: (paths, context) => (context.anchors ? item.hooks.verifyEvidence(paths, context) : { state: "rejected", reason: "trust-anchors-unavailable" }),
  });
  assert.equal(unanchored.status, "BLOCKED");
  assert.ok(failed(unanchored, "forge_evidence"));
});

test("BLOCKER (round 2): nonce consumption is the decision, not a record of it", async () => {
  // The claim hook is atomic (exclusive create). A run that cannot claim is a replay and must block
  // even though every signature verified.
  const item = fixture();
  const used = new Set<string>();
  const claimNonces = (nonces: string[]) => {
    if (nonces.some((nonce) => used.has(nonce))) return { claimed: [], alreadyUsed: true };
    for (const nonce of nonces) used.add(nonce);
    return { claimed: nonces, alreadyUsed: false };
  };
  const first = await runBetaDeploymentPreflight(item.input, { ...item.hooks, claimNonces });
  assert.equal(first.status, "PASS — awaiting operator approval");
  const second = await runBetaDeploymentPreflight(fixture().input, { ...fixture().hooks, claimNonces });
  assert.equal(second.status, "BLOCKED", "the second presentation must not pass");
  assert.ok(failed(second, "forge_evidence"));
});
