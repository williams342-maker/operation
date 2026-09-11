import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import test from "node:test";
import { deployPreparedRelease, establishRollbackBeforeMutation, inspectImmutableImage, inspectPlatformImages, parseDeploymentPlan, prepareReviewedRelease, verifyCompatibilityEvidence, verifyForgeEvidence, reverifyPreparedRelease, normalizeImageReference, isReleaseDirectoryFor, isReadinessEndpoint, detectForeignPortConflicts, measurePredecessorImages, readAdoptedContainerIds } from "../../scripts/trusted-deployer.mjs";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const commit = "a".repeat(40); const tree = "b".repeat(40); const rollbackCommit = "c".repeat(40); const rollbackTree = "d".repeat(40);
const image = (role, char) => `ghcr.io/williams342-maker/operation/${role === "review-gate" ? role : `control-center-${role}`}@sha256:${char.repeat(64)}`;

function plan(root) { return {
  schemaVersion: "opsworkbench-trusted-deployment-v1", tag: "v0.2.0-operate", commit, tree,
  bundleDirectory: path.join(root, "bundle"), stagingRoot: path.join(root, "stage"), releaseRoot: path.join(root, "releases"), composeProject: "opsworkbench",
  candidateImages: { api: image("api", "1"), web: image("web", "2"), admin: image("admin-web", "3"), reviewGate: image("review-gate", "4") },
  platform: { edgeImage: `docker.io/library/nginx@sha256:${"a".repeat(64)}`, mongoImage: `docker.io/library/mongo@sha256:${"b".repeat(64)}`, mongoVolume: "mongo_verified" },
  rollback: { evidence: "attested", tag: "v0.1.9-operate", commit: rollbackCommit, tree: rollbackTree, images: { api: image("api", "5"), web: image("web", "6"), admin: image("admin-web", "7"), reviewGate: image("review-gate", "8") }, bundleDirectory: path.join(root, "rollback-bundle"), releaseDirectory: path.join(root, "releases", "v0.1.9-operate", "app"), evidenceSha256: "9".repeat(64) },
  forgeEvidence: { candidatePath: path.join(root, "candidate-forge.json"), candidateSha256: "a".repeat(64), rollbackPath: path.join(root, "rollback-forge.json"), rollbackSha256: "b".repeat(64) },
  compatibilityEvidence: { path: path.join(root, "compatibility.json"), sha256: "c".repeat(64) },
  readiness: ["https://example.test/healthz", "https://example.test/", "https://admin.example.test/"],
  identityEndpoint: "https://example.test/healthz",
}; }

