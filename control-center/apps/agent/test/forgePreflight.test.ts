import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BETA_STARTUP_SAFETY_FLAGS, runBetaDeploymentPreflight, type BetaDeploymentPreflightInput, type ImageInspection } from "../src/betaDeploymentPreflight.js";
import { forgeBuildDigest, forgeTargetBindingDigest, forgeOwnerAuthorizationMessage, generateAgentKeyPairs, signWithAgentKey, type ForgeBuildManifest, type ForgeTargetBinding } from "@control-center/shared";

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
const ROLLBACK_BACKEND = `ghcr.io/williams342-maker/operation/control-center-api@sha256:${"c".repeat(64)}`;
const ROLLBACK_FRONTEND = `ghcr.io/williams342-maker/operation/control-center-web@sha256:${"d".repeat(64)}`;

const buildManifest = (over: Partial<ForgeBuildManifest> = {}): ForgeBuildManifest => ({
  schemaVersion: "forge-build-v1", buildId: "forge-build-20260901-0001",
  sourceRepository: "https://github.com/williams342-maker/operation",
  sourceCommit: COMMIT, sourceTree: "322b1275e498aa0d4c0c1cbb0a2f2ab5f4e6d7c8", sourceTag: "v0.1.2-operate",
  backendImageDigest: CANDIDATE_BACKEND, frontendImageDigest: CANDIDATE_FRONTEND,
  builderIdentity: BUILDER, builderRunnerEnvironment: "github-hosted", issuedAt: NOW.toISOString(), ...over
} as ForgeBuildManifest);

const rollbackManifest = (over: Partial<ForgeBuildManifest> = {}): ForgeBuildManifest => buildManifest({
  buildId: "forge-build-20260808-0001", sourceCommit: PRIOR_COMMIT, sourceTree: "f599b3a2b078aa0d4c0c1cbb0a2f2ab5f4e6d7c8",
  sourceTag: "v0.1.1-operate", backendImageDigest: ROLLBACK_BACKEND, frontendImageDigest: ROLLBACK_FRONTEND, ...over
});

