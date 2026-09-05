import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import test from "node:test";
import { deployPreparedRelease, establishRollbackBeforeMutation, inspectImmutableImage, inspectPlatformImages, parseDeploymentPlan, prepareReviewedRelease, verifyCompatibilityEvidence, verifyForgeEvidence } from "../../scripts/trusted-deployer.mjs";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const commit = "a".repeat(40); const tree = "b".repeat(40); const rollbackCommit = "c".repeat(40); const rollbackTree = "d".repeat(40);
const image = (role, char) => `ghcr.io/williams342-maker/operation/${role === "review-gate" ? role : `control-center-${role}`}@sha256:${char.repeat(64)}`;

function plan(root) { return {
  schemaVersion: "opsworkbench-trusted-deployment-v1", tag: "v0.2.0-operate", commit, tree,
  bundleDirectory: path.join(root, "bundle"), stagingRoot: path.join(root, "stage"), releaseRoot: path.join(root, "releases"), composeProject: "opsworkbench",
  candidateImages: { api: image("api", "1"), web: image("web", "2"), admin: image("admin-web", "3"), reviewGate: image("review-gate", "4") },
  platform: { edgeImage: `docker.io/library/nginx@sha256:${"a".repeat(64)}`, mongoImage: `docker.io/library/mongo@sha256:${"b".repeat(64)}`, mongoVolume: "mongo_verified" },
  rollback: { tag: "v0.1.9-operate", commit: rollbackCommit, tree: rollbackTree, images: { api: image("api", "5"), web: image("web", "6"), admin: image("admin-web", "7"), reviewGate: image("review-gate", "8") }, releaseDirectory: path.join(root, "rollback"), evidenceSha256: "9".repeat(64) },
  forgeEvidence: { candidatePath: path.join(root, "candidate-forge.json"), candidateSha256: "a".repeat(64), rollbackPath: path.join(root, "rollback-forge.json"), rollbackSha256: "b".repeat(64) },
  compatibilityEvidence: { path: path.join(root, "compatibility.json"), sha256: "c".repeat(64) },
  readiness: ["https://example.test/healthz", "https://example.test/", "https://admin.example.test/"],
}; }

const tarBlock = (name, type = "0", body = Buffer.alloc(0)) => {
  const header = Buffer.alloc(512); header.write(name); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124); header.write("00000000000\0", 136); header.fill(0x20, 148, 156); header[156] = type.charCodeAt(0); header.write("ustar\0", 257); header.write("00", 263);
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
};

function releaseFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-deploy-")); const item = plan(root);
  fs.mkdirSync(item.bundleDirectory); fs.mkdirSync(item.stagingRoot); fs.mkdirSync(item.releaseRoot); fs.mkdirSync(item.rollback.releaseDirectory);
  const prefix = "opsworkbench-control-center-0.2.0-operate"; const composeName = `${prefix}/control-center/deploy/docker-compose.production.yml`; const compose = Buffer.from("services: {}\n");
  const pax = Buffer.from(`52 comment=${commit}\n`); const archive = zlib.gzipSync(Buffer.concat([tarBlock("pax_global_header", "g", pax), tarBlock(`${prefix}/`, "5"), tarBlock(`${prefix}/control-center/`, "5"), tarBlock(`${prefix}/control-center/deploy/`, "5"), tarBlock(composeName, "0", compose), Buffer.alloc(1024)]));
  const artifact = `opsworkbench-control-center-0.2.0-operate.tar.gz`; const manifestName = `opsworkbench-control-center-0.2.0-operate.manifest.json`;
  const manifest = Buffer.from(`${JSON.stringify({ schemaVersion: "opsworkbench-release-v1", tag: item.tag, commit, artifact, source: "test", reproducible: true }, null, 2)}\n`);
  fs.writeFileSync(path.join(item.bundleDirectory, artifact), archive); fs.writeFileSync(path.join(item.bundleDirectory, manifestName), manifest);
  fs.writeFileSync(path.join(item.bundleDirectory, "SHA256SUMS"), `${sha(archive)}  ${artifact}\n${sha(manifest)}  ${manifestName}\n`);
  return { item, prefix, composeName, compose };
}

test("the deployment plan requires exact fields, role-correct immutable images and a real rollback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-plan-")); const valid = plan(root); assert.equal(parseDeploymentPlan(valid).commit, commit);
  assert.throws(() => parseDeploymentPlan({ ...valid, surprise: true }), /unknown fields/);
  assert.throws(() => parseDeploymentPlan({ ...valid, candidateImages: { ...valid.candidateImages, api: "image:latest" } }), /immutable repository/);
  assert.throws(() => parseDeploymentPlan({ ...valid, rollback: { ...valid.rollback, images: { ...valid.rollback.images, api: valid.candidateImages.api } } }), /identical/);
});