const tarBlock = (name, type = "0", body = Buffer.alloc(0)) => {
  // DIRECTORIES NEED THE EXECUTE BIT, and this fixture gave every entry 0644 including type "5". A
  // directory without +x cannot be traversed, so extraction succeeded and the very next step -- walking
  // the tree to compare it against the archive -- died with EACCES. `git archive`, which produces the
  // real release tarballs, writes 0755 for directories, so the fixture was the unrealistic part.
  const header = Buffer.alloc(512); header.write(name); header.write(type === "5" ? "0000755\0" : "0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124); header.write("00000000000\0", 136); header.fill(0x20, 148, 156); header[156] = type.charCodeAt(0); header.write("ustar\0", 257); header.write("00", 263);
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
};

// `omitAgent` builds the shape of a release from before the agent artifact existed -- which the live
// release on the production host is, and which a first deployment must be able to roll back to.
function writeReleaseBundle(directory, tag, releaseCommit, releaseTree, { omitAgent = false } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const version = tag.slice(1); const prefix = `opsworkbench-control-center-${version}`; const composeName = `${prefix}/control-center/deploy/docker-compose.production.yml`; const compose = Buffer.from("services: {}\n");
  const pax = Buffer.from(`52 comment=${releaseCommit}\n`); const archive = zlib.gzipSync(Buffer.concat([tarBlock("pax_global_header", "g", pax), tarBlock(`${prefix}/`, "5"), tarBlock(`${prefix}/control-center/`, "5"), tarBlock(`${prefix}/control-center/deploy/`, "5"), tarBlock(composeName, "0", compose), tarBlock(`${prefix}/control-center/scripts/`, "5"), tarBlock(`${prefix}/control-center/scripts/install-reviewed-agent.sh`, "0", Buffer.from("#!/bin/sh\n")), Buffer.alloc(1024)]));
  const artifact = `opsworkbench-control-center-${version}.tar.gz`; const agentArtifact = `opsworkbench-control-center-${version}-agent-linux-x64.tar.gz`; const manifestName = `opsworkbench-control-center-${version}.manifest.json`;
  const agentMetadata = Buffer.from(`${JSON.stringify({ schemaVersion: "opsworkbench-agent-release-v1", tag, commit: releaseCommit, tree: releaseTree }, null, 2)}\n`);
  const agentPax = Buffer.from(`52 comment=${releaseCommit}\n`);
  const agent = zlib.gzipSync(Buffer.concat([tarBlock("pax_global_header", "g", agentPax), tarBlock("control-center/", "5"), tarBlock("control-center/apps/", "5"), tarBlock("control-center/apps/agent/", "5"), tarBlock("control-center/apps/agent/dist/", "5"), tarBlock("control-center/apps/agent/dist/agent.js", "0", Buffer.from("agent")), tarBlock("control-center/apps/updater/", "5"), tarBlock("control-center/apps/updater/dist/", "5"), tarBlock("control-center/apps/updater/dist/main.js", "0", Buffer.from("updater")), tarBlock("control-center/deploy/", "5"), tarBlock("control-center/deploy/systemd/", "5"), tarBlock("control-center/deploy/systemd/opsworkbench-agent.service", "0", Buffer.from("unit")), tarBlock("control-center/agent-release.json", "0", agentMetadata), Buffer.alloc(1024)]));
  const manifest = Buffer.from(`${JSON.stringify({ schemaVersion: "opsworkbench-release-v1", tag, commit: releaseCommit, artifact, ...(omitAgent ? {} : { agentArtifact }), source: "test", reproducible: true }, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, artifact), archive); if (!omitAgent) fs.writeFileSync(path.join(directory, agentArtifact), agent); fs.writeFileSync(path.join(directory, manifestName), manifest);
  fs.writeFileSync(path.join(directory, "SHA256SUMS"), `${sha(archive)}  ${artifact}\n${omitAgent ? "" : `${sha(agent)}  ${agentArtifact}\n`}${sha(manifest)}  ${manifestName}\n`);
  return { prefix, composeName, compose, archiveSha256: sha(archive) };
}

function releaseFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-deploy-")); const item = plan(root);
  fs.mkdirSync(item.stagingRoot); fs.mkdirSync(item.releaseRoot);
  const candidate = writeReleaseBundle(item.bundleDirectory, item.tag, commit, tree);
  const rollback = writeReleaseBundle(item.rollback.bundleDirectory, item.rollback.tag, rollbackCommit, rollbackTree); item.rollback.evidenceSha256 = rollback.archiveSha256;
  return { item, ...candidate };
}

test("the deployment plan requires exact fields, role-correct immutable images and a real rollback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-plan-")); const valid = plan(root); assert.equal(parseDeploymentPlan(valid).commit, commit);
  assert.throws(() => parseDeploymentPlan({ ...valid, surprise: true }), /unknown fields/);
  assert.throws(() => parseDeploymentPlan({ ...valid, candidateImages: { ...valid.candidateImages, api: "image:latest" } }), /immutable repository/);
  assert.throws(() => parseDeploymentPlan({ ...valid, rollback: { ...valid.rollback, images: { ...valid.rollback.images, api: valid.candidateImages.api } } }), /identical/);
  assert.throws(() => parseDeploymentPlan({ ...valid, rollback: { ...valid.rollback, tag: valid.tag, commit: valid.commit, tree: valid.tree, releaseDirectory: path.join(valid.releaseRoot, valid.tag, "app") } }), /distinct/);
});

test("preparation copies, re-verifies, safely inspects and bidirectionally checks before consumption", () => {
  const { item } = releaseFixture(); let attested = false;
  const result = prepareReviewedRelease(item, { verifyAttestation: (_dir, names, options) => { attested = options.required && names.length === 3; return { verified: true }; } });
  assert.equal(attested, true); assert.equal(fs.existsSync(result.compose), true);
  if (process.platform !== "win32") assert.equal(fs.statSync(result.stage).mode & 0o777, 0o700);
  assert.equal(result.evidence.commit, commit);
});

for (const secondaryFailure of ["cleanup", "failure record"]) {
  test(`preparation preserves its refusal when ${secondaryFailure} also fails`, (t) => {
    const { item, prefix } = releaseFixture();
    const original = new Error("injected installation refusal");
    let secondaryReached = false;
    t.mock.method(fs, "cpSync", () => { throw original; });
    const realRemove = fs.rmSync;
    const realWrite = fs.writeFileSync;
    if (secondaryFailure === "cleanup") t.mock.method(fs, "rmSync", (file, options) => {
      if (String(file).includes(".reviewed-pending-")) {
        secondaryReached = true;
        throw new Error("injected cleanup failure");
      }
      return realRemove(file, options);
    });
    else t.mock.method(fs, "writeFileSync", (file, ...args) => {
      if (path.basename(String(file)) === "FAILED") {
        secondaryReached = true;
        throw new Error("injected failure-record error");
      }
      return realWrite(file, ...args);
    });
    assert.throws(() => prepareReviewedRelease(item, {
      verifyAttestation: () => ({ verified: true }),
      // Match the source fixture exactly without relying on a platform-specific tar command.
      extract: (_archive, destination) => {
        const source = path.join(destination, prefix, "control-center");
        fs.mkdirSync(path.join(source, "deploy"), { recursive: true });
        fs.mkdirSync(path.join(source, "scripts"));
        fs.writeFileSync(path.join(source, "deploy", "docker-compose.production.yml"), "services: {}\n");
        fs.writeFileSync(path.join(source, "scripts", "install-reviewed-agent.sh"), "#!/bin/sh\n");
      },
    }), (error) => error === original);
    assert.equal(secondaryReached, true);
  });
}

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

// What `docker compose config --format json` resolves to. The admin service publishes the loopback
// port the host's unmanaged admin container also holds, so a fixture that omitted it could not tell a
// working conflict check from a missing one.
const resolvedModelJson = JSON.stringify({ services: {
  api: {}, web: {},
  admin: { ports: [{ mode: "ingress", target: 8080, published: "18081", protocol: "tcp", host_ip: "127.0.0.1" }] },
  edge: { ports: [{ mode: "ingress", target: 8080, published: "18080", protocol: "tcp", host_ip: "127.0.0.1" }] },
} });
const isModelQuery = (args) => args[0] === "config" && args.includes("--format");

test("one image written two ways is one image, and two images are still two", () => {
  // Docker's own rules: a first segment with a dot or colon, or "localhost", is a registry; otherwise
  // the image is on docker.io, and a single-segment docker.io name lives under library/.
  assert.equal(normalizeImageReference("nginx@sha256:abc"), "docker.io/library/nginx@sha256:abc");
  assert.equal(normalizeImageReference("docker.io/library/nginx@sha256:abc"), "docker.io/library/nginx@sha256:abc");
  assert.equal(normalizeImageReference("myorg/img@sha256:y"), "docker.io/myorg/img@sha256:y", "two segments get no library/");
  assert.equal(normalizeImageReference("localhost:5000/img@sha256:z"), "localhost:5000/img@sha256:z", "a port makes it a registry");
  assert.equal(normalizeImageReference("ghcr.io/a/b/c@sha256:x"), "ghcr.io/a/b/c@sha256:x", "already qualified, unchanged");
  // Normalising must not make different images equal.
  assert.notEqual(normalizeImageReference("nginx@sha256:abc"), normalizeImageReference("nginx@sha256:abd"), "a different digest is a different image");
  assert.notEqual(normalizeImageReference("nginx@sha256:abc"), normalizeImageReference("ghcr.io/library/nginx@sha256:abc"), "a different registry is a different image");
  assert.notEqual(normalizeImageReference("myorg/nginx@sha256:abc"), normalizeImageReference("nginx@sha256:abc"), "a different repository is a different image");
});

test("a platform image passes when the registry and the daemon spell it differently", () => {
  // THE FIXTURE REPRODUCES THE DISAGREEMENT, which is the whole point. Measured on the target: buildx
  // reports the fully qualified name while the daemon's RepoDigests holds the short one. The previous
  // fixtures echoed the reference straight back, so the two forms were identical and could never
  // disagree -- and this defect sat undetected until a real deployment tried to use it.
  const shortForm = `nginx@sha256:${"6".repeat(64)}`;
  const qualified = `docker.io/library/nginx@sha256:${"6".repeat(64)}`;
  const mongoShort = `mongo@sha256:${"3".repeat(64)}`;
  const platform = { edgeImage: shortForm, mongoImage: mongoShort, mongoVolume: "opsworkbench_mongo_data" };
  const hooks = {
    // What the registry actually says: always fully qualified.
    remoteInspect: (reference) => `Name:      ${normalizeImageReference(reference)}\n`,
    pull: () => {},
    // What the daemon actually says: the SHORT form, whichever way it was asked. Echoing the reference
    // back instead would let a plain string comparison pass here, which is precisely how the defect
    // survived the old fixtures -- and it survived a first draft of this one for the same reason.
    localInspect: (reference) => ({ RepoDigests: [normalizeImageReference(reference).replace(/^docker\.io\/library\//, "")], Id: `sha256:${"a".repeat(64)}` }),
  };
  const result = inspectPlatformImages(platform, hooks);
  assert.equal(result.ok, true);
  assert.equal(result.edgeImage, shortForm, "the plan's own spelling is what gets reported back");
  assert.equal(result.mongoImage, mongoShort);
  // The fully qualified spelling works too, so a plan may use either.
  assert.equal(inspectPlatformImages({ ...platform, edgeImage: qualified }, hooks).edgeImage, qualified);

  // A registry that binds a DIFFERENT digest is still a failure. Normalising equal spellings must not
  // make unequal images equal.
  const wrongDigest = { ...hooks, remoteInspect: () => `Name:      docker.io/library/nginx@sha256:${"7".repeat(64)}\n` };
  assert.throws(() => inspectPlatformImages(platform, wrongDigest), /did not bind/);
  // And a local image that retains someone else's digest is still a failure.
  const wrongLocal = { ...hooks, localInspect: () => ({ RepoDigests: [`nginx@sha256:${"8".repeat(64)}`], Id: `sha256:${"a".repeat(64)}` }) };
  assert.throws(() => inspectPlatformImages(platform, wrongLocal), /not digest-bound/);
  // A local image with no content-addressed id is still a failure.
  const noId = { ...hooks, localInspect: (reference) => ({ RepoDigests: [reference], Id: "" }) };
  assert.throws(() => inspectPlatformImages(platform, noId), /not digest-bound/);
});

test("platform images independently bind registry digest and local content identity", () => {
  const item = plan("C:\\safe");
  const result = inspectPlatformImages(item.platform, { remoteInspect: (ref) => `Name: ${ref}\n`, pull: () => {}, localInspect: (ref) => ({ RepoDigests: [ref], Id: `sha256:${"d".repeat(64)}` }) });
  assert.equal(result.ok, true); assert.equal(result.edgeImage, item.platform.edgeImage); assert.equal(result.mongoImage, item.platform.mongoImage);
  assert.throws(() => inspectPlatformImages(item.platform, { remoteInspect: () => "Name: wrong@sha256:00\n" }), /did not bind/);
});

test("rollback eligibility is durably recorded before mutation authority exists", () => {
  const { item } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const result = establishRollbackBeforeMutation(preparation, [{ role: "api", localImageId: `sha256:${"9".repeat(64)}` }]);
  assert.equal(result.record.runtimeMutationAuthorized, false); assert.equal(fs.existsSync(result.file), true);
  assert.throws(() => establishRollbackBeforeMutation(preparation, []), /exist/i);
});

test("deployment establishes rollback first, requires readiness, and restores rollback images on failure", async () => {
  const upState = {};
  const { item } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
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
    agentControl: (args) => { calls.push({ args: ["agent", ...args], api: "agent", rollbackExists: fs.existsSync(path.join(preparation.stage, "rollback-ready.json")) }); },
    runningContainers: () => composeRunning(upState.up),
    compose: (args, env, composeFile) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); if (args[0] !== "config" && env.OPSWORKBENCH_API_IMAGE === item.rollback.images.api) rolledBack = true; calls.push({ args, api: env.OPSWORKBENCH_API_IMAGE, composeFile, rollbackExists: fs.existsSync(path.join(preparation.stage, "rollback-ready.json")) }); },
    readiness: async () => rolledBack, identity: async () => ({ source: "manifest", commit: rolledBack ? rollbackCommit : commit }), acceptancePasses: 1,
  }), /was rolled back/);
  assert.equal(calls.filter((call) => call.args[0] !== "agent" || call.args[1] !== "prepare").every((call) => call.args[0] === "config" || call.rollbackExists), true, "every mutation follows rollback readiness");
  const prepareCall = calls.find((call) => call.args[0] === "agent" && call.args[1] === "prepare"); const activateCall = calls.find((call) => call.args[0] === "agent" && call.args[1] === "activate"); const rollbackCall = calls.find((call) => call.args[0] === "agent" && call.args[1] === "rollback");
  assert.equal(prepareCall.rollbackExists, false, "agent predecessor snapshot is taken before mutation authority"); assert.equal(activateCall.rollbackExists, true); assert.equal(rollbackCall.rollbackExists, true);
  assert.equal(calls.at(-1).api, item.rollback.images.api, "last mutation restores immutable rollback images");
  assert.equal(calls.at(-1).composeFile, preparation.rollbackCompose, "rollback uses the independently verified rollback compose file");
});

test("a post-acceptance record failure restores the current pointer and every runtime component", async () => {
  const upState = {};
  const { item } = releaseFixture(); const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const switches = []; const composeCalls = [];
  const localId = (reference) => `sha256:${sha(reference)}`;
  const revision = (reference) => Object.values(item.candidateImages).includes(reference) ? commit : rollbackCommit;
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: async () => ({ ok: true, candidateCommit: commit, rollbackCommit, images: { candidate: { api: localId(item.candidateImages.api), web: localId(item.candidateImages.web), admin: localId(item.candidateImages.admin), gate: localId(item.candidateImages.reviewGate) }, rollback: { api: localId(item.rollback.images.api), web: localId(item.rollback.images.web), admin: localId(item.rollback.images.admin), gate: localId(item.rollback.images.reviewGate) } } }),
    images: { remoteInspect: (reference) => `Name: ${reference}\n`, pull: () => {}, localInspect: (reference) => ({ Id: localId(reference), RepoDigests: [reference], Config: { Labels: { "org.opencontainers.image.revision": revision(reference), "org.opencontainers.image.source": "https://github.com/williams342-maker/operation", "org.opencontainers.image.title": reference.includes("control-center-api") ? "opsworkbench-control-center-api" : reference.includes("control-center-web") ? "opsworkbench-control-center-web" : reference.includes("admin-web") ? "opsworkbench-control-center-admin-web" : "opsworkbench-review-gate" } } }) },
    verifyPlatformImages: async () => ({ ok: true, edgeImage: item.platform.edgeImage, mongoImage: item.platform.mongoImage }),
    agentControl: () => {}, runningContainers: () => composeRunning(upState.up), compose: (args, env, file) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); composeCalls.push({ api: env.OPSWORKBENCH_API_IMAGE, file }); }, readiness: async () => true, identity: async () => ({ source: "manifest", commit: composeCalls.at(-1)?.api === item.candidateImages.api ? commit : rollbackCommit }), acceptancePasses: 1,
    switchCurrent: (_current, target) => { switches.push(target); }, writeDeploymentRecord: () => { throw new Error("disk refused final record"); },
  }), /was rolled back/);
  assert.deepEqual(switches, [preparation.installedControlCenter, preparation.rollbackControlCenter]);
  assert.equal(composeCalls.at(-1).api, item.rollback.images.api); assert.equal(composeCalls.at(-1).file, preparation.rollbackCompose);
});

// The rollback Compose model is only ever loaded while recovering from a failed deployment, so a
// rollback release whose file this host cannot load turns a recoverable failure into an unrecoverable
// one. Compose validates the WHOLE project before selecting services, so a service that is never
// started -- a review gate whose env_file is absent, say -- is still enough to fail the load. This
// asserts the refusal lands BEFORE the first mutation, which is the only point where it costs nothing.
test("a rollback compose file this host cannot load is refused before anything is mutated", async () => {
  const { item } = releaseFixture(); const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const composeCalls = []; const switches = [];
  const localId = (reference) => `sha256:${sha(reference)}`;
  const revision = (reference) => Object.values(item.candidateImages).includes(reference) ? commit : rollbackCommit;
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: async () => ({ ok: true, candidateCommit: commit, rollbackCommit, images: { candidate: { api: localId(item.candidateImages.api), web: localId(item.candidateImages.web), admin: localId(item.candidateImages.admin), gate: localId(item.candidateImages.reviewGate) }, rollback: { api: localId(item.rollback.images.api), web: localId(item.rollback.images.web), admin: localId(item.rollback.images.admin), gate: localId(item.rollback.images.reviewGate) } } }),
    images: { remoteInspect: (reference) => `Name: ${reference}
`, pull: () => {}, localInspect: (reference) => ({ Id: localId(reference), RepoDigests: [reference], Config: { Labels: { "org.opencontainers.image.revision": revision(reference), "org.opencontainers.image.source": "https://github.com/williams342-maker/operation", "org.opencontainers.image.title": reference.includes("control-center-api") ? "opsworkbench-control-center-api" : reference.includes("control-center-web") ? "opsworkbench-control-center-web" : reference.includes("admin-web") ? "opsworkbench-control-center-admin-web" : "opsworkbench-review-gate" } } }) },
    verifyPlatformImages: async () => ({ ok: true, edgeImage: item.platform.edgeImage, mongoImage: item.platform.mongoImage }),
    agentControl: () => {}, readiness: async () => true, identity: async () => ({ source: "manifest", commit }), acceptancePasses: 1,
    switchCurrent: (_current, target) => { switches.push(target); },
    runningContainers: () => [],
    compose: (args, _env, file) => {
      if (isModelQuery(args)) return resolvedModelJson;
      composeCalls.push({ args, file });
      if (args[0] === "config" && file === preparation.rollbackCompose) throw new Error("env file /etc/opsworkbench/review-gate.env not found");
    },
  }), /review-gate\.env not found/);
  assert.deepEqual(composeCalls.map((call) => `${call.args[0]}:${call.file === preparation.rollbackCompose ? "rollback" : "candidate"}`), ["config:candidate", "config:rollback"], "the rollback model is validated immediately after the candidate's and before any up");
  assert.equal(composeCalls.some((call) => call.args[0] === "up"), false, "no service was recreated");
  assert.deepEqual(switches, [], "the current release pointer was never moved");
});

// Which services get recreated is the whole point of the three-service alignment, and it was two
// separate literal lists with nothing asserting either. This pins both: the target runs api, web and
// admin -- no review gate, whose image stays built, attested and bound but is not started here -- and
// the rollback recreates the SAME application set as the deployment it is undoing, because a rollback
// that touches a different set does not restore the state it promised. Mongo must appear in neither.
test("forward and rollback recreate exactly the three application services this target runs", async () => {
  const upState = {};
  const { item } = releaseFixture(); const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const ups = [];
  const localId = (reference) => `sha256:${sha(reference)}`;
  const revision = (reference) => Object.values(item.candidateImages).includes(reference) ? commit : rollbackCommit;
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: async () => ({ ok: true, candidateCommit: commit, rollbackCommit, images: { candidate: { api: localId(item.candidateImages.api), web: localId(item.candidateImages.web), admin: localId(item.candidateImages.admin), gate: localId(item.candidateImages.reviewGate) }, rollback: { api: localId(item.rollback.images.api), web: localId(item.rollback.images.web), admin: localId(item.rollback.images.admin), gate: localId(item.rollback.images.reviewGate) } } }),
    images: { remoteInspect: (reference) => `Name: ${reference}
`, pull: () => {}, localInspect: (reference) => ({ Id: localId(reference), RepoDigests: [reference], Config: { Labels: { "org.opencontainers.image.revision": revision(reference), "org.opencontainers.image.source": "https://github.com/williams342-maker/operation", "org.opencontainers.image.title": reference.includes("control-center-api") ? "opsworkbench-control-center-api" : reference.includes("control-center-web") ? "opsworkbench-control-center-web" : reference.includes("admin-web") ? "opsworkbench-control-center-admin-web" : "opsworkbench-review-gate" } } }) },
    verifyPlatformImages: async () => ({ ok: true, edgeImage: item.platform.edgeImage, mongoImage: item.platform.mongoImage }),
    agentControl: () => {}, readiness: async () => true, identity: async () => ({ source: "manifest", commit: ups.at(-1)?.rollback ? rollbackCommit : commit }), acceptancePasses: 1, switchCurrent: () => {},
    writeDeploymentRecord: () => { throw new Error("disk refused final record"); },
    runningContainers: () => composeRunning(upState.up),
    compose: (args, env, file) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); if (args[0] === "up") ups.push({ args, services: args.filter((argument) => !argument.startsWith("-") && argument !== "up"), rollback: file === preparation.rollbackCompose && env.OPSWORKBENCH_API_IMAGE === item.rollback.images.api }); },
  }), /was rolled back/);
  const forward = ups.filter((call) => !call.rollback); const rollback = ups.filter((call) => call.rollback);
  // The FULL argument vector, not just the service names. Filtering the flags out to read the services
  // would leave every flag unasserted, and the flags carry the guarantees: `--no-deps` is the only
  // reason the assertion below that mongo is never recreated is true at all, since api declares a
  // dependency on it. `--no-build` keeps a deployment from building anything, and `--force-recreate`
  // plus `--wait` are what make "recreated and healthy" mean something.
  const upCommand = (...services) => ["up", "-d", "--no-build", "--no-deps", "--force-recreate", "--wait", ...services];
  assert.deepEqual(forward.map((call) => call.args), [upCommand("api", "web", "admin"), upCommand("edge")], "forward recreates the three application services, then the edge");
  assert.deepEqual(rollback.map((call) => call.args), [upCommand("api", "web", "admin", "edge")], "rollback recreates the same application services plus the edge");
  const applicationSet = (calls) => [...new Set(calls.flatMap((call) => call.services))].filter((name) => name !== "edge").sort();
  assert.deepEqual(applicationSet(forward), applicationSet(rollback), "rollback must recreate the same application services the deployment did");
  assert.equal(ups.some((call) => call.services.includes("review-gate")), false, "this target does not run a review gate");
  assert.equal(ups.some((call) => call.services.includes("mongo")), false, "the database is never named by a deployment");
  assert.equal(ups.every((call) => call.args.includes("--no-deps")), true, "and cannot be reached through api's dependency on it");
});

const containerFixture = (name, project, bindings, image = "control-center-admin-web:abc") => ({ Name: `/${name}`, Config: { Image: image, Labels: project ? { "com.docker.compose.project": project } : {} }, HostConfig: { PortBindings: bindings } });
const adminModel = { services: { admin: { ports: [{ published: "18081", protocol: "tcp", host_ip: "127.0.0.1" }] } } };

test("a container this project does not own, holding a published port, is a conflict", () => {
  // The real case on this target: started with a bare `docker run`, so it carries no Compose labels at
  // all. Compose adopts only by label, so it will neither reuse nor stop it -- it will try to bind the
  // same port a second time.
  const unmanaged = containerFixture("opsworkbench-admin-web-1", null, { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] });
  const conflicts = detectForeignPortConflicts(adminModel, ["admin"], "opsworkbench", [unmanaged]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].service, "admin"); assert.equal(conflicts[0].container, "opsworkbench-admin-web-1"); assert.equal(conflicts[0].project, null);
  // A container belonging to a DIFFERENT project is equally a conflict: it is not ours to recreate.
  assert.equal(detectForeignPortConflicts(adminModel, ["admin"], "opsworkbench", [containerFixture("other-admin-1", "somethingelse", { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] })]).length, 1);
});

test("a container this project already owns is not a conflict, because compose recreates it by label", () => {
  const ours = containerFixture("opsworkbench-admin-1", "opsworkbench", { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] });
  assert.deepEqual(detectForeignPortConflicts(adminModel, ["admin"], "opsworkbench", [ours]), []);
});

test("a wildcard host address conflicts with a loopback publication, and unrelated bindings do not", () => {
  // 0.0.0.0:18081 blocks 127.0.0.1:18081. Comparing the addresses as strings reports no conflict and
  // then the bind fails at `up`, which is the entire failure this check exists to prevent.
  const wildcard = containerFixture("wildcard-1", null, { "8080/tcp": [{ HostIp: "0.0.0.0", HostPort: "18081" }] });
  assert.equal(detectForeignPortConflicts(adminModel, ["admin"], "opsworkbench", [wildcard]).length, 1);
  const unset = containerFixture("unset-1", null, { "8080/tcp": [{ HostIp: "", HostPort: "18081" }] });
  assert.equal(detectForeignPortConflicts(adminModel, ["admin"], "opsworkbench", [unset]).length, 1);
  const otherPort = containerFixture("other-port-1", null, { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18082" }] });
  const otherProtocol = containerFixture("other-proto-1", null, { "8080/udp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] });
  const otherAddress = containerFixture("other-address-1", null, { "8080/tcp": [{ HostIp: "10.0.0.5", HostPort: "18081" }] });
  assert.deepEqual(detectForeignPortConflicts(adminModel, ["admin"], "opsworkbench", [otherPort, otherProtocol, otherAddress]), []);
  // A service the deployment does not touch is not scanned for.
  assert.deepEqual(detectForeignPortConflicts(adminModel, ["api"], "opsworkbench", [containerFixture("x-1", null, { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] })]), []);
});

test("a published port is compared as a number, and a shape that cannot be evaluated refuses", () => {
  const container = (hostPort) => containerFixture("held-1", null, { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: hostPort }] });
  // Compose preserves a long-syntax `published: "08080"` verbatim while the daemon reports the held
  // binding as "8080". Compared as strings those do not match, and a genuinely taken port reads as
  // free -- a check that looks present and finds nothing.
  const padded = { services: { admin: { ports: [{ published: "08080", protocol: "tcp", host_ip: "127.0.0.1" }] } } };
  assert.equal(detectForeignPortConflicts(padded, ["admin"], "opsworkbench", [container("8080")]).length, 1);
  // Padded past five digits is refused rather than parsed: refusing a shape this cannot evaluate is
  // the safe direction, and silently accepting it would invite the string comparison back.
  const overPadded = { services: { admin: { ports: [{ published: "018081", protocol: "tcp" }] } } };
  assert.throws(() => detectForeignPortConflicts(overPadded, ["admin"], "opsworkbench", []), /cannot evaluate/);
  const numeric = { services: { admin: { ports: [{ published: 18081, protocol: "tcp", host_ip: "127.0.0.1" }] } } };
  assert.equal(detectForeignPortConflicts(numeric, ["admin"], "opsworkbench", [container("18081")]).length, 1);
  // A RANGE that compose did not expand matches no single held port, so it must refuse rather than
  // report no conflict.
  const range = { services: { admin: { ports: [{ published: "18081-18085", protocol: "tcp", host_ip: "127.0.0.1" }] } } };
  assert.throws(() => detectForeignPortConflicts(range, ["admin"], "opsworkbench", [container("18081")]), /cannot evaluate/);
  const outOfRange = { services: { admin: { ports: [{ published: "99999", protocol: "tcp" }] } } };
  assert.throws(() => detectForeignPortConflicts(outOfRange, ["admin"], "opsworkbench", []), /cannot evaluate/);
  // A malformed value on the HELD side is skipped rather than coerced into a spurious match.
  assert.deepEqual(detectForeignPortConflicts(numeric, ["admin"], "opsworkbench", [container("")]), []);
});

test("a held port refuses the deployment before any service is recreated", async () => {
  const { item } = releaseFixture(); const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const composeCalls = []; const switches = [];
  const localId = (reference) => `sha256:${sha(reference)}`;
  const revision = (reference) => Object.values(item.candidateImages).includes(reference) ? commit : rollbackCommit;
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: async () => ({ ok: true, candidateCommit: commit, rollbackCommit, images: { candidate: { api: localId(item.candidateImages.api), web: localId(item.candidateImages.web), admin: localId(item.candidateImages.admin), gate: localId(item.candidateImages.reviewGate) }, rollback: { api: localId(item.rollback.images.api), web: localId(item.rollback.images.web), admin: localId(item.rollback.images.admin), gate: localId(item.rollback.images.reviewGate) } } }),
    images: { remoteInspect: (reference) => `Name: ${reference}
`, pull: () => {}, localInspect: (reference) => ({ Id: localId(reference), RepoDigests: [reference], Config: { Labels: { "org.opencontainers.image.revision": revision(reference), "org.opencontainers.image.source": "https://github.com/williams342-maker/operation", "org.opencontainers.image.title": reference.includes("control-center-api") ? "opsworkbench-control-center-api" : reference.includes("control-center-web") ? "opsworkbench-control-center-web" : reference.includes("admin-web") ? "opsworkbench-control-center-admin-web" : "opsworkbench-review-gate" } } }) },
    verifyPlatformImages: async () => ({ ok: true, edgeImage: item.platform.edgeImage, mongoImage: item.platform.mongoImage }),
    agentControl: () => {}, readiness: async () => true, identity: async () => ({ source: "manifest", commit }), acceptancePasses: 1,
    switchCurrent: (_current, target) => { switches.push(target); },
    runningContainers: () => [containerFixture("opsworkbench-admin-web-1", null, { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] })],
    compose: (args, _env, file) => { if (isModelQuery(args)) return resolvedModelJson; composeCalls.push({ args, file }); },
  }), /host ports are held by containers this project does not own/);
  assert.equal(composeCalls.some((call) => call.args[0] === "up"), false, "no service was recreated");
  assert.deepEqual(switches, [], "the current release pointer was never moved");
});

// The shape a first deployment onto this host has to accept: the rollback release predates Forge, its
// images were built on the box and never pushed, and it carries no production compose of its own.
// Omitting keys by rest-destructuring leaves a binding behind for every key dropped, which reads as
// eight unused variables. Naming the keys to remove says what is happening and leaves nothing.
const without = (object, ...keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

const hostVerifiedPlan = (root) => {
  const item = plan(root);
  item.rollback = { ...without(item.rollback, "images"), evidence: "host-verified", adoptionRecords: [] };
  item.forgeEvidence = without(item.forgeEvidence, "rollbackPath", "rollbackSha256");
  return item;
};
// A host-verified rollback target is a release that is ALREADY installed and serving, so the fixture
// has to put it there. The attested path installs it during preparation; this one must not, which is
// the behaviour under test.
const materialiseRollbackRelease = (item, { manifest = true } = {}) => {
  const app = item.rollback.releaseDirectory;
  fs.mkdirSync(path.join(app, "deploy"), { recursive: true });
  fs.mkdirSync(path.join(app, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(app, "deploy", "docker-compose.production.yml"), "services: {}\n");
  fs.writeFileSync(path.join(app, "scripts", "install-reviewed-agent.sh"), "#!/bin/sh\n");
  // A live release carries its own manifest beside the tree, and that is what a recovery mounts so a
  // rolled-back service reports the PREDECESSOR's identity. `manifest: false` is the host that has none.
  if (manifest) fs.copyFileSync(path.join(item.rollback.bundleDirectory, `opsworkbench-control-center-${item.rollback.tag.slice(1)}.manifest.json`), path.join(path.dirname(app), "release.manifest.json"));
};

const runningImage = (digit) => `sha256:${String(digit).repeat(64).slice(0, 64)}`;
// Containers carry a full id and a state. Measurement requires both now: a compose-labelled predecessor
// has to be RUNNING, because labels outlive every container Compose ever made, and an id is what the
// durable record names. A fixture without an id let a mutation that never records one pass unnoticed.
const idFor = (name) => Buffer.from(name).toString("hex").padEnd(64, "0").slice(0, 64);
const adminContainerId = idFor("opsworkbench-admin-web-1");
// The deployer now measures WHAT IS RUNNING after each `up`, so a fixture has to move with it: before a
// deployment these are the predecessor's containers, afterwards the candidate's, and after a recovery
// the predecessor's again. A fixture pinned to one answer would let the check pass in a world where
// nothing was ever recreated.
const imageIdOf = (reference) => (/^sha256:[a-f0-9]{64}$/.test(reference) ? reference : `sha256:${sha(reference)}`);
const composeRunning = (up, project = "opsworkbench") => (up ? ["api", "web", "admin"].map((service) => ({
  Id: idFor(`${project}-${service}-1`), Name: `/${project}-${service}-1`, Image: imageIdOf(up[service]),
  State: { Running: true, Status: "running" },
  Config: { Image: "local-tag:abc", Labels: { "com.docker.compose.project": project, "com.docker.compose.service": service } },
  HostConfig: { PortBindings: {} },
})) : []);
const recordUp = (state) => (args, env) => { if (args[0] === "up") state.up = { api: env.OPSWORKBENCH_API_IMAGE, web: env.OPSWORKBENCH_WEB_IMAGE, admin: env.OPSWORKBENCH_ADMIN_IMAGE }; };
const containerFor = (name, project, service, image, bindings = {}, running = true) => ({
  Id: idFor(name), Name: `/${name}`, Image: image, State: { Running: running, Status: running ? "running" : "exited" },
  Config: { Image: "local-tag:abc", Labels: { ...(project ? { "com.docker.compose.project": project } : {}), ...(service ? { "com.docker.compose.service": service } : {}) } },
  HostConfig: { PortBindings: bindings },
});
// The record the adoption tool writes when a person stops the unmanaged container. It is what turns "the
// thing holding that port" into "the container someone deliberately stopped".
const adoptionRecordFor = (item, containerId) => {
  const file = path.join(path.dirname(item.releaseRoot), `adoption-${containerId.slice(0, 8)}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: "opsworkbench-container-adoption-v3", capturedAt: "2026-09-09T00:00:00Z", containerId, name: "opsworkbench-admin-web-1", imageReference: "control-center-admin-web:abc", imageId: `sha256:${"e".repeat(64)}`, publishedPorts: ["127.0.0.1:18081->8080/tcp"] }, null, 2)}\n`);
  return file;
};
const liveModel = { services: {
  api: {}, web: {},
  admin: { ports: [{ published: "18081", protocol: "tcp", host_ip: "127.0.0.1" }] },
} };

test("the host-verified plan carries no rollback images or rollback forge document, and the attested one must", () => {
  // A real temporary directory, not a Windows path literal. path.isAbsolute rejects one of those on
  // Linux, so it passes on this machine and fails in CI -- which is exactly what it did.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "host-verified-plan-"));
  const hostVerified = hostVerifiedPlan(root);
  assert.equal(parseDeploymentPlan(hostVerified).rollback.evidence, "host-verified");
  // A plan that names rollback images under host-verified is claiming authority it does not have: the
  // point of the mode is that the host says what the rollback is, not the plan.
  assert.throws(() => parseDeploymentPlan({ ...hostVerified, rollback: { ...hostVerified.rollback, images: plan(root).rollback.images } }), /rollback has missing or unknown fields/);
  assert.throws(() => parseDeploymentPlan({ ...hostVerified, forgeEvidence: plan(root).forgeEvidence }), /forgeEvidence has missing or unknown fields/);
  // And the attested mode still requires both.
  const attested = plan(root);
  assert.throws(() => parseDeploymentPlan({ ...attested, rollback: without(attested.rollback, "images") }), /rollback has missing or unknown fields/);
  // The mode itself has to be stated. There is no default, because defaulting would silently pick one,
  // and the one it picked would be the weaker of the two on any plan that forgot to say.
  assert.throws(() => parseDeploymentPlan({ ...attested, rollback: without(attested.rollback, "evidence") }), /attested or host-verified/);
  assert.throws(() => parseDeploymentPlan({ ...attested, rollback: { ...attested.rollback, evidence: "trust-me" } }), /attested or host-verified/);
  // A host-verified rollback is still a real release with a real attested bundle behind it.
  assert.throws(() => parseDeploymentPlan({ ...hostVerified, rollback: { ...hostVerified.rollback, evidenceSha256: "nope" } }), /rollback identity is invalid/);
});

test("a predecessor is identified by running state or by an adoption record, never by uniqueness alone", () => {
  const adopted = new Set([adminContainerId]);
  const containers = [
    containerFor("opsworkbench-api-1", "opsworkbench", "api", runningImage(1)),
    containerFor("opsworkbench-web-1", "opsworkbench", "web", runningImage(2)),
    // The admin surface on this host is NOT compose-managed, and by this point it has been STOPPED --
    // it had to be, or it would still hold the port and the conflict check would refuse. It is found by
    // the port binding it still carries, and confirmed by the adoption record naming its id.
    containerFor("opsworkbench-admin-web-1", null, null, runningImage(3), { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] }, false),
  ];
  const measured = measurePredecessorImages(liveModel, ["api", "web", "admin"], "opsworkbench", containers, adopted);
  assert.deepEqual(Object.fromEntries(Object.entries(measured).map(([service, entry]) => [service, entry.image])), { api: runningImage(1), web: runningImage(2), admin: runningImage(3) });
  assert.equal(measured.api.matchedBy, "compose-label");
  assert.equal(measured.api.containerId, idFor("opsworkbench-api-1"), "the id is recorded, not left blank");
  assert.equal(measured.admin.matchedBy, "adoption-record");
  assert.equal(measured.admin.containerId, adminContainerId);

  // A STALE LABELLED CONTAINER MUST NOT WIN. This host keeps 97 releases of history and Compose labels
  // outlive every container it ever made, so an old stopped api container carries the same labels as the
  // live one. Uniqueness alone would have picked whichever was the only match.
  const stale = containerFor("opsworkbench-api-old", "opsworkbench", "api", runningImage(7), {}, false);
  const withStale = [stale, ...containers];
  assert.equal(measurePredecessorImages(liveModel, ["api"], "opsworkbench", withStale, adopted).api.image, runningImage(1), "the running one is the predecessor");
  // And if the ONLY labelled match is stale, that is a refusal rather than a silent fallback.
  assert.throws(() => measurePredecessorImages(liveModel, ["api"], "opsworkbench", [stale], adopted), /cannot identify exactly one predecessor container for api: found 0/);

  // A container holding the port that nobody adopted is refused: it is not enough to be the only thing
  // on that port, because several stopped containers in this host's history could equally claim it.
  assert.throws(() => measurePredecessorImages(liveModel, ["admin"], "opsworkbench", containers, new Set()), /not named by any adoption record/);
  // A NON-EMPTY set naming the WRONG container is refused too. Testing only "some ids" against "no ids"
  // could not tell an exact membership check from one that merely asks whether any record exists.
  assert.throws(() => measurePredecessorImages(liveModel, ["admin"], "opsworkbench", containers, new Set([idFor("something-else")])), /not named by any adoption record/);
  // And with two containers on that port, the adopted one is chosen rather than refused for ambiguity.
  const otherOnPort = containerFor("stale-admin", null, null, runningImage(9), { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] }, false);
  assert.equal(measurePredecessorImages(liveModel, ["admin"], "opsworkbench", [otherOnPort, ...containers], adopted).admin.containerId, adminContainerId);

  // A COMPOSE ONE-OFF is not the service. `docker compose run api ...` carries this project's and this
  // service's labels and can be running while the real container is stopped, so it would otherwise be
  // the only running match and would be selected as the thing being replaced.
  const oneOff = { ...containerFor("opsworkbench-api-run-abc", "opsworkbench", "api", runningImage(11)) };
  oneOff.Config.Labels["com.docker.compose.oneoff"] = "True";
  assert.equal(measurePredecessorImages(liveModel, ["api"], "opsworkbench", [oneOff, ...containers], adopted).api.image, runningImage(1), "the real container is chosen over a running one-off");
  assert.throws(() => measurePredecessorImages(liveModel, ["api"], "opsworkbench", [oneOff], adopted), /found 0/, "and a one-off alone is not a predecessor");
  // Two running labelled matches is still ambiguous.
  const twin = containerFor("opsworkbench-api-2", "opsworkbench", "api", runningImage(8));
  assert.throws(() => measurePredecessorImages(liveModel, ["api"], "opsworkbench", [...containers, twin], adopted), /found 2/);
  // Nothing at all for a service is a refusal, not an empty rollback.
  assert.throws(() => measurePredecessorImages(liveModel, ["api", "web", "admin"], "opsworkbench", containers.slice(0, 2), adopted), /cannot identify exactly one predecessor container for admin: found 0/);
  // A container whose image is a tag rather than a content digest cannot be rolled back TO.
  assert.throws(() => measurePredecessorImages(liveModel, ["api"], "opsworkbench", [containerFor("opsworkbench-api-1", "opsworkbench", "api", "control-center-api:abc")], adopted), /no content-addressed image id/);
  // Nor can one the daemon reports without a full id.
  const idless = { ...containerFor("opsworkbench-api-1", "opsworkbench", "api", runningImage(1)), Id: "" };
  assert.throws(() => measurePredecessorImages(liveModel, ["api"], "opsworkbench", [idless], adopted), /no full container id/);
  // Two services reporting the same image means the measurement did not distinguish them.
  const duplicated = [containerFor("opsworkbench-api-1", "opsworkbench", "api", runningImage(1)), containerFor("opsworkbench-web-1", "opsworkbench", "web", runningImage(1))];
  assert.throws(() => measurePredecessorImages(liveModel, ["api", "web"], "opsworkbench", duplicated, adopted), /same running image/);
});

test("adoption records are read as records, not trusted as a list of ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adoption-ids-"));
  const write = (name, body) => { const file = path.join(root, name); fs.writeFileSync(file, JSON.stringify(body)); return file; };
  const good = write("good.json", { schemaVersion: "opsworkbench-container-adoption-v3", containerId: adminContainerId, name: "opsworkbench-admin-web-1" });
  assert.deepEqual([...readAdoptedContainerIds([good])], [adminContainerId]);
  assert.deepEqual([...readAdoptedContainerIds([])], [], "no records means no adopted ids, which is a valid plan");
  // A record of the wrong schema, or with no usable id, is a refusal. Dropping it silently would leave
  // the predecessor unidentifiable later with no explanation of why.
  assert.throws(() => readAdoptedContainerIds([write("v2.json", { schemaVersion: "opsworkbench-container-adoption-v2", containerId: adminContainerId })]), /missing or malformed/);
  assert.throws(() => readAdoptedContainerIds([write("short.json", { schemaVersion: "opsworkbench-container-adoption-v3", containerId: "abc" })]), /missing or malformed/);
});

test("an adoption record that is not the caller's own file is refused", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adoption-trust-"));
  const file = path.join(root, "record.json");
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: "opsworkbench-container-adoption-v3", containerId: adminContainerId, name: "opsworkbench-admin-web-1" }));
  // This decides which container becomes the rollback image, and it is read by a root process. A file
  // another account can replace decides that too, so ownership is checked and the uid is injectable so
  // the check is exercised everywhere rather than only where process.getuid exists.
  assert.deepEqual([...readAdoptedContainerIds([file], { uid: fs.statSync(file).uid })], [adminContainerId]);
  assert.throws(() => readAdoptedContainerIds([file], { uid: fs.statSync(file).uid + 1 }), /not owned by this user/);
  if (process.platform !== "win32") {
    const link = path.join(root, "link.json");
    fs.symlinkSync(file, link, "file");
    assert.throws(() => readAdoptedContainerIds([link]), /not a regular file/);
  }

  // The time-of-check guard: the bytes must come from the file that was inspected. Reading by PATH
  // after stat-ing a path is indistinguishable from reading the descriptor unless the file is swapped
  // in between, so the filesystem is injected here to make that swap happen.
  const swapped = {
    lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, dev: 1, ino: 100 }),
    openSync: () => 7,
    fstatSync: () => ({ dev: 1, ino: 999, uid: 0 }),
    // The stub asserts WHAT it was asked to read. Ignoring the argument would accept an implementation
    // that reads the path again after stat-ing it, which is the thing the descriptor is here to avoid.
    readFileSync: (target) => { assert.equal(target, 7, "the record is read from the descriptor that was stat-ed, not from the path"); return JSON.stringify({ schemaVersion: "opsworkbench-container-adoption-v3", containerId: adminContainerId, name: "x" }); },
    closeSync: () => {},
  };
  assert.throws(() => readAdoptedContainerIds([file], { fs: swapped, uid: 0 }), /changed while being read/);
  // The same stub with a consistent inode is accepted, so the refusal above is the swap and not the stub.
  const consistent = { ...swapped, fstatSync: () => ({ dev: 1, ino: 100, uid: 0 }) };
  assert.deepEqual([...readAdoptedContainerIds([file], { fs: consistent, uid: 0 })], [adminContainerId]);
});

test("a host-verified rollback accepts a bundle from before the agent artifact existed; an attested one does not", () => {
  // The agent a deployment installs is always the CANDIDATE's, and nothing reads a rollback bundle's,
  // so requiring one of a rollback was a check on a field never used. It still applies to the candidate
  // and to an attested rollback, where a missing one means a malformed release.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-deploy-noagent-"));
  const item = plan(root);
  fs.mkdirSync(item.stagingRoot); fs.mkdirSync(item.releaseRoot);
  writeReleaseBundle(item.bundleDirectory, item.tag, commit, tree);
  const rollback = writeReleaseBundle(item.rollback.bundleDirectory, item.rollback.tag, rollbackCommit, rollbackTree, { omitAgent: true });
  item.rollback.evidenceSha256 = rollback.archiveSha256;

  // Attested mode still refuses it.
  assert.throws(() => prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) }), /rollback release bundle failed verification/);

  // Host-verified mode accepts it, and everything else about the rollback is still verified: the
  // bundle's attestation, its manifest commit, its archive digest and its tree.
  item.rollback = { ...without(item.rollback, "images"), evidence: "host-verified", adoptionRecords: [] };
  item.forgeEvidence = without(item.forgeEvidence, "rollbackPath", "rollbackSha256");
  materialiseRollbackRelease(item);
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  assert.equal(preparation.rollbackControlCenter, path.resolve(item.rollback.releaseDirectory));

  // RE-VERIFICATION MUST USE THE SAME RULE. It runs again immediately before the first mutation, so a
  // stricter check there would refuse at the point of no return over the very bundle preparation just
  // accepted. Driven directly, because nothing else in the suite reaches it with this bundle shape.
  reverifyPreparedRelease(preparation, { verifyAttestation: () => ({ verified: true }) });

  // A WRONG archive digest is still caught, so accepting the missing agent artifact did not loosen the
  // rest of the bundle check.
  const wrong = plan(fs.mkdtempSync(path.join(os.tmpdir(), "trusted-deploy-wrong-")));
  fs.mkdirSync(wrong.stagingRoot); fs.mkdirSync(wrong.releaseRoot);
  writeReleaseBundle(wrong.bundleDirectory, wrong.tag, commit, tree);
  writeReleaseBundle(wrong.rollback.bundleDirectory, wrong.rollback.tag, rollbackCommit, rollbackTree, { omitAgent: true });
  wrong.rollback = { ...without(wrong.rollback, "images"), evidence: "host-verified", adoptionRecords: [], evidenceSha256: "f".repeat(64) };
  wrong.forgeEvidence = without(wrong.forgeEvidence, "rollbackPath", "rollbackSha256");
  materialiseRollbackRelease(wrong);
  assert.throws(() => prepareReviewedRelease(wrong, { verifyAttestation: () => ({ verified: true }) }), /rollback artifact digest differs/);
});

test("a host-verified rollback target is verified where it stands, never reinstalled over", () => {
  const { item } = releaseFixture();
  item.rollback = { ...without(item.rollback, "images"), evidence: "host-verified", adoptionRecords: [adoptionRecordFor(item, adminContainerId)] };
  item.forgeEvidence = without(item.forgeEvidence, "rollbackPath", "rollbackSha256");
  materialiseRollbackRelease(item);

  // Production's live release directory holds two files that are in no release bundle -- they were
  // written there by something outside the release process and the admin image is built from them.
  // Reinstalling the tree would take them away, and the running admin surface is built from them.
  // Verification in place has to tolerate exactly those two and nothing else.
  const offChain = path.join(item.rollback.releaseDirectory, "apps", "web", "Dockerfile.admin");
  fs.mkdirSync(path.dirname(offChain), { recursive: true });
  fs.writeFileSync(offChain, "FROM nginx\n");
  const marker = fs.readFileSync(offChain, "utf8");

  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  assert.equal(preparation.rollbackControlCenter, path.resolve(item.rollback.releaseDirectory));
  assert.equal(fs.existsSync(offChain), true, "the off-chain file production actually has is still there");
  assert.equal(fs.readFileSync(offChain, "utf8"), marker);

  // Anything else differing IS a refusal: tolerating the two known files is not tolerating drift.
  const { item: second } = releaseFixture();
  second.rollback = { ...without(second.rollback, "images"), evidence: "host-verified", adoptionRecords: [] };
  second.forgeEvidence = without(second.forgeEvidence, "rollbackPath", "rollbackSha256");
  materialiseRollbackRelease(second);
  fs.writeFileSync(path.join(second.rollback.releaseDirectory, "deploy", "docker-compose.production.yml"), "services: { drifted: {} }\n");
  assert.throws(() => prepareReviewedRelease(second, { verifyAttestation: () => ({ verified: true }) }), /differs from its attested bundle/);

  // And an EXTRA file nobody explained is a refusal too. Tolerating the two known ones BY EXACT
  // PATH is the point: a tolerance that accepted any unexplained file would accept anything written
  // into the live release directory, which is exactly how the two known ones got there.
  const { item: third } = releaseFixture();
  third.rollback = { ...without(third.rollback, "images"), evidence: "host-verified", adoptionRecords: [] };
  third.forgeEvidence = without(third.forgeEvidence, "rollbackPath", "rollbackSha256");
  materialiseRollbackRelease(third);
  fs.writeFileSync(path.join(third.rollback.releaseDirectory, "deploy", "someone-put-this-here.conf"), "x\n");
  assert.throws(() => prepareReviewedRelease(third, { verifyAttestation: () => ({ verified: true }) }), /someone-put-this-here/);
});

test("a host-verified deployment rolls back to the images it measured, not to anything the plan named", async () => {
  const upState = {};
  const { item } = releaseFixture();
  item.rollback = { ...without(item.rollback, "images"), evidence: "host-verified", adoptionRecords: [adoptionRecordFor(item, adminContainerId)] };
  item.forgeEvidence = without(item.forgeEvidence, "rollbackPath", "rollbackSha256");
  materialiseRollbackRelease(item);
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");

  const measured = { api: runningImage(1), web: runningImage(2), admin: runningImage(3) };
  // What `docker ps` shows: the admin container has already been stopped, so it is not here and holds
  // no port. What `docker ps --all` shows: it is still there, and still says which image it ran.
  const running = [
    containerFor("opsworkbench-api-1", "opsworkbench", "api", measured.api),
    containerFor("opsworkbench-web-1", "opsworkbench", "web", measured.web),
  ];
  const all = [...running, containerFor("opsworkbench-admin-web-1", null, null, measured.admin, { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] }, false)];
  const ups = [];
  const localId = (reference) => `sha256:${sha(reference)}`;
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    // The rehearsal names the candidate only. Under host-verified that is enough, and it is exactly the
    // reduction in assurance the mode exists to make explicit.
    verifyCompatibility: async () => ({ ok: true, candidateCommit: commit, rollbackCommit: "0".repeat(40) }),
    images: { remoteInspect: (reference) => `Name: ${reference}\n`, pull: () => {}, localInspect: (reference) => ({ Id: localId(reference), RepoDigests: [reference], Config: { Labels: { "org.opencontainers.image.revision": commit, "org.opencontainers.image.source": "https://github.com/williams342-maker/operation", "org.opencontainers.image.title": reference.includes("control-center-api") ? "opsworkbench-control-center-api" : reference.includes("control-center-web") ? "opsworkbench-control-center-web" : reference.includes("admin-web") ? "opsworkbench-control-center-admin-web" : "opsworkbench-review-gate" } } }) },
    verifyPlatformImages: async () => ({ ok: true, edgeImage: item.platform.edgeImage, mongoImage: item.platform.mongoImage }),
    agentControl: () => {}, readiness: async () => true, identity: async () => ({ source: "manifest", commit: ups.at(-1)?.api === item.candidateImages.api ? commit : rollbackCommit }), acceptancePasses: 1, switchCurrent: () => {},
    writeDeploymentRecord: () => { throw new Error("disk refused final record"); },
    runningContainers: () => (upState.up ? composeRunning(upState.up) : running), allContainers: () => all,
    compose: (args, env, file) => {
      if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env);
      if (args[0] === "up") ups.push({ api: env.OPSWORKBENCH_API_IMAGE, web: env.OPSWORKBENCH_WEB_IMAGE, admin: env.OPSWORKBENCH_ADMIN_IMAGE, file });
    },
  }), /was rolled back/);

  const rollbackUp = ups.at(-1);
  // ALL THREE application images, not a sample. Asserting api and admin left web unchecked, and pinning
  // web to the candidate during rollback passed the whole suite.
  assert.equal(rollbackUp.api, measured.api, "the rollback runs the api image that was measured as serving");
  assert.equal(rollbackUp.web, measured.web, "and the web image");
  assert.equal(rollbackUp.admin, measured.admin, "including the admin image, which no compose label pointed at");
  // Against the candidate's LOCAL id. Comparing a local image id to a registry reference can never be
  // equal, so asserting that was asserting nothing.
  assert.notEqual(rollbackUp.api, localId(item.candidateImages.api), "none of them is the candidate it just tried to deploy");
  // The rollback release carries no compose of its own on this lineage, so the candidate's is used.
  assert.equal(rollbackUp.file, preparation.compose, "and it runs the candidate compose, because the rollback release has none");
  assert.equal(preparation.rollbackCompose, preparation.compose);

  // The record has to say what this kind of rollback does not prove, or a reader will assume it does.
  const record = JSON.parse(fs.readFileSync(path.join(preparation.stage, "rollback-ready.json"), "utf8"));
  const evidence = record.imageEvidence.find((entry) => entry.role === "rollback-evidence");
  assert.equal(evidence.kind, "host-verified");
  // The durable record has to NAME the images to go back to. It is written before any container is
  // recreated, so a crash part way through leaves this file as the only mapping back.
  assert.equal(evidence.predecessors.api.image, measured.api);
  assert.equal(evidence.predecessors.web.image, measured.web);
  assert.equal(evidence.predecessors.admin.image, measured.admin);
  assert.equal(evidence.predecessors.admin.container, "opsworkbench-admin-web-1");
  // The container ID, not just the name. The fixture used to carry no id at all, so an implementation
  // that never recorded one was indistinguishable from this one.
  assert.equal(evidence.predecessors.admin.containerId, adminContainerId);
  assert.equal(evidence.predecessors.admin.matchedBy, "adoption-record");
  assert.equal(evidence.predecessors.api.containerId, idFor("opsworkbench-api-1"));
  for (const field of ["notAttested", "notRehearsed", "notItsOwnCompose"]) assert.match(evidence[field], /\S/);
  // And no rollback image was inspected as a registry artefact, because none of them is one.
  assert.equal(record.imageEvidence.some((entry) => entry.set === "rollback"), false);
});

test("a host-verified deployment refuses when a service is already running the candidate image", async () => {
  const { item } = releaseFixture();
  item.rollback = { ...without(item.rollback, "images"), evidence: "host-verified", adoptionRecords: [adoptionRecordFor(item, adminContainerId)] };
  item.forgeEvidence = without(item.forgeEvidence, "rollbackPath", "rollbackSha256");
  materialiseRollbackRelease(item);
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const localId = (reference) => `sha256:${sha(reference)}`;
  // The api container is already on the candidate image, so there is nothing to go back to and the
  // deployment would be recording itself as its own rollback target. Written as the LOCAL image id,
  // because that is what the host reports and what the candidate reference resolves to on this host.
  // A registry reference and a content id are different namespaces and would never compare equal, so
  // asserting against the reference would have passed while testing nothing.
  const running = [
    containerFor("opsworkbench-api-1", "opsworkbench", "api", localId(item.candidateImages.api)),
    containerFor("opsworkbench-web-1", "opsworkbench", "web", runningImage(2)),
  ];
  const all = [...running, containerFor("opsworkbench-admin-web-1", null, null, runningImage(3), { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] }, false)];
  const ups = [];
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: async () => ({ ok: true, candidateCommit: commit, rollbackCommit: "0".repeat(40) }),
    images: { remoteInspect: (reference) => `Name: ${reference}\n`, pull: () => {}, localInspect: (reference) => ({ Id: localId(reference), RepoDigests: [reference], Config: { Labels: { "org.opencontainers.image.revision": commit, "org.opencontainers.image.source": "https://github.com/williams342-maker/operation", "org.opencontainers.image.title": reference.includes("control-center-api") ? "opsworkbench-control-center-api" : reference.includes("control-center-web") ? "opsworkbench-control-center-web" : reference.includes("admin-web") ? "opsworkbench-control-center-admin-web" : "opsworkbench-review-gate" } } }) },
    verifyPlatformImages: async () => ({ ok: true, edgeImage: item.platform.edgeImage, mongoImage: item.platform.mongoImage }),
    agentControl: () => {}, readiness: async () => true, identity: async () => ({ source: "manifest", commit }), acceptancePasses: 1, switchCurrent: () => {},
    runningContainers: () => running, allContainers: () => all,
    compose: (args) => { if (isModelQuery(args)) return resolvedModelJson; if (args[0] === "up") ups.push(args); },
  }), /already running the candidate image/);
  assert.deepEqual(ups, [], "and it refuses before recreating anything");
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

test("the REAL forge and compatibility verifiers accept a host-verified plan, and still bind the candidate", () => {
  // These two are what the deployment tests stub out, and stubbing them is what hid a production path
  // that could not run at all: the verifiers were still reading plan.forgeEvidence.rollbackPath and
  // still demanding the rehearsal name the plan's rollback, neither of which a host-verified plan has.
  // Exercised here directly, with no hooks standing in for them.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "host-verified-real-"));
  const item = hostVerifiedPlan(root);

  const forgeBytes = Buffer.from(`${JSON.stringify({ schemaVersion: "forge-build-v2", buildId: `build-${item.tag}`, sourceRepository: "https://github.com/williams342-maker/operation", sourceCommit: item.commit, sourceTree: item.tree, sourceTag: item.tag, backendImageDigest: item.candidateImages.api, frontendImageDigest: item.candidateImages.web, adminImageDigest: item.candidateImages.admin, reviewGateImageDigest: item.candidateImages.reviewGate, builderIdentity: `https://github.com/williams342-maker/operation/.github/workflows/control-center-images.yml@refs/tags/${item.tag}`, builderRunnerEnvironment: "github-hosted", issuedAt: "2026-09-05T00:00:00Z" }, null, 2)}\n`);
  fs.writeFileSync(item.forgeEvidence.candidatePath, forgeBytes);
  item.forgeEvidence.candidateSha256 = sha(forgeBytes);
  let imageAttestations = 0;
  const forge = verifyForgeEvidence(item, { verifyAttestation: () => ({ verified: true }), verifyImageAttestation: () => { imageAttestations += 1; } });
  assert.equal(forge.ok, true);
  assert.equal(forge.rollback, null, "there is no rollback forge document, and none is invented");
  assert.equal(imageAttestations, 4, "the candidate's four images are still each attested");

  // The rehearsal names a DIFFERENT predecessor -- one of the candidate's own lineage that can actually
  // be rebuilt -- which is the whole shape of a host-verified deployment.
  const scenarios = Object.fromEntries(["forward_compatibility", "rollback_compatibility", "migration_boundaries", "old_app_new_schema", "new_app_old_schema", "interrupted_migration", "failed_deployment_after_migration", "rollback_after_partial_switch", "service_restart_during_transition", "predecessor_artifacts_retained", "rollback_immutable_images", "rollback_target_independently_verified"].map((name) => [name, name.includes("migration") ? "not-applicable-no-migrations" : "passed"]));
  const ids = (start) => Object.fromEntries(["api", "web", "admin", "gate"].map((role, index) => [role, `sha256:${String(start + index).repeat(64).slice(0, 64)}`]));
  const rehearsalFor = (rollbackTag, rollbackCommit) => {
    const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: "opsworkbench-schema-rehearsal-v1", candidateTag: item.tag, candidateCommit: item.commit, rollbackTag, rollbackCommit, mongoTopology: "replica-set", images: { candidate: ids(1), rollback: ids(5) }, migrationsPresent: false, scenarios }, null, 2)}\n`);
    fs.writeFileSync(item.compatibilityEvidence.path, bytes);
    item.compatibilityEvidence.sha256 = sha(bytes);
  };
  rehearsalFor("v0.2.5-operate", "e".repeat(40));
  const compatibility = verifyCompatibilityEvidence(item, { verifyAttestation: () => ({ verified: true }) });
  assert.equal(compatibility.ok, true, "a rehearsal against another predecessor is accepted");

  // What is still bound: the candidate. A rehearsal for a different candidate is refused in both modes.
  const wrongCandidate = { ...item, tag: "v0.9.9-operate" };
  assert.throws(() => verifyCompatibilityEvidence(wrongCandidate, { verifyAttestation: () => ({ verified: true }) }), /names a different candidate/);
  // And under the attested mode the rollback must still be named exactly.
  const attested = { ...item, rollback: { ...plan(root).rollback } };
  assert.throws(() => verifyCompatibilityEvidence(attested, { verifyAttestation: () => ({ verified: true }) }), /names a different candidate, rollback, or topology/);
});

