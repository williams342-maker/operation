import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import test from "node:test";
import { deployPreparedRelease, establishRollbackBeforeMutation, inspectImmutableImage, inspectPlatformImages, parseDeploymentPlan, prepareReviewedRelease, verifyCompatibilityEvidence, verifyForgeEvidence, isReleaseDirectoryFor, isReadinessEndpoint, detectForeignPortConflicts } from "../../scripts/trusted-deployer.mjs";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const commit = "a".repeat(40); const tree = "b".repeat(40); const rollbackCommit = "c".repeat(40); const rollbackTree = "d".repeat(40);
const image = (role, char) => `ghcr.io/williams342-maker/operation/${role === "review-gate" ? role : `control-center-${role}`}@sha256:${char.repeat(64)}`;

function plan(root) { return {
  schemaVersion: "opsworkbench-trusted-deployment-v1", tag: "v0.2.0-operate", commit, tree,
  bundleDirectory: path.join(root, "bundle"), stagingRoot: path.join(root, "stage"), releaseRoot: path.join(root, "releases"), composeProject: "opsworkbench",
  candidateImages: { api: image("api", "1"), web: image("web", "2"), admin: image("admin-web", "3"), reviewGate: image("review-gate", "4") },
  platform: { edgeImage: `docker.io/library/nginx@sha256:${"a".repeat(64)}`, mongoImage: `docker.io/library/mongo@sha256:${"b".repeat(64)}`, mongoVolume: "mongo_verified" },
  rollback: { tag: "v0.1.9-operate", commit: rollbackCommit, tree: rollbackTree, images: { api: image("api", "5"), web: image("web", "6"), admin: image("admin-web", "7"), reviewGate: image("review-gate", "8") }, bundleDirectory: path.join(root, "rollback-bundle"), releaseDirectory: path.join(root, "releases", "v0.1.9-operate", "app"), evidenceSha256: "9".repeat(64) },
  forgeEvidence: { candidatePath: path.join(root, "candidate-forge.json"), candidateSha256: "a".repeat(64), rollbackPath: path.join(root, "rollback-forge.json"), rollbackSha256: "b".repeat(64) },
  compatibilityEvidence: { path: path.join(root, "compatibility.json"), sha256: "c".repeat(64) },
  readiness: ["https://example.test/healthz", "https://example.test/", "https://admin.example.test/"],
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

function writeReleaseBundle(directory, tag, releaseCommit, releaseTree) {
  fs.mkdirSync(directory, { recursive: true });
  const version = tag.slice(1); const prefix = `opsworkbench-control-center-${version}`; const composeName = `${prefix}/control-center/deploy/docker-compose.production.yml`; const compose = Buffer.from("services: {}\n");
  const pax = Buffer.from(`52 comment=${releaseCommit}\n`); const archive = zlib.gzipSync(Buffer.concat([tarBlock("pax_global_header", "g", pax), tarBlock(`${prefix}/`, "5"), tarBlock(`${prefix}/control-center/`, "5"), tarBlock(`${prefix}/control-center/deploy/`, "5"), tarBlock(composeName, "0", compose), tarBlock(`${prefix}/control-center/scripts/`, "5"), tarBlock(`${prefix}/control-center/scripts/install-reviewed-agent.sh`, "0", Buffer.from("#!/bin/sh\n")), Buffer.alloc(1024)]));
  const artifact = `opsworkbench-control-center-${version}.tar.gz`; const agentArtifact = `opsworkbench-control-center-${version}-agent-linux-x64.tar.gz`; const manifestName = `opsworkbench-control-center-${version}.manifest.json`;
  const agentMetadata = Buffer.from(`${JSON.stringify({ schemaVersion: "opsworkbench-agent-release-v1", tag, commit: releaseCommit, tree: releaseTree }, null, 2)}\n`);
  const agentPax = Buffer.from(`52 comment=${releaseCommit}\n`);
  const agent = zlib.gzipSync(Buffer.concat([tarBlock("pax_global_header", "g", agentPax), tarBlock("control-center/", "5"), tarBlock("control-center/apps/", "5"), tarBlock("control-center/apps/agent/", "5"), tarBlock("control-center/apps/agent/dist/", "5"), tarBlock("control-center/apps/agent/dist/agent.js", "0", Buffer.from("agent")), tarBlock("control-center/apps/updater/", "5"), tarBlock("control-center/apps/updater/dist/", "5"), tarBlock("control-center/apps/updater/dist/main.js", "0", Buffer.from("updater")), tarBlock("control-center/deploy/", "5"), tarBlock("control-center/deploy/systemd/", "5"), tarBlock("control-center/deploy/systemd/opsworkbench-agent.service", "0", Buffer.from("unit")), tarBlock("control-center/agent-release.json", "0", agentMetadata), Buffer.alloc(1024)]));
  const manifest = Buffer.from(`${JSON.stringify({ schemaVersion: "opsworkbench-release-v1", tag, commit: releaseCommit, artifact, agentArtifact, source: "test", reproducible: true }, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, artifact), archive); fs.writeFileSync(path.join(directory, agentArtifact), agent); fs.writeFileSync(path.join(directory, manifestName), manifest);
  fs.writeFileSync(path.join(directory, "SHA256SUMS"), `${sha(archive)}  ${artifact}\n${sha(agent)}  ${agentArtifact}\n${sha(manifest)}  ${manifestName}\n`);
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
    runningContainers: () => [],
    compose: (args, env, composeFile) => { if (isModelQuery(args)) return resolvedModelJson; if (args[0] !== "config" && env.OPSWORKBENCH_API_IMAGE === item.rollback.images.api) rolledBack = true; calls.push({ args, api: env.OPSWORKBENCH_API_IMAGE, composeFile, rollbackExists: fs.existsSync(path.join(preparation.stage, "rollback-ready.json")) }); },
    readiness: async () => rolledBack, acceptancePasses: 1,
  }), /was rolled back/);
  assert.equal(calls.filter((call) => call.args[0] !== "agent" || call.args[1] !== "prepare").every((call) => call.args[0] === "config" || call.rollbackExists), true, "every mutation follows rollback readiness");
  const prepareCall = calls.find((call) => call.args[0] === "agent" && call.args[1] === "prepare"); const activateCall = calls.find((call) => call.args[0] === "agent" && call.args[1] === "activate"); const rollbackCall = calls.find((call) => call.args[0] === "agent" && call.args[1] === "rollback");
  assert.equal(prepareCall.rollbackExists, false, "agent predecessor snapshot is taken before mutation authority"); assert.equal(activateCall.rollbackExists, true); assert.equal(rollbackCall.rollbackExists, true);
  assert.equal(calls.at(-1).api, item.rollback.images.api, "last mutation restores immutable rollback images");
  assert.equal(calls.at(-1).composeFile, preparation.rollbackCompose, "rollback uses the independently verified rollback compose file");
});

test("a post-acceptance record failure restores the current pointer and every runtime component", async () => {
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
    agentControl: () => {}, runningContainers: () => [], compose: (args, env, file) => { if (isModelQuery(args)) return resolvedModelJson; composeCalls.push({ api: env.OPSWORKBENCH_API_IMAGE, file }); }, readiness: async () => true, acceptancePasses: 1,
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
    agentControl: () => {}, readiness: async () => true, acceptancePasses: 1,
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
    agentControl: () => {}, readiness: async () => true, acceptancePasses: 1, switchCurrent: () => {},
    writeDeploymentRecord: () => { throw new Error("disk refused final record"); },
    runningContainers: () => [],
    compose: (args, env, file) => { if (isModelQuery(args)) return resolvedModelJson; if (args[0] === "up") ups.push({ args, services: args.filter((argument) => !argument.startsWith("-") && argument !== "up"), rollback: file === preparation.rollbackCompose && env.OPSWORKBENCH_API_IMAGE === item.rollback.images.api }); },
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
    agentControl: () => {}, readiness: async () => true, acceptancePasses: 1,
    switchCurrent: (_current, target) => { switches.push(target); },
    runningContainers: () => [containerFixture("opsworkbench-admin-web-1", null, { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18081" }] })],
    compose: (args, _env, file) => { if (isModelQuery(args)) return resolvedModelJson; composeCalls.push({ args, file }); },
  }), /host ports are held by containers this project does not own/);
  assert.equal(composeCalls.some((call) => call.args[0] === "up"), false, "no service was recreated");
  assert.deepEqual(switches, [], "the current release pointer was never moved");
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