test("preparation copies, re-verifies, safely inspects and bidirectionally checks before consumption", () => {
  const { item, prefix, compose } = releaseFixture(); let attested = false;
  const result = prepareReviewedRelease(item, { verifyAttestation: (_dir, names, options) => { attested = options.required && names.length === 2; return { verified: true }; }, extract: (_archive, destination) => {
    const target = path.join(destination, prefix, "control-center", "deploy"); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, "docker-compose.production.yml"), compose);
  } });
  assert.equal(attested, true); assert.equal(fs.existsSync(result.compose), true);
  if (process.platform !== "win32") assert.equal(fs.statSync(result.stage).mode & 0o777, 0o700);
  assert.equal(result.evidence.commit, commit);
});

test("registry and daemon inspection bind digest, source, revision, role and local image ID", () => {
  const reference = image("api", "1");
  const result = inspectImmutableImage(reference, { commit, role: "api", title: "OpsWorkbench Control Center API" }, {
    remoteInspect: () => `Name: ${reference}\nMediaType: application/vnd.oci.image.manifest.v1+json\nDigest: sha256:${"1".repeat(64)}\n`,
    pull: () => undefined,
    localInspect: () => ({ Id: `sha256:${"9".repeat(64)}`, RepoDigests: [reference], Config: { Labels: { "org.opencontainers.image.revision": commit, "org.opencontainers.image.source": "https://github.com/williams342-maker/operation", "org.opencontainers.image.title": "OpsWorkbench Control Center API" } } }),
  });
  assert.equal(result.registryDigest, `sha256:${"1".repeat(64)}`);
  assert.throws(() => inspectImmutableImage(reference, { commit, role: "api", title: "OpsWorkbench Control Center API" }, { remoteInspect: () => "Name: mutable:latest\n" }), /did not bind/);
});

test("platform images independently bind registry digest and local content identity", () => {
  const item = plan("C:\\safe");
  const result = inspectPlatformImages(item.platform, { remoteInspect: (ref) => `Name: ${ref}\n`, pull: () => {}, localInspect: (ref) => ({ RepoDigests: [ref], Id: `sha256:${"d".repeat(64)}` }) });
  assert.equal(result.ok, true); assert.equal(result.edgeImage, item.platform.edgeImage); assert.equal(result.mongoImage, item.platform.mongoImage);
  assert.throws(() => inspectPlatformImages(item.platform, { remoteInspect: () => "Name: wrong@sha256:00\n" }), /did not bind/);
});

test("rollback eligibility is durably recorded before mutation authority exists", () => {
  const { item, prefix, compose } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }), extract: (_archive, destination) => { const target = path.join(destination, prefix, "control-center", "deploy"); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, "docker-compose.production.yml"), compose); } });
  const result = establishRollbackBeforeMutation(preparation, [{ role: "api", localImageId: `sha256:${"9".repeat(64)}` }]);
  assert.equal(result.record.runtimeMutationAuthorized, false); assert.equal(fs.existsSync(result.file), true);
  assert.throws(() => establishRollbackBeforeMutation(preparation, []), /exist/i);
});

test("deployment establishes rollback first, requires readiness, and restores rollback images on failure", async () => {
  const { item, prefix, compose: composeBytes } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }), extract: (_archive, destination) => { const target = path.join(destination, prefix, "control-center", "deploy"); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, "docker-compose.production.yml"), composeBytes); } });
  const calls = [];
  let rolledBack = false;
  const imageHooks = {
    remoteInspect: (reference) => `Name: ${reference}\n`, pull: () => undefined,
    localInspect: (reference) => ({ Id: `sha256:${sha(reference)}`, RepoDigests: [reference], Config: { Labels: { "org.opencontainers.image.revision": reference.includes("@sha256:1") || reference.includes("@sha256:2") || reference.includes("@sha256:3") || reference.includes("@sha256:4") ? commit : rollbackCommit, "org.opencontainers.image.source": "https://github.com/williams342-maker/operation", "org.opencontainers.image.title": reference.includes("control-center-api") ? "opsworkbench-control-center-api" : reference.includes("control-center-web") ? "opsworkbench-control-center-web" : reference.includes("admin-web") ? "opsworkbench-control-center-admin-web" : "opsworkbench-review-gate" } } }),
  };
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), images: imageHooks,
    verifyForge: async () => ({ ok: true }),
    verifyCompatibility: async () => ({ ok: true, candidateCommit: commit, rollbackCommit, images: {
      candidate: { api: `sha256:${sha(item.candidateImages.api)}`, web: `sha256:${sha(item.candidateImages.web)}`, admin: `sha256:${sha(item.candidateImages.admin)}`, gate: `sha256:${sha(item.candidateImages.reviewGate)}` },
      rollback: { api: `sha256:${sha(item.rollback.images.api)}`, web: `sha256:${sha(item.rollback.images.web)}`, admin: `sha256:${sha(item.rollback.images.admin)}`, gate: `sha256:${sha(item.rollback.images.reviewGate)}` },
    } }),
    verifyPlatformImages: async () => ({ ok: true, edgeImage: item.platform.edgeImage, mongoImage: item.platform.mongoImage }),
    compose: (args, env) => { if (env.OPSWORKBENCH_API_IMAGE === item.rollback.images.api) rolledBack = true; calls.push({ args, api: env.OPSWORKBENCH_API_IMAGE, rollbackExists: fs.existsSync(path.join(preparation.stage, "rollback-ready.json")) }); },
    readiness: async () => rolledBack, acceptancePasses: 1,
  }), /was rolled back/);
  assert.equal(calls.every((call) => call.args[0] === "config" || call.rollbackExists), true, "every mutation follows rollback readiness");
  assert.equal(calls.at(-1).api, item.rollback.images.api, "last mutation restores immutable rollback images");
});