test("a release directory may be named after the release's own commit, as production names every one of its 97 releases", () => {
  const root = "/opt/opsworkbench/releases";
  const release = { tag: "v0.1.2-operate", commit: "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b" };
  assert.equal(isReleaseDirectoryFor("/opt/opsworkbench/releases/review-4c47c7b1/app", root, release), true,
    "the commit-named form the host actually uses");
  assert.equal(isReleaseDirectoryFor("/opt/opsworkbench/releases/v0.1.2-operate/app", root, release), true,
    "and the tag-named form the deployer was written for");
});

test("a commit-named release directory whose hex belongs to a DIFFERENT release is refused", () => {
  // The point of widening the spelling was not to stop checking. A directory name that does not prefix
  // this release's commit names some other release, and pointing a rollback at one is the whole hazard.
  const root = "/opt/opsworkbench/releases";
  const release = { tag: "v0.1.2-operate", commit: "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b" };
  assert.equal(isReleaseDirectoryFor("/opt/opsworkbench/releases/review-467a3138/app", root, release), false);
  assert.equal(isReleaseDirectoryFor("/opt/opsworkbench/releases/review-4c47c7b1/dist", root, release), false,
    "and the leaf must still be app/");
  assert.equal(isReleaseDirectoryFor("/opt/opsworkbench/elsewhere/review-4c47c7b1/app", root, release), false,
    "and it must still live under the release root");
});