function fixture(options: { candidate?: ForgeBuildManifest; rollback?: ForgeBuildManifest; binding?: Partial<ForgeTargetBinding>; attestation?: Record<string, unknown>; omit?: string[]; revisions?: Record<string, string | undefined> } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-forge-preflight-"));
  const env = path.join(root, ".env.beta");
  const compose = path.join(root, "compose.yml");
  const override = path.join(root, "images.json");
  const rollbackOverride = path.join(root, "rollback-images.json");
  fs.writeFileSync(env, `APP_ENV=beta\nENVIRONMENT=beta\n${BETA_STARTUP_SAFETY_FLAGS.map((name) => `${name}=false`).join("\n")}\n`);
  fs.writeFileSync(compose, "services:\n  backend:\n    image: x\n  frontend:\n    image: y\n");
  fs.writeFileSync(override, `${JSON.stringify({ services: { backend: { image: CANDIDATE_BACKEND }, frontend: { image: CANDIDATE_FRONTEND } } }, null, 2)}\n`);
  fs.writeFileSync(rollbackOverride, `${JSON.stringify({ services: { backend: { image: ROLLBACK_BACKEND }, frontend: { image: ROLLBACK_FRONTEND } } }, null, 2)}\n`);

  const candidate = options.candidate ?? buildManifest();
  const rollback = options.rollback ?? rollbackManifest();
  const binding: ForgeTargetBinding = {
    schemaVersion: "forge-target-binding-v1", bindingId: "forge-binding-20260901-0001",
    buildDigest: forgeBuildDigest(candidate), rollbackBuildDigest: forgeBuildDigest(rollback),
    targetEnvironment: "beta", targetOrgId: "org-000000000001", targetServerId: "server-000000000001",
    composeProjectName: "opsworkbench-beta", authorizedServices: ["backend", "frontend"],
    requiredCapabilities: ["docker", "compose"], issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(), nonce: "forge-nonce-000000001",
    ...options.binding
  } as ForgeTargetBinding;

  const paths: Record<string, string> = {
    forgeCandidateBuildPath: path.join(root, "candidate-build.json"),
    forgeRollbackBuildPath: path.join(root, "rollback-build.json"),
    forgeTargetBindingPath: path.join(root, "binding.json"),
    forgeOwnerAuthorizationPath: path.join(root, "owner-authorization.json"),
    forgeOwnerPublicKeyPath: path.join(root, "owner.pub"),
    forgeAttestationPath: path.join(root, "attestation.json"),
  };
  const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  fs.writeFileSync(paths.forgeCandidateBuildPath, JSON.stringify(candidate, null, 2));
  fs.writeFileSync(paths.forgeRollbackBuildPath, JSON.stringify(rollback, null, 2));
  fs.writeFileSync(paths.forgeTargetBindingPath, JSON.stringify(binding, null, 2));
  fs.writeFileSync(paths.forgeOwnerPublicKeyPath, `${owner.signingPublicKey}\n`);

  const expiresAt = new Date(NOW.getTime() + 3600_000).toISOString();
  fs.writeFileSync(paths.forgeOwnerAuthorizationPath, JSON.stringify({
    signature: signWithAgentKey(owner.signingPrivateKey, forgeOwnerAuthorizationMessage({ bindingDigest: forgeTargetBindingDigest(binding), targetOrgId: binding.targetOrgId, targetServerId: binding.targetServerId, expiresAt, nonce: "owner-nonce-000000001", keyVersion: "owner-v1" })),
    issuedAt: NOW.toISOString(), expiresAt, nonce: "owner-nonce-000000001", keyVersion: "owner-v1"
  }, null, 2));

  const attestation = options.attestation ?? {
    candidate: { verified: true, builderId: candidate.builderIdentity, runnerEnvironment: candidate.builderRunnerEnvironment, sourceCommit: candidate.sourceCommit, subjectSha256: sha(paths.forgeCandidateBuildPath) },
    rollback: { verified: true, builderId: rollback.builderIdentity, runnerEnvironment: rollback.builderRunnerEnvironment, sourceCommit: rollback.sourceCommit, subjectSha256: sha(paths.forgeRollbackBuildPath) },
  };
  fs.writeFileSync(paths.forgeAttestationPath, JSON.stringify(attestation, null, 2));
  for (const key of options.omit || []) delete paths[key];

  const input: BetaDeploymentPreflightInput = {
    targetEnvironment: "beta", composeWorkingDirectory: root, composeProjectName: "opsworkbench-beta",
    composeFilePath: compose, environmentFilePath: env, composeOverrideFilePath: override,
    rollbackComposeOverrideFilePath: rollbackOverride,
    authorizedBackendImage: CANDIDATE_BACKEND, authorizedFrontendImage: CANDIDATE_FRONTEND,
    rollbackBackendImage: ROLLBACK_BACKEND, rollbackFrontendImage: ROLLBACK_FRONTEND,
    authorizedServices: ["backend", "frontend"], allowedComposeServices: ["backend", "frontend"],
    allowedHostnames: [], allowedDatabaseDestinations: [{ hostname: "mongo", databaseName: "beta" }],
    agentAdvertisedCapabilities: ["docker", "compose", "dockerComposeActivation"],
    ...paths,
  };

  const revisions = { candidateBackend: COMMIT, candidateFrontend: COMMIT, rollbackBackend: PRIOR_COMMIT, rollbackFrontend: PRIOR_COMMIT, ...options.revisions };
  const model = { name: "opsworkbench-beta", services: {
    backend: { image: CANDIDATE_BACKEND, environment: { APP_ENV: "beta", ENVIRONMENT: "beta", ...flags, MONGO_URL: "mongodb://mongo:27017/beta" } },
    frontend: { image: CANDIDATE_FRONTEND, environment: {} },
  } };
  const images: Record<string, ImageInspection> = {
    [CANDIDATE_BACKEND]: { id: "sha256:cb", repoTags: [], revision: revisions.candidateBackend },
    [CANDIDATE_FRONTEND]: { id: "sha256:cf", repoTags: [], revision: revisions.candidateFrontend },
    [ROLLBACK_BACKEND]: { id: "sha256:rb", repoTags: [], revision: revisions.rollbackBackend },
    [ROLLBACK_FRONTEND]: { id: "sha256:rf", repoTags: [], revision: revisions.rollbackFrontend },
  };
  const hooks = {
    now: () => NOW,
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
  assert.equal(result.report.forge?.state, "absent");
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
  fs.writeFileSync(swapped.input.composeOverrideFilePath, `${JSON.stringify({ services: { backend: { image: substitute }, frontend: { image: CANDIDATE_FRONTEND } } }, null, 2)}\n`);
  const swappedHooks = { ...swapped.hooks, composeConfig: async () => ({ code: 0, stdout: JSON.stringify({ name: "opsworkbench-beta", services: { backend: { image: substitute, environment: { APP_ENV: "beta", ENVIRONMENT: "beta", ...flags, MONGO_URL: "mongodb://mongo:27017/beta" } }, frontend: { image: CANDIDATE_FRONTEND, environment: {} } } }), stderr: "" }), inspectImage: async (image: string) => (image === substitute ? { id: "sha256:sub", repoTags: [], revision: COMMIT } : swapped.hooks.inspectImage(image)) };
  const a = await runBetaDeploymentPreflight(swapped.input, swappedHooks);
  assert.equal(a.status, "BLOCKED");
  assert.ok(failed(a, "forge_binding_images"), "candidate image must be checked against the attested build");

  // The rollback image is not in the resolved model, so substituting it reaches the Forge check directly
  // once the rollback override agrees with the input.
  const rollbackSubstitute = `ghcr.io/williams342-maker/operation/control-center-api@sha256:${"f".repeat(64)}`;
  const rollback = fixture();
  rollback.input.rollbackBackendImage = rollbackSubstitute;
  fs.writeFileSync(rollback.input.rollbackComposeOverrideFilePath, `${JSON.stringify({ services: { backend: { image: rollbackSubstitute }, frontend: { image: ROLLBACK_FRONTEND } } }, null, 2)}\n`);
  const rollbackHooks = { ...rollback.hooks, inspectImage: async (image: string) => (image === rollbackSubstitute ? { id: "sha256:rsub", repoTags: [], revision: PRIOR_COMMIT } : rollback.hooks.inspectImage(image)) };
  const b = await runBetaDeploymentPreflight(rollback.input, rollbackHooks);
  assert.equal(b.status, "BLOCKED");
  assert.ok(failed(b, "forge_binding_rollback_images"), "rollback image must be checked against the attested rollback build");
});

