import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import test from "node:test";
import { establishRollbackBeforeMutation, inspectImmutableImage, parseDeploymentPlan, prepareReviewedRelease } from "../../scripts/trusted-deployer.mjs";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const commit = "a".repeat(40); const tree = "b".repeat(40); const rollbackCommit = "c".repeat(40); const rollbackTree = "d".repeat(40);
const image = (role, char) => `ghcr.io/williams342-maker/operation/${role === "review-gate" ? role : `control-center-${role}`}@sha256:${char.repeat(64)}`;

function plan(root) { return {
  schemaVersion: "opsworkbench-trusted-deployment-v1", tag: "v0.2.0-operate", commit, tree,
  bundleDirectory: path.join(root, "bundle"), stagingRoot: path.join(root, "stage"), releaseRoot: path.join(root, "releases"), composeProject: "opsworkbench",
  candidateImages: { api: image("api", "1"), web: image("web", "2"), admin: image("admin-web", "3"), reviewGate: image("review-gate", "4") },
  rollback: { tag: "v0.1.9-operate", commit: rollbackCommit, tree: rollbackTree, images: { api: image("api", "5"), web: image("web", "6"), admin: image("admin-web", "7"), reviewGate: image("review-gate", "8") }, releaseDirectory: path.join(root, "rollback"), evidenceSha256: "9".repeat(64) },
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

test("rollback eligibility is durably recorded before mutation authority exists", () => {
  const { item, prefix, compose } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }), extract: (_archive, destination) => { const target = path.join(destination, prefix, "control-center", "deploy"); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, "docker-compose.production.yml"), compose); } });
  const result = establishRollbackBeforeMutation(preparation, [{ role: "api", localImageId: `sha256:${"9".repeat(64)}` }]);
  assert.equal(result.record.runtimeMutationAuthorized, false); assert.equal(fs.existsSync(result.file), true);
  assert.throws(() => establishRollbackBeforeMutation(preparation, []), /exist/i);
});