test("readiness accepts HTTPS anywhere and plain HTTP only on loopback", () => {
  assert.equal(isReadinessEndpoint("https://example.test/healthz"), true);
  assert.equal(isReadinessEndpoint("http://127.0.0.1:18080/healthz"), true, "the host's edge");
  assert.equal(isReadinessEndpoint("http://localhost:18081/"), true);
  assert.equal(isReadinessEndpoint("http://example.test/healthz"), false,
    "plain HTTP off the host is interceptable and stays refused");
  assert.equal(isReadinessEndpoint("http://10.0.0.5/healthz"), false, "a private address is still a network");
  assert.equal(isReadinessEndpoint("ftp://127.0.0.1/"), false);
  assert.equal(isReadinessEndpoint("not a url"), false);
});

// --- Attestation bundles -------------------------------------------------------------------------

test("a plan may carry an absolute attestation bundle directory, and nothing else new", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "att-plan-"));
  const valid = plan(root);
  const bundles = path.join(root, "attestations");
  assert.equal(parseDeploymentPlan({ ...valid, attestationBundles: bundles }).attestationBundles, bundles);
  // Absent is still valid: every plan written before this existed must keep parsing.
  assert.equal("attestationBundles" in parseDeploymentPlan(valid), false);
  assert.throws(() => parseDeploymentPlan({ ...valid, attestationBundles: "attestations" }), /must be an absolute path/);
  assert.throws(() => parseDeploymentPlan({ ...valid, attestationBundles: 7 }), /must be an absolute path/);
  // The optional key must not become a hole in the unknown-key check.
  assert.throws(() => parseDeploymentPlan({ ...valid, attestationBundles: bundles, surprise: true }), /unknown fields/);
});