test("schema rehearsal evidence is exact, complete, digest-bound and workflow-attested", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compatibility-")); const item = plan(root);
  const scenarios = Object.fromEntries(["forward_compatibility", "rollback_compatibility", "migration_boundaries", "old_app_new_schema", "new_app_old_schema", "interrupted_migration", "failed_deployment_after_migration", "rollback_after_partial_switch", "service_restart_during_transition", "predecessor_artifacts_retained", "rollback_immutable_images", "rollback_target_independently_verified"].map((name) => [name, name.includes("migration") ? "not-applicable-no-migrations" : "passed"]));
  const ids = (start) => Object.fromEntries(["api", "web", "admin", "gate"].map((role, index) => [role, `sha256:${String(start + index).repeat(64).slice(0, 64)}`]));
  const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: "opsworkbench-schema-rehearsal-v1", candidateTag: item.tag, candidateCommit: item.commit, rollbackTag: item.rollback.tag, rollbackCommit: item.rollback.commit, mongoTopology: "replica-set", images: { candidate: ids(1), rollback: ids(5) }, migrationsPresent: false, scenarios }, null, 2)}\n`);
  fs.writeFileSync(item.compatibilityEvidence.path, bytes); item.compatibilityEvidence.sha256 = sha(bytes);
  let attestationOptions;
  const result = verifyCompatibilityEvidence(item, { verifyAttestation: (_dir, _names, options) => { attestationOptions = options; return { verified: true }; } });
  assert.equal(result.ok, true); assert.equal(attestationOptions.sourceDigest, commit); assert.match(attestationOptions.signerWorkflow, /deployment-rehearsal/);
  const changed = JSON.parse(bytes); changed.scenarios.forward_compatibility = "failed"; fs.writeFileSync(item.compatibilityEvidence.path, JSON.stringify(changed)); item.compatibilityEvidence.sha256 = sha(fs.readFileSync(item.compatibilityEvidence.path));
  assert.throws(() => verifyCompatibilityEvidence(item, { verifyAttestation: () => ({ verified: true }) }), /did not pass/);
});

test("Forge evidence binds exact source, builder, four images and image attestations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-evidence-")); const item = plan(root); let images = 0;
  const write = (file, identity, refs) => { const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: "forge-build-v2", buildId: `build-${identity.tag}`, sourceRepository: "https://github.com/williams342-maker/operation", sourceCommit: identity.commit, sourceTree: identity.tree, sourceTag: identity.tag, backendImageDigest: refs.api, frontendImageDigest: refs.web, adminImageDigest: refs.admin, reviewGateImageDigest: refs.reviewGate, builderIdentity: `https://github.com/williams342-maker/operation/.github/workflows/control-center-images.yml@refs/tags/${identity.tag}`, builderRunnerEnvironment: "github-hosted", issuedAt: "2026-09-05T00:00:00Z" }, null, 2)}\n`); fs.writeFileSync(file, bytes); return sha(bytes); };
  item.forgeEvidence.candidateSha256 = write(item.forgeEvidence.candidatePath, item, item.candidateImages);
  item.forgeEvidence.rollbackSha256 = write(item.forgeEvidence.rollbackPath, item.rollback, item.rollback.images);
  const result = verifyForgeEvidence(item, { verifyAttestation: () => ({ verified: true }), verifyImageAttestation: () => { images += 1; } });
  assert.equal(result.ok, true); assert.equal(images, 8);
  const changed = JSON.parse(fs.readFileSync(item.forgeEvidence.candidatePath)); changed.backendImageDigest = item.rollback.images.api; fs.writeFileSync(item.forgeEvidence.candidatePath, JSON.stringify(changed)); item.forgeEvidence.candidateSha256 = sha(fs.readFileSync(item.forgeEvidence.candidatePath));
  assert.throws(() => verifyForgeEvidence(item, { verifyAttestation: () => ({ verified: true }), verifyImageAttestation: () => {} }), /differ/);
});