test("PARTIAL EVIDENCE NEVER PASSES: omitting any single document blocks", async () => {
  for (const key of ["forgeCandidateBuildPath", "forgeRollbackBuildPath", "forgeTargetBindingPath", "forgeOwnerAuthorizationPath", "forgeOwnerPublicKeyPath", "forgeAttestationPath"]) {
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
  assert.equal(result.report.forge?.state, "rejected");
});

test("PROOF 1 (tamper): editing a build file after attestation blocks", async () => {
  const item = fixture();
  // The attestation subject was computed over the original bytes. The preflight hashes the file it
  // actually reads, so a post-attestation edit cannot be papered over by a supplied digest.
  const edited = { ...item.candidate, sourceTag: "v9.9.9-tampered" };
  fs.writeFileSync(item.paths.forgeCandidateBuildPath, JSON.stringify(edited, null, 2));
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.ok(failed(result, "forge_evidence"));
});

test("PROOF (wrong builder / runner substitution): a valid attestation from elsewhere blocks", async () => {
  const base = fixture();
  for (const patch of [{ builderId: "https://github.com/attacker/repo/.github/workflows/x.yml@refs/heads/main" }, { runnerEnvironment: "self-hosted" }, { verified: false }]) {
    const item = fixture();
    const attestation = JSON.parse(fs.readFileSync(item.paths.forgeAttestationPath, "utf8"));
    Object.assign(attestation.candidate, patch);
    fs.writeFileSync(item.paths.forgeAttestationPath, JSON.stringify(attestation, null, 2));
    const result = await runBetaDeploymentPreflight(item.input, item.hooks);
    assert.equal(result.status, "BLOCKED");
    assert.ok(failed(result, "forge_evidence"));
  }
  assert.ok(base);
});

test("PROOF 6 (stale candidate): an expired binding blocks", async () => {
  const item = fixture({ binding: { expiresAt: new Date(NOW.getTime() - 1000).toISOString(), issuedAt: new Date(NOW.getTime() - 2000).toISOString() } });
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.ok(failed(result, "forge_evidence"));
});

test("a capability the agent does not advertise blocks", async () => {
  const item = fixture({ binding: { requiredCapabilities: ["docker", "systemdActivation"] } });
  item.input.agentAdvertisedCapabilities = ["docker", "compose"];
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.ok(failed(result, "forge_evidence"));
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