test("preparation and re-verification read every release-bundle attestation from the bundle directory", () => {
  // The previous version of this test called attestationSource() and asserted its return value, which
  // is the feature asserting itself. Removing the pass-through from all four call sites left it green.
  // These drive the real entry points and read what the verification hook was actually handed.
  const bundles = fs.mkdtempSync(path.join(os.tmpdir(), "att-callsites-"));
  const { item } = releaseFixture();
  item.attestationBundles = bundles;
  const seen = [];
  const capture = (_dir, _names, options) => { seen.push(options.bundleDirectory); return { verified: true }; };
  const preparation = prepareReviewedRelease(item, { verifyAttestation: capture });
  reverifyPreparedRelease(preparation, { verifyAttestation: capture });
  assert.equal(seen.length, 4, "candidate and rollback, in preparation and again in re-verification");
  assert.deepEqual([...new Set(seen)], [bundles]);

  // And the other direction: a plan without bundles must still verify against the API, or "optional"
  // would be a word rather than a behaviour.
  const online = releaseFixture();
  const onlineSeen = [];
  const onlineCapture = (_dir, _names, options) => { onlineSeen.push(options.bundleDirectory); return { verified: true }; };
  const onlinePreparation = prepareReviewedRelease(online.item, { verifyAttestation: onlineCapture });
  reverifyPreparedRelease(onlinePreparation, { verifyAttestation: onlineCapture });
  assert.equal(onlineSeen.length, 4);
  assert.deepEqual([...new Set(onlineSeen)], [undefined]);
});

test("the rehearsal evidence check reads its attestation from the bundle directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "att-compat-"));
  const bundles = fs.mkdtempSync(path.join(os.tmpdir(), "att-compat-bundles-"));
  const item = { ...hostVerifiedPlan(root), attestationBundles: bundles };
  const scenarios = Object.fromEntries(["forward_compatibility", "rollback_compatibility", "migration_boundaries", "old_app_new_schema", "new_app_old_schema", "interrupted_migration", "failed_deployment_after_migration", "rollback_after_partial_switch", "service_restart_during_transition", "predecessor_artifacts_retained", "rollback_immutable_images", "rollback_target_independently_verified"].map((name) => [name, name.includes("migration") ? "not-applicable-no-migrations" : "passed"]));
  const ids = (start) => Object.fromEntries(["api", "web", "admin", "gate"].map((role, index) => [role, `sha256:${String(start + index).repeat(64).slice(0, 64)}`]));
  const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: "opsworkbench-schema-rehearsal-v1", candidateTag: item.tag, candidateCommit: item.commit, rollbackTag: item.rollback.tag, rollbackCommit: item.rollback.commit, mongoTopology: "replica-set", images: { candidate: ids(1), rollback: ids(5) }, migrationsPresent: false, scenarios }, null, 2)}
`);
  fs.writeFileSync(item.compatibilityEvidence.path, bytes);
  item.compatibilityEvidence.sha256 = sha(bytes);
  let options;
  const result = verifyCompatibilityEvidence(item, { verifyAttestation: (_dir, _names, received) => { options = received; return { verified: true }; } });
  assert.equal(result.ok, true);
  assert.equal(options.bundleDirectory, bundles);
});

test("image attestations are verified from bundles named by the image digest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "att-image-"));
  const bundles = fs.mkdtempSync(path.join(os.tmpdir(), "att-image-bundles-"));
  const item = { ...hostVerifiedPlan(root), attestationBundles: bundles };
  for (const reference of Object.values(item.candidateImages)) {
    fs.writeFileSync(path.join(bundles, `sha256-${reference.slice(reference.indexOf("@sha256:") + 8)}.jsonl`), "{}\n");
  }
  const forgeBytes = Buffer.from(`${JSON.stringify({ schemaVersion: "forge-build-v2", buildId: `build-${item.tag}`, sourceRepository: "https://github.com/williams342-maker/operation", sourceCommit: item.commit, sourceTree: item.tree, sourceTag: item.tag, backendImageDigest: item.candidateImages.api, frontendImageDigest: item.candidateImages.web, adminImageDigest: item.candidateImages.admin, reviewGateImageDigest: item.candidateImages.reviewGate, builderIdentity: `https://github.com/williams342-maker/operation/.github/workflows/control-center-images.yml@refs/tags/${item.tag}`, builderRunnerEnvironment: "github-hosted", issuedAt: "2026-09-05T00:00:00Z" }, null, 2)}\n`);
  fs.writeFileSync(item.forgeEvidence.candidatePath, forgeBytes);
  item.forgeEvidence.candidateSha256 = sha(forgeBytes);
  const commands = [];
  // Only the process spawn is stubbed. The argument building, the digest extraction and the bundle
  // lookup are the real ones.
  const forge = verifyForgeEvidence(item, { verifyAttestation: (_dir, _names, options) => { commands.push(options); return { verified: true }; }, runGh: (args) => commands.push(args) });
  assert.equal(forge.ok, true);
  const imageCommands = commands.filter(Array.isArray);
  assert.equal(imageCommands.length, 4, "each candidate image is still attested");
  for (const args of imageCommands) {
    const reference = args[2];
    const digest = reference.slice(reference.indexOf("@sha256:") + 8);
    const index = args.indexOf("--bundle");
    assert.ok(index > 0, "an image attestation was verified against the API rather than a bundle");
    assert.equal(args[index + 1], path.join(bundles, `sha256-${digest}.jsonl`));
  }
  const forgeDocumentOptions = commands.find((entry) => !Array.isArray(entry));
  assert.equal(forgeDocumentOptions.bundleDirectory, bundles, "the Forge document itself was verified against the API");
});

test("a missing image bundle refuses the deployment rather than calling the API", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "att-image-missing-"));
  const bundles = fs.mkdtempSync(path.join(os.tmpdir(), "att-image-missing-bundles-"));
  const item = { ...hostVerifiedPlan(root), attestationBundles: bundles };
  const forgeBytes = Buffer.from(`${JSON.stringify({ schemaVersion: "forge-build-v2", buildId: `build-${item.tag}`, sourceRepository: "https://github.com/williams342-maker/operation", sourceCommit: item.commit, sourceTree: item.tree, sourceTag: item.tag, backendImageDigest: item.candidateImages.api, frontendImageDigest: item.candidateImages.web, adminImageDigest: item.candidateImages.admin, reviewGateImageDigest: item.candidateImages.reviewGate, builderIdentity: `https://github.com/williams342-maker/operation/.github/workflows/control-center-images.yml@refs/tags/${item.tag}`, builderRunnerEnvironment: "github-hosted", issuedAt: "2026-09-05T00:00:00Z" }, null, 2)}\n`);
  fs.writeFileSync(item.forgeEvidence.candidatePath, forgeBytes);
  item.forgeEvidence.candidateSha256 = sha(forgeBytes);
  assert.throws(() => verifyForgeEvidence(item, { verifyAttestation: () => ({ verified: true }), runGh: () => assert.fail("the CLI ran without a bundle") }), /no attestation bundle/);
});

// --- Release identity ----------------------------------------------------------------------------
//
// Readiness asks whether something answers. These cover the question it cannot ask: whether what
// answered is the release that was just deployed. On the real host the API reported `phase2-staging`
// out of an environment file, and every readiness check passed the whole time.

const manifestBeside = (releaseDirectory) => path.join(path.dirname(path.resolve(releaseDirectory)), "release.manifest.json");

const identityImageHooks = (item) => {
  const localId = (reference) => `sha256:${sha(reference)}`;
  const revision = (reference) => Object.values(item.candidateImages).includes(reference) ? commit : rollbackCommit;
  const title = (reference) => reference.includes("control-center-api") ? "opsworkbench-control-center-api" : reference.includes("control-center-web") ? "opsworkbench-control-center-web" : reference.includes("admin-web") ? "opsworkbench-control-center-admin-web" : "opsworkbench-review-gate";
  return {
    localId,
    images: { remoteInspect: (reference) => `Name: ${reference}\n`, pull: () => {}, localInspect: (reference) => ({ Id: localId(reference), RepoDigests: [reference], Config: { Labels: { "org.opencontainers.image.revision": revision(reference), "org.opencontainers.image.source": "https://github.com/williams342-maker/operation", "org.opencontainers.image.title": title(reference) } } }) },
    verifyCompatibility: async () => ({ ok: true, candidateCommit: commit, rollbackCommit, images: {
      candidate: { api: localId(item.candidateImages.api), web: localId(item.candidateImages.web), admin: localId(item.candidateImages.admin), gate: localId(item.candidateImages.reviewGate) },
      rollback: { api: localId(item.rollback.images.api), web: localId(item.rollback.images.web), admin: localId(item.rollback.images.admin), gate: localId(item.rollback.images.reviewGate) },
    } }),
    verifyPlatformImages: async () => ({ ok: true, edgeImage: item.platform.edgeImage, mongoImage: item.platform.mongoImage }),
  };
};

test("a plan must name an identity endpoint, on the same terms as readiness", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "identity-plan-"));
  const valid = plan(root);
  assert.equal(parseDeploymentPlan(valid).identityEndpoint, valid.identityEndpoint);
  assert.throws(() => parseDeploymentPlan(without(valid, "identityEndpoint")), /missing or unknown fields/);
  assert.throws(() => parseDeploymentPlan({ ...valid, identityEndpoint: "http://example.test/healthz" }), /identity endpoint is required/);
  assert.throws(() => parseDeploymentPlan({ ...valid, identityEndpoint: "not-a-url" }), /identity endpoint is required/);
  // Loopback is allowed for the same reason readiness allows it: packets to 127.0.0.1 never reach a network.
  assert.equal(parseDeploymentPlan({ ...valid, identityEndpoint: "http://127.0.0.1:18080/healthz" }).identityEndpoint, "http://127.0.0.1:18080/healthz");
});

test("preparation installs the release's own manifest beside the installed tree", () => {
  const { item, prefix } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  const installed = manifestBeside(preparation.installedControlCenter);
  assert.equal(preparation.releaseManifest, installed);
  assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.join(item.bundleDirectory, `${prefix}.manifest.json`)), "the installed manifest is the verified bundle's bytes");
  assert.equal(JSON.parse(fs.readFileSync(installed, "utf8")).commit, commit);
  // The rollback half too, so a recovery has a predecessor identity to mount.
  assert.equal(preparation.rollbackReleaseManifest, manifestBeside(preparation.rollbackControlCenter));
  assert.equal(JSON.parse(fs.readFileSync(preparation.rollbackReleaseManifest, "utf8")).commit, rollbackCommit);
});

test("a live rollback release must already carry its manifest, and preparation never writes one there", () => {
  const { item } = releaseFixture();
  item.rollback = { ...without(item.rollback, "images"), evidence: "host-verified", adoptionRecords: [] };
  item.forgeEvidence = without(item.forgeEvidence, "rollbackPath", "rollbackSha256");
  materialiseRollbackRelease(item, { manifest: false });
  assert.throws(() => prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) }), /live release is never written to/);
  assert.equal(fs.existsSync(manifestBeside(item.rollback.releaseDirectory)), false, "and nothing was written into the live release");

  // Present but not the release the plan claims: the same refusal, because that binding is the point.
  const { item: second } = releaseFixture();
  second.rollback = { ...without(second.rollback, "images"), evidence: "host-verified", adoptionRecords: [] };
  second.forgeEvidence = without(second.forgeEvidence, "rollbackPath", "rollbackSha256");
  materialiseRollbackRelease(second);
  fs.writeFileSync(manifestBeside(second.rollback.releaseDirectory), '{"schemaVersion":"opsworkbench-release-v1","tag":"v9.9.9-operate"}');
  assert.throws(() => prepareReviewedRelease(second, { verifyAttestation: () => ({ verified: true }) }), /differs from the verified bundle/);
});

test("the candidate and the rollback are given DIFFERENT manifests to mount", async () => {
  const upState = {};
  const { item } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const manifests = [];
  const hooks = identityImageHooks(item);
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: hooks.verifyCompatibility, images: hooks.images, verifyPlatformImages: hooks.verifyPlatformImages,
    agentControl: () => {}, runningContainers: () => composeRunning(upState.up),
    compose: (args, env, file) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); if (args[0] === "up") manifests.push({ manifest: env.OPSWORKBENCH_RELEASE_MANIFEST, api: env.OPSWORKBENCH_API_IMAGE, file }); },
    readiness: async () => true,
    identity: async () => ({ source: "manifest", commit: manifests.at(-1)?.api === item.candidateImages.api ? commit : rollbackCommit }),
    acceptancePasses: 1, switchCurrent: () => {}, writeDeploymentRecord: () => { throw new Error("disk refused final record"); },
  }), /was rolled back/);
  const forward = manifests.filter((entry) => entry.api === item.candidateImages.api);
  const recovery = manifests.filter((entry) => entry.api !== item.candidateImages.api);
  assert.ok(forward.length > 0 && recovery.length > 0, "both paths ran");
  assert.equal(forward.every((entry) => entry.manifest === preparation.releaseManifest), true);
  // The trap this exists for: the recovery runs the CANDIDATE's compose file on this target, so a
  // release-relative mount would have handed the predecessor images the candidate's identity document.
  assert.equal(recovery.every((entry) => entry.manifest === preparation.rollbackReleaseManifest), true);
  assert.notEqual(preparation.releaseManifest, preparation.rollbackReleaseManifest);
});

for (const [label, answer, expected] of [
  ["still the release being replaced", { source: "manifest", commit: rollbackCommit }, /identity reports/],
  ["not manifest-backed", { source: "env", commit }, /not manifest-backed/],
  ["silent about what it is", {}, /not manifest-backed/],
]) {
  test(`a deployed service that is ${label} fails the deployment`, async () => {
  const upState = {};
    const { item } = releaseFixture();
    const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
    fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
    const hooks = identityImageHooks(item);
    let switched = false;
    let reported;
    await assert.rejects(() => deployPreparedRelease(preparation, {
      verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
      verifyCompatibility: hooks.verifyCompatibility, images: hooks.images, verifyPlatformImages: hooks.verifyPlatformImages,
      agentControl: () => {}, runningContainers: () => composeRunning(upState.up),
      compose: (args, env) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); },
      readiness: async () => true,
      // The candidate answer is wrong in the way the label says; the recovery answers correctly, so what
      // fails here is the deployment rather than the rollback.
      identity: async () => { const body = switched ? { source: "manifest", commit: rollbackCommit } : answer; switched = true; return body; },
      acceptancePasses: 1,
      switchCurrent: () => { reported = "switched"; },
    }), (error) => { assert.match(error.message, /was rolled back/); assert.match(error.message, expected); return true; });
    assert.equal(reported, undefined, "the release pointer never moved, because identity is checked before it does");
  });
}

test("a rollback that does not restore the predecessor's identity is reported as such", async () => {
  const upState = {};
  const { item } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const hooks = identityImageHooks(item);
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: hooks.verifyCompatibility, images: hooks.images, verifyPlatformImages: hooks.verifyPlatformImages,
    agentControl: () => {}, runningContainers: () => composeRunning(upState.up),
    compose: (args, env) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); recordUp(upState)(args, env); },
    readiness: async () => true,
    // The deployment fails at the record, and the recovery leaves the candidate's identity in place.
    identity: async () => ({ source: "manifest", commit }),
    acceptancePasses: 1, switchCurrent: () => {}, writeDeploymentRecord: () => { throw new Error("disk refused final record"); },
  }), /rollback did not restore the predecessor's identity/);
});

test("the shipped agent unit satisfies what the installer requires of it", () => {
  // The installer reads the account and the working directory out of this unit and refuses what it
  // cannot verify. If the unit changes shape, that refusal happens on the production host in the middle
  // of a deployment; this catches it here instead.
  const unit = fs.readFileSync(path.join(process.cwd(), "deploy", "systemd", "opsworkbench-agent.service"), "utf8");
  const value = (key) => (unit.split(/\r?\n/).find((line) => line.trim().startsWith(`${key}=`)) ?? "").split("=").slice(1).join("=").trim();
  assert.match(value("User"), /^[a-z_][a-z0-9_-]*$/, "the unit must name the account it runs as");
  assert.match(value("Group"), /^[a-z_][a-z0-9_-]*$/, "and the group, which is what the installed tree is made readable by");
  assert.ok(value("WorkingDirectory").startsWith("/opt/opsworkbench-agent/current/"), "the working directory must be under the current symlink, or the installer's pre-flight probe tests the wrong path");
  // THE EXACT ENTRY POINT, not merely a path under `current`. The installer probes a hard-coded
  // `apps/agent/dist/agent.js` for readability, so a unit pointing anywhere else would sail through the
  // pre-flight and fail at service start — which is the failure this whole change exists to prevent.
  assert.equal(value("ExecStart"), "/usr/bin/node /opt/opsworkbench-agent/current/control-center/apps/agent/dist/agent.js", "the unit must start the entry point the installer probes");
  assert.equal(value("WorkingDirectory"), "/opt/opsworkbench-agent/current/control-center/apps/agent");
  assert.notEqual(value("User"), "root", "an agent that ran as root would not have needed any of this");
  // Neither may the GROUP be root. The installer makes the release tree readable by the unit's group,
  // so `Group=root` would both hand the agent process root's group and make that grant meaningless.
  assert.notEqual(value("Group"), "root", "the group the tree is opened to must not be root's");
});

// A service can report the right release and still not be running it: the identity endpoint answers
// from the manifest its container was handed, so mounting a candidate manifest beside old images
// produces a confident, wrong answer. These cover the other half — what is actually running.

for (const [label, containers, expected] of [
  ["running an image this deployment did not resolve", (up) => composeRunning({ ...up, web: "ghcr.io/williams342-maker/operation/control-center-web@sha256:" + "9".repeat(64) }), /is running .*expected/],
  ["not running at all", () => [], /not exactly one running container/],
  ["running two containers of the same service", (up) => [...composeRunning(up), ...composeRunning(up).slice(0, 1)], /not exactly one running container/],
  // A container that EXISTS is not a container that is serving: without this, dropping the running
  // condition from the check left every other test green.
  ["present but stopped", (up) => composeRunning(up).map((container) => ({ ...container, State: { Running: false, Status: "exited" } })), /not exactly one running container/],
]) {
  test(`a deployed service ${label} fails the deployment even when identity agrees`, async () => {
    const upState = {};
    const { item } = releaseFixture();
    const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
    fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
    const hooks = identityImageHooks(item);
    let switched = false;
    await assert.rejects(() => deployPreparedRelease(preparation, {
      verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
      verifyCompatibility: hooks.verifyCompatibility, images: hooks.images, verifyPlatformImages: hooks.verifyPlatformImages,
      agentControl: () => {},
      compose: (args, env) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); },
      // The forward path is the case under test; the recovery reports itself correctly so what fails is
      // the deployment rather than the rollback.
      runningContainers: () => (switched || upState.up?.api !== item.candidateImages.api ? composeRunning(upState.up) : containers(upState.up)),
      readiness: async () => true,
      identity: async () => ({ source: "manifest", commit: upState.up?.api === item.candidateImages.api ? commit : rollbackCommit }),
      acceptancePasses: 1,
      switchCurrent: () => { switched = true; },
    }), (error) => { assert.match(error.message, /was rolled back/); assert.match(error.message, expected); return true; });
    assert.equal(switched, false, "the release pointer never moved");
  });
}

test("the identity reader refuses an error response instead of reading its body", async (t) => {
  // The tests above replace this reader wholesale, so without this one the production version could
  // lose its status check entirely and every one of them would still pass -- an HTTP 500 carrying
  // matching JSON would have counted as a verified deployment.
  const { item } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const upState = {};
  const hooks = identityImageHooks(item);
  const requested = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requested.push(String(url));
    return { ok: false, status: 503, json: async () => ({ source: "manifest", commit }) };
  });
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: hooks.verifyCompatibility, images: hooks.images, verifyPlatformImages: hooks.verifyPlatformImages,
    agentControl: () => {},
    compose: (args, env) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); },
    runningContainers: () => composeRunning(upState.up),
    readiness: async () => true,
    // No identity hook: the REAL reader runs, against a mocked fetch.
    acceptancePasses: 1, switchCurrent: () => {},
  }), (error) => { assert.match(error.message, /identity endpoint refused/); return true; });
  assert.ok(requested.includes(item.identityEndpoint), "the reader asked the endpoint the plan names");
});

test("a rollback that reports the predecessor but runs something else is reported as such", async () => {
  // The recovery is held to both halves too: saying "I am the predecessor" is not the same as running
  // the predecessor's images, and a recovery that half-worked is the worst thing to record as success.
  const upState = {};
  const { item } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const hooks = identityImageHooks(item);
  const stranger = `ghcr.io/williams342-maker/operation/control-center-api@sha256:${"7".repeat(64)}`;
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: hooks.verifyCompatibility, images: hooks.images, verifyPlatformImages: hooks.verifyPlatformImages,
    agentControl: () => {},
    compose: (args, env) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); },
    runningContainers: () => (!upState.up ? [] : upState.up.api === item.candidateImages.api ? composeRunning(upState.up) : composeRunning({ ...upState.up, api: stranger })),
    readiness: async () => true,
    identity: async () => ({ source: "manifest", commit: upState.up?.api === item.candidateImages.api ? commit : rollbackCommit }),
    acceptancePasses: 1, switchCurrent: () => {}, writeDeploymentRecord: () => { throw new Error("disk refused final record"); },
  }), (error) => { assert.match(error.message, /rollback did not restore the predecessor/); assert.match(error.message, /api is running/); return true; });
});

test("containers belonging to another compose project do not satisfy the running check", async () => {
  // Removing the project-label condition from assertRunningImages left every other test green: the
  // fixtures only ever produced this project's containers, so "is it ours" was asserted by nobody. A
  // neighbouring project running the same images on the same host is the case that matters.
  const upState = {};
  const { item } = releaseFixture();
  const preparation = prepareReviewedRelease(item, { verifyAttestation: () => ({ verified: true }) });
  fs.symlinkSync(preparation.rollbackControlCenter, path.join(path.dirname(item.releaseRoot), "current"), process.platform === "win32" ? "junction" : "dir");
  const hooks = identityImageHooks(item);
  let switched = false;
  await assert.rejects(() => deployPreparedRelease(preparation, {
    verifyAttestation: () => ({ verified: true }), verifyForge: async () => ({ ok: true }),
    verifyCompatibility: hooks.verifyCompatibility, images: hooks.images, verifyPlatformImages: hooks.verifyPlatformImages,
    agentControl: () => {},
    compose: (args, env) => { if (isModelQuery(args)) return resolvedModelJson; recordUp(upState)(args, env); },
    // Same images, same services, same host -- a different project. Nothing of ours is running.
    runningContainers: () => (switched || upState.up?.api !== item.candidateImages.api ? composeRunning(upState.up) : composeRunning(upState.up, "someone-elses-stack")),
    readiness: async () => true,
    identity: async () => ({ source: "manifest", commit: upState.up?.api === item.candidateImages.api ? commit : rollbackCommit }),
    acceptancePasses: 1, switchCurrent: () => { switched = true; },
  }), (error) => { assert.match(error.message, /was rolled back/); assert.match(error.message, /not exactly one running container of this project/); return true; });
  assert.equal(switched, false, "the release pointer never moved");
});
