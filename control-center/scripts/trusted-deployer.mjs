#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectReleaseTarGz } from "./safe-release-archive.mjs";
import { parseSha256Sums, verifyAttestation, verifyReleaseBundle } from "./verify-release-bundle.mjs";
import { compareReleaseTree, describeTree } from "./verify-release-tree.mjs";

const digestReference = /^ghcr\.io\/williams342-maker\/operation\/(control-center-api|control-center-web|control-center-admin-web|review-gate)@sha256:[a-f0-9]{64}$/;
const tagPattern = /^v(\d+)\.(\d+)\.(\d+)-operate$/;
const commitPattern = /^[a-f0-9]{40}$/;

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${name} has missing or unknown fields`);
  }
}

export function parseDeploymentPlan(value) {
  exactKeys(value, ["schemaVersion", "tag", "commit", "tree", "bundleDirectory", "stagingRoot", "releaseRoot", "composeProject", "candidateImages", "platform", "rollback", "forgeEvidence", "compatibilityEvidence", "readiness"], "deployment plan");
  if (value.schemaVersion !== "opsworkbench-trusted-deployment-v1" || !tagPattern.test(value.tag) || !commitPattern.test(value.commit) || !commitPattern.test(value.tree)) throw new Error("deployment identity is invalid");
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value.composeProject)) throw new Error("compose project is invalid");
  for (const field of ["bundleDirectory", "stagingRoot", "releaseRoot"]) if (!path.isAbsolute(value[field])) throw new Error(`${field} must be absolute`);
  exactKeys(value.candidateImages, ["api", "web", "admin", "reviewGate"], "candidateImages");
  const roles = { api: "control-center-api", web: "control-center-web", admin: "control-center-admin-web", reviewGate: "review-gate" };
  for (const [role, reference] of Object.entries(value.candidateImages)) {
    const match = typeof reference === "string" && reference.match(digestReference);
    if (!match || match[1] !== roles[role]) throw new Error(`candidate ${role} image is not the expected immutable repository`);
  }
  if (new Set(Object.values(value.candidateImages)).size !== 4) throw new Error("candidate runtime images are not distinct");
  exactKeys(value.platform, ["edgeImage", "mongoImage", "mongoVolume"], "platform");
  for (const field of ["edgeImage", "mongoImage"]) if (typeof value.platform[field] !== "string" || !/^[a-z0-9][a-z0-9._\-/]*@sha256:[a-f0-9]{64}$/.test(value.platform[field])) throw new Error(`platform ${field} is not digest-pinned`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.platform.mongoVolume)) throw new Error("platform mongoVolume is invalid");
  exactKeys(value.rollback, ["tag", "commit", "tree", "images", "bundleDirectory", "releaseDirectory", "evidenceSha256"], "rollback");
  if (!tagPattern.test(value.rollback.tag) || !commitPattern.test(value.rollback.commit) || !commitPattern.test(value.rollback.tree) || !/^[a-f0-9]{64}$/.test(value.rollback.evidenceSha256) || !path.isAbsolute(value.rollback.bundleDirectory) || !path.isAbsolute(value.rollback.releaseDirectory)) throw new Error("rollback identity is invalid");
  if (path.resolve(value.rollback.releaseDirectory) !== path.resolve(value.releaseRoot, value.rollback.tag, "app") || path.resolve(value.rollback.bundleDirectory) === path.resolve(value.bundleDirectory)) throw new Error("rollback source location is invalid or ambiguous");
  if (value.rollback.tag === value.tag || value.rollback.commit === value.commit || value.rollback.tree === value.tree) throw new Error("candidate and rollback release identities must be distinct");
  exactKeys(value.rollback.images, ["api", "web", "admin", "reviewGate"], "rollback images");
  for (const [role, reference] of Object.entries(value.rollback.images)) {
    const match = typeof reference === "string" && reference.match(digestReference);
    if (!match || match[1] !== roles[role]) throw new Error(`rollback ${role} image is not the expected immutable repository`);
    if (reference === value.candidateImages[role]) throw new Error(`candidate and rollback ${role} image are identical`);
  }
  if (new Set(Object.values(value.rollback.images)).size !== 4) throw new Error("rollback runtime images are not distinct");
  exactKeys(value.forgeEvidence, ["candidatePath", "candidateSha256", "rollbackPath", "rollbackSha256"], "forgeEvidence");
  for (const field of ["candidatePath", "rollbackPath"]) if (!path.isAbsolute(value.forgeEvidence[field])) throw new Error(`forgeEvidence.${field} must be absolute`);
  for (const field of ["candidateSha256", "rollbackSha256"]) if (!/^[a-f0-9]{64}$/.test(value.forgeEvidence[field])) throw new Error(`forgeEvidence.${field} is invalid`);
  exactKeys(value.compatibilityEvidence, ["path", "sha256"], "compatibilityEvidence");
  if (!path.isAbsolute(value.compatibilityEvidence.path) || !/^[a-f0-9]{64}$/.test(value.compatibilityEvidence.sha256)) throw new Error("compatibility evidence identity is invalid");
  if (!Array.isArray(value.readiness) || value.readiness.length < 3 || value.readiness.some((url) => typeof url !== "string" || !/^https:\/\/[A-Za-z0-9.-]+(?:\/[^\s]*)?$/.test(url))) throw new Error("at least three HTTPS readiness endpoints are required");
  return structuredClone(value);
}

function copyStableRegular(source, destination) {
  const before = fs.lstatSync(source);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`release input is not a regular file: ${source}`);
  const fd = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error(`release input changed while opening: ${source}`);
    const bytes = fs.readFileSync(fd); const after = fs.fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error(`release input changed while reading: ${source}`);
    fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o400 });
  } finally { fs.closeSync(fd); }
}

function expectedArchiveTree(members) {
  return new Map([...members].map(([name, item]) => [name, item.type === "file" ? { type: "file", sha256: item.sha256 } : { type: "directory" }]));
}

function expectedSubtree(members, prefix) {
  const result = new Map();
  for (const [name, item] of members) if (name.startsWith(`${prefix}/`)) result.set(name.slice(prefix.length + 1), item.type === "file" ? { type: "file", sha256: item.sha256 } : { type: "directory" });
  return result;
}

function installAndVerifyExactTree(source, target, expected) {
  const makeReadonly = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) { makeReadonly(file); fs.chmodSync(file, 0o555); } else fs.chmodSync(file, 0o444); } };
  const validateSealed = (directory) => {
    if (process.platform !== "linux") return;
    const visit = (file) => { const stat = fs.lstatSync(file); if (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o222) !== 0) throw new Error(`installed release object is not root-owned and read-only: ${file}`); if (stat.isDirectory()) for (const entry of fs.readdirSync(file)) visit(path.join(file, entry)); };
    visit(directory);
  };
  if (!fs.existsSync(target)) {
    const parent = path.dirname(target); fs.mkdirSync(parent, { recursive: true, mode: 0o755 });
    const pending = `${target}.reviewed-pending-${process.pid}`;
    if (fs.existsSync(pending)) throw new Error("pending installed release tree already exists");
    try {
      fs.mkdirSync(pending, { mode: 0o700 }); fs.cpSync(source, pending, { recursive: true, errorOnExist: true, force: false });
      const pendingCheck = compareReleaseTree(expected, describeTree(pending));
      if (!pendingCheck.ok) throw new Error(`pending installed release tree is not exact: ${pendingCheck.problems.join("; ")}`);
      makeReadonly(pending); fs.chmodSync(pending, 0o555); validateSealed(pending); fs.renameSync(pending, target);
    } catch (error) { if (fs.existsSync(pending)) fs.rmSync(pending, { recursive: true, force: true }); throw error; }
  }
  const check = compareReleaseTree(expected, describeTree(target));
  if (!check.ok) throw new Error(`installed release tree is not exact: ${check.problems.join("; ")}`);
  validateSealed(target);
  return target;
}

export function prepareReviewedRelease(rawPlan, hooks = {}) {
  const plan = parseDeploymentPlan(rawPlan);
  const sourceCheck = verifyReleaseBundle(plan.bundleDirectory, { expectedTag: plan.tag });
  if (!sourceCheck.ok) throw new Error(`release bundle failed verification: ${sourceCheck.problems.join("; ")}`);
  if (sourceCheck.manifest.commit !== plan.commit) throw new Error("release manifest commit differs from the deployment plan");
  const listed = parseSha256Sums(fs.readFileSync(path.join(plan.bundleDirectory, "SHA256SUMS"), "utf8")).filter(Boolean).map((entry) => entry.name);
  const stage = fs.mkdtempSync(path.join(plan.stagingRoot, `.prepare-${plan.commit.slice(0, 12)}-`)); fs.chmodSync(stage, 0o700);
  try {
    for (const name of ["SHA256SUMS", ...listed]) copyStableRegular(path.join(plan.bundleDirectory, name), path.join(stage, name));
    const copiedCheck = verifyReleaseBundle(stage, { expectedTag: plan.tag });
    if (!copiedCheck.ok || copiedCheck.manifest.commit !== plan.commit) throw new Error("private release copy failed repeat verification");
    (hooks.verifyAttestation ?? verifyAttestation)(stage, listed, { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-release.yml", sourceDigest: plan.commit, sourceRef: `refs/tags/${plan.tag}` });
    const archivePath = path.join(stage, copiedCheck.manifest.artifact);
    const prefix = `opsworkbench-control-center-${plan.tag.slice(1)}`;
    const inspected = inspectReleaseTarGz(archivePath, { expectedPrefix: prefix });
    if (inspected.archiveCommit !== plan.commit) throw new Error("archive embedded commit differs from the deployment plan");
    const extracted = path.join(stage, "extracted"); fs.mkdirSync(extracted, { mode: 0o700 });
    (hooks.extract ?? ((archive, destination) => execFileSync("tar", ["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", destination], { stdio: "pipe" })))(archivePath, extracted);
    const treeCheck = compareReleaseTree(expectedArchiveTree(inspected.members), describeTree(extracted));
    if (!treeCheck.ok) throw new Error(`extracted release tree failed verification: ${treeCheck.problems.join("; ")}`);
    const controlCenter = path.join(extracted, prefix, "control-center");
    const candidateExpectedTree = expectedSubtree(inspected.members, `${prefix}/control-center`);
    const installedControlCenter = installAndVerifyExactTree(controlCenter, path.join(plan.releaseRoot, plan.tag, "app"), candidateExpectedTree);
    const compose = path.join(installedControlCenter, "deploy", "docker-compose.production.yml");
    if (!fs.existsSync(compose) || !fs.lstatSync(compose).isFile()) throw new Error("version-controlled production compose file is absent");
    const agentPath = path.join(stage, copiedCheck.manifest.agentArtifact);
    const inspectedAgent = inspectReleaseTarGz(agentPath, { expectedPrefix: "control-center" });
    if (inspectedAgent.archiveCommit !== plan.commit) throw new Error("agent archive embedded commit differs from the plan");
    const agentExtracted = path.join(stage, "agent-extracted"); fs.mkdirSync(agentExtracted, { mode: 0o700 });
    (hooks.extract ?? ((archive, destination) => execFileSync("tar", ["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", destination], { stdio: "pipe" })))(agentPath, agentExtracted);
    const agentTreeCheck = compareReleaseTree(expectedArchiveTree(inspectedAgent.members), describeTree(agentExtracted));
    if (!agentTreeCheck.ok) throw new Error(`agent release tree failed verification: ${agentTreeCheck.problems.join("; ")}`);
    const agentMetadata = JSON.parse(fs.readFileSync(path.join(agentExtracted, "control-center", "agent-release.json"), "utf8"));
    exactKeys(agentMetadata, ["schemaVersion", "tag", "commit", "tree"], "agent release metadata");
    if (agentMetadata.schemaVersion !== "opsworkbench-agent-release-v1" || agentMetadata.tag !== plan.tag || agentMetadata.commit !== plan.commit || agentMetadata.tree !== plan.tree) throw new Error("agent artifact names a different release identity");
    for (const required of ["apps/agent/dist/agent.js", "apps/updater/dist/main.js", "deploy/systemd/opsworkbench-agent.service"]) if (!fs.lstatSync(path.join(agentExtracted, "control-center", required)).isFile()) throw new Error(`agent artifact is missing ${required}`);
    const rollbackBundle = path.join(stage, "rollback-bundle"); fs.mkdirSync(rollbackBundle, { mode: 0o700 });
    const rollbackCheck = verifyReleaseBundle(plan.rollback.bundleDirectory, { expectedTag: plan.rollback.tag });
    if (!rollbackCheck.ok || rollbackCheck.manifest.commit !== plan.rollback.commit) throw new Error("rollback release bundle failed verification");
    const rollbackListed = parseSha256Sums(fs.readFileSync(path.join(plan.rollback.bundleDirectory, "SHA256SUMS"), "utf8")).filter(Boolean).map((entry) => entry.name);
    for (const name of ["SHA256SUMS", ...rollbackListed]) copyStableRegular(path.join(plan.rollback.bundleDirectory, name), path.join(rollbackBundle, name));
    (hooks.verifyAttestation ?? verifyAttestation)(rollbackBundle, rollbackListed, { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-release.yml", sourceDigest: plan.rollback.commit, sourceRef: `refs/tags/${plan.rollback.tag}` });
    const rollbackArchivePath = path.join(rollbackBundle, rollbackCheck.manifest.artifact); const rollbackPrefix = `opsworkbench-control-center-${plan.rollback.tag.slice(1)}`;
    if (crypto.createHash("sha256").update(fs.readFileSync(rollbackArchivePath)).digest("hex") !== plan.rollback.evidenceSha256) throw new Error("rollback artifact digest differs from the deployment plan");
    const rollbackInspected = inspectReleaseTarGz(rollbackArchivePath, { expectedPrefix: rollbackPrefix });
    if (rollbackInspected.archiveCommit !== plan.rollback.commit) throw new Error("rollback archive embedded commit differs from the plan");
    const rollbackExtracted = path.join(stage, "rollback-extracted"); fs.mkdirSync(rollbackExtracted, { mode: 0o700 });
    (hooks.extract ?? ((archive, destination) => execFileSync("tar", ["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", destination], { stdio: "pipe" })))(rollbackArchivePath, rollbackExtracted);
    const rollbackArchiveTree = expectedArchiveTree(rollbackInspected.members);
    const rollbackTreeCheck = compareReleaseTree(rollbackArchiveTree, describeTree(rollbackExtracted));
    if (!rollbackTreeCheck.ok) throw new Error(`rollback extraction failed verification: ${rollbackTreeCheck.problems.join("; ")}`);
    const rollbackExpectedTree = expectedSubtree(rollbackInspected.members, `${rollbackPrefix}/control-center`);
    const rollbackControlCenter = installAndVerifyExactTree(path.join(rollbackExtracted, rollbackPrefix, "control-center"), plan.rollback.releaseDirectory, rollbackExpectedTree);
    const rollbackCompose = path.join(rollbackControlCenter, "deploy", "docker-compose.production.yml");
    if (!fs.lstatSync(rollbackCompose).isFile()) throw new Error("rollback production compose file is absent");
    const evidence = { schemaVersion: "opsworkbench-deployment-preparation-v1", tag: plan.tag, commit: plan.commit, tree: plan.tree, preparedAt: new Date().toISOString(), hostname: os.hostname(), artifactSha256: crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex"), agentArtifactSha256: crypto.createHash("sha256").update(fs.readFileSync(agentPath)).digest("hex"), candidateImages: plan.candidateImages, rollback: plan.rollback };
    fs.writeFileSync(path.join(stage, "preparation.json"), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o400 });
    return { stage, extracted, controlCenter: installedControlCenter, compose, installedControlCenter, candidateExpectedTree, rollbackBundle, rollbackExtracted, rollbackControlCenter, rollbackCompose, rollbackExpectedTree, rollbackArchiveTree, rollbackPrefix, agentExtracted, agentPath, evidence, plan, expectedTree: expectedArchiveTree(inspected.members), expectedAgentTree: expectedArchiveTree(inspectedAgent.members), prefix };
  } catch (error) {
    fs.writeFileSync(path.join(stage, "FAILED"), `${error.message}\n`, { flag: "wx", mode: 0o400 });
    throw error;
  }
}

export function inspectImmutableImage(reference, expectation, hooks = {}) {
  if (!digestReference.test(reference)) throw new Error("image reference is not an approved immutable repository digest");
  const expectedDigest = reference.slice(reference.indexOf("@") + 1);
  const remote = (hooks.remoteInspect ?? ((ref) => execFileSync("docker", ["buildx", "imagetools", "inspect", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })))(reference);
  const remoteName = String(remote).split(/\r?\n/).map((line) => line.match(/^Name:\s+(\S+)$/)?.[1]).find(Boolean);
  if (remoteName !== reference) throw new Error(`registry inspection did not bind the requested digest: ${reference}`);
  (hooks.pull ?? ((ref) => execFileSync("docker", ["pull", ref], { stdio: "pipe" })))(reference);
  const inspectLocal = hooks.localInspect ?? ((ref) => {
    const output = execFileSync("docker", ["image", "inspect", ref, "--format", "{{json .}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(output);
  });
  const local = inspectLocal(reference);
  const repoDigests = Array.isArray(local.RepoDigests) ? local.RepoDigests : [];
  if (!repoDigests.includes(reference)) throw new Error(`local image does not retain the registry digest: ${reference}`);
  const labels = local.Config?.Labels ?? {};
  if (labels["org.opencontainers.image.revision"] !== expectation.commit) throw new Error(`${expectation.role} image revision label mismatch`);
  if (labels["org.opencontainers.image.source"] !== "https://github.com/williams342-maker/operation") throw new Error(`${expectation.role} image source label mismatch`);
  if (labels["org.opencontainers.image.title"] !== expectation.title) throw new Error(`${expectation.role} image role label mismatch`);
  const id = typeof local.Id === "string" && /^sha256:[a-f0-9]{64}$/.test(local.Id) ? local.Id : null;
  if (!id) throw new Error(`${expectation.role} local image ID is absent or mutable`);
  return { reference, registryDigest: expectedDigest, localImageId: id, revision: labels["org.opencontainers.image.revision"], title: labels["org.opencontainers.image.title"] };
}

export function inspectPlatformImages(platform, hooks = {}) {
  const inspect = (reference) => {
    const remote = (hooks.remoteInspect ?? ((ref) => execFileSync("docker", ["buildx", "imagetools", "inspect", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })))(reference);
    const remoteName = String(remote).split(/\r?\n/).map((line) => line.match(/^Name:\s+(\S+)$/)?.[1]).find(Boolean);
    if (remoteName !== reference) throw new Error(`platform registry inspection did not bind ${reference}`);
    (hooks.pull ?? ((ref) => execFileSync("docker", ["pull", ref], { stdio: "pipe" })))(reference);
    const local = (hooks.localInspect ?? ((ref) => JSON.parse(execFileSync("docker", ["image", "inspect", ref, "--format", "{{json .}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))))(reference);
    if (!Array.isArray(local.RepoDigests) || !local.RepoDigests.includes(reference) || !/^sha256:[a-f0-9]{64}$/.test(local.Id ?? "")) throw new Error(`platform local image identity is not digest-bound: ${reference}`);
    return { reference, localImageId: local.Id };
  };
  const edge = inspect(platform.edgeImage); const mongo = inspect(platform.mongoImage);
  return { ok: true, edgeImage: edge.reference, mongoImage: mongo.reference, localImageIds: { edge: edge.localImageId, mongo: mongo.localImageId } };
}

export function establishRollbackBeforeMutation(preparation, imageEvidence, { now = new Date(), hostname = os.hostname() } = {}) {
  const file = path.join(preparation.stage, "rollback-ready.json");
  const record = {
    schemaVersion: "opsworkbench-rollback-ready-v1", createdAt: now.toISOString(), hostname,
    candidate: { tag: preparation.evidence.tag, commit: preparation.evidence.commit, tree: preparation.evidence.tree, images: preparation.evidence.candidateImages },
    rollback: preparation.evidence.rollback, imageEvidence,
    runtimeMutationAuthorized: false,
  };
  const fd = fs.openSync(file, "wx", 0o400);
  try { fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { file, record };
}

function readCurrentRelease(releaseRoot) {
  const link = path.join(path.dirname(releaseRoot), "current");
  if (!fs.existsSync(link)) return { link, target: null };
  const stat = fs.lstatSync(link);
  if (!stat.isSymbolicLink()) throw new Error("current release pointer is not a symbolic link");
  const target = fs.realpathSync(link);
  if (!path.isAbsolute(target) || !target.startsWith(`${path.resolve(releaseRoot)}${path.sep}`) || !fs.lstatSync(target).isDirectory()) throw new Error("current release pointer escaped the verified release root");
  return { link, target };
}

function switchCurrentRelease(current, target) {
  const pending = `${current.link}.reviewed-pending-${process.pid}`;
  if (fs.existsSync(pending)) throw new Error("pending current release pointer already exists");
  try { fs.symlinkSync(target, pending, process.platform === "win32" ? "junction" : "dir"); fs.renameSync(pending, current.link); }
  catch (error) { if (fs.existsSync(pending)) fs.unlinkSync(pending); throw error; }
  return target;
}

export function reverifyPreparedRelease(preparation, hooks = {}) {
  const check = verifyReleaseBundle(preparation.stage, { expectedTag: preparation.plan.tag });
  if (!check.ok || check.manifest.commit !== preparation.plan.commit) throw new Error("prepared bundle failed immediate re-verification");
  const listed = parseSha256Sums(fs.readFileSync(path.join(preparation.stage, "SHA256SUMS"), "utf8")).filter(Boolean).map((entry) => entry.name);
  (hooks.verifyAttestation ?? verifyAttestation)(preparation.stage, listed, { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-release.yml", sourceDigest: preparation.plan.commit, sourceRef: `refs/tags/${preparation.plan.tag}` });
  const inspected = inspectReleaseTarGz(path.join(preparation.stage, check.manifest.artifact), { expectedPrefix: preparation.prefix });
  if (inspected.archiveCommit !== preparation.plan.commit) throw new Error("prepared archive commit changed");
  const tree = compareReleaseTree(preparation.expectedTree, describeTree(preparation.extracted));
  if (!tree.ok) throw new Error(`prepared tree changed before consumption: ${tree.problems.join("; ")}`);
  const installedTree = compareReleaseTree(preparation.candidateExpectedTree, describeTree(preparation.installedControlCenter));
  if (!installedTree.ok) throw new Error(`installed candidate tree changed before consumption: ${installedTree.problems.join("; ")}`);
  const inspectedAgent = inspectReleaseTarGz(preparation.agentPath, { expectedPrefix: "control-center" });
  const agentTree = compareReleaseTree(preparation.expectedAgentTree, describeTree(preparation.agentExtracted));
  if (!inspectedAgent.members.size || !agentTree.ok) throw new Error(`prepared agent tree changed before consumption: ${agentTree.problems.join("; ")}`);
  const rollbackCheck = verifyReleaseBundle(preparation.rollbackBundle, { expectedTag: preparation.plan.rollback.tag });
  if (!rollbackCheck.ok || rollbackCheck.manifest.commit !== preparation.plan.rollback.commit) throw new Error("rollback bundle changed before consumption");
  const rollbackListed = parseSha256Sums(fs.readFileSync(path.join(preparation.rollbackBundle, "SHA256SUMS"), "utf8")).filter(Boolean).map((entry) => entry.name);
  (hooks.verifyAttestation ?? verifyAttestation)(preparation.rollbackBundle, rollbackListed, { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-release.yml", sourceDigest: preparation.plan.rollback.commit, sourceRef: `refs/tags/${preparation.plan.rollback.tag}` });
  const rollbackTree = compareReleaseTree(preparation.rollbackArchiveTree, describeTree(preparation.rollbackExtracted));
  const installedRollbackTree = compareReleaseTree(preparation.rollbackExpectedTree, describeTree(preparation.rollbackControlCenter));
  if (!rollbackTree.ok || !installedRollbackTree.ok) throw new Error("rollback source tree changed before consumption");
  return { bundle: check, tree, installedTree, agentTree, rollbackTree, installedRollbackTree };
}

const imageExpectations = {
  api: { role: "api", title: "opsworkbench-control-center-api" },
  web: { role: "web", title: "opsworkbench-control-center-web" },
  admin: { role: "admin", title: "opsworkbench-control-center-admin-web" },
  reviewGate: { role: "review-gate", title: "opsworkbench-review-gate" },
};

const compatibilityScenarios = ["forward_compatibility", "rollback_compatibility", "migration_boundaries", "old_app_new_schema", "new_app_old_schema", "interrupted_migration", "failed_deployment_after_migration", "rollback_after_partial_switch", "service_restart_during_transition", "predecessor_artifacts_retained", "rollback_immutable_images", "rollback_target_independently_verified"];

function verifyOneForgeBuild(file, expectedSha256, identity, images, hooks = {}) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Forge build evidence is not a regular file");
  const bytes = fs.readFileSync(file);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new Error("Forge build evidence digest mismatch");
  const document = JSON.parse(bytes.toString("utf8"));
  const required = ["schemaVersion", "buildId", "sourceRepository", "sourceCommit", "sourceTree", "sourceTag", "backendImageDigest", "frontendImageDigest", "adminImageDigest", "reviewGateImageDigest", "builderIdentity", "builderRunnerEnvironment", "issuedAt"];
  const optional = ["releaseBundleSha256", "releaseManifestDigest"];
  if (!document || typeof document !== "object" || required.some((key) => !(key in document)) || Object.keys(document).some((key) => !required.includes(key) && !optional.includes(key))) throw new Error("Forge build evidence has missing or unknown fields");
  if (document.schemaVersion !== "forge-build-v2" || document.sourceRepository !== "https://github.com/williams342-maker/operation" || document.sourceCommit !== identity.commit || document.sourceTree !== identity.tree || document.sourceTag !== identity.tag || document.builderRunnerEnvironment !== "github-hosted" || document.builderIdentity !== `https://github.com/williams342-maker/operation/.github/workflows/control-center-images.yml@refs/tags/${identity.tag}`) throw new Error("Forge build evidence has the wrong source or builder identity");
  const bound = { api: document.backendImageDigest, web: document.frontendImageDigest, admin: document.adminImageDigest, reviewGate: document.reviewGateImageDigest };
  if (JSON.stringify(bound) !== JSON.stringify(images)) throw new Error("deployment images differ from the Forge build evidence");
  (hooks.verifyAttestation ?? verifyAttestation)(path.dirname(file), [path.basename(file)], { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-images.yml", sourceDigest: identity.commit, sourceRef: `refs/tags/${identity.tag}` });
  const verifyImageAttestation = hooks.verifyImageAttestation ?? ((reference) => execFileSync("gh", ["attestation", "verify", `oci://${reference}`, "--repo", "williams342-maker/operation", "--signer-workflow", "williams342-maker/operation/.github/workflows/control-center-images.yml", "--source-digest", identity.commit, "--source-ref", `refs/tags/${identity.tag}`], { stdio: "pipe" }));
  for (const reference of Object.values(images)) verifyImageAttestation(reference, identity);
  return { sha256: expectedSha256, buildId: document.buildId, images: bound };
}

export function verifyForgeEvidence(plan, hooks = {}) {
  const candidate = verifyOneForgeBuild(plan.forgeEvidence.candidatePath, plan.forgeEvidence.candidateSha256, { tag: plan.tag, commit: plan.commit, tree: plan.tree }, plan.candidateImages, hooks);
  const rollback = verifyOneForgeBuild(plan.forgeEvidence.rollbackPath, plan.forgeEvidence.rollbackSha256, { tag: plan.rollback.tag, commit: plan.rollback.commit, tree: plan.rollback.tree }, plan.rollback.images, hooks);
  return { ok: true, candidate, rollback };
}

export function verifyCompatibilityEvidence(plan, hooks = {}) {
  const file = plan.compatibilityEvidence.path; const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("compatibility evidence is not a regular file");
  const bytes = fs.readFileSync(file);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== plan.compatibilityEvidence.sha256) throw new Error("compatibility evidence digest mismatch");
  const evidence = JSON.parse(bytes.toString("utf8"));
  exactKeys(evidence, ["schemaVersion", "candidateTag", "candidateCommit", "rollbackTag", "rollbackCommit", "mongoTopology", "images", "migrationsPresent", "scenarios"], "compatibility evidence");
  if (evidence.schemaVersion !== "opsworkbench-schema-rehearsal-v1" || evidence.candidateTag !== plan.tag || evidence.candidateCommit !== plan.commit || evidence.rollbackTag !== plan.rollback.tag || evidence.rollbackCommit !== plan.rollback.commit || evidence.mongoTopology !== "replica-set") throw new Error("compatibility evidence names a different candidate, rollback, or topology");
  exactKeys(evidence.scenarios, compatibilityScenarios, "compatibility scenarios");
  exactKeys(evidence.images, ["candidate", "rollback"], "compatibility images");
  for (const set of ["candidate", "rollback"]) {
    exactKeys(evidence.images[set], ["api", "web", "admin", "gate"], `${set} compatibility images`);
    if (new Set(Object.values(evidence.images[set])).size !== 4 || Object.values(evidence.images[set]).some((id) => typeof id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(id))) throw new Error(`${set} compatibility image identities are invalid`);
  }
  if (new Set([...Object.values(evidence.images.candidate), ...Object.values(evidence.images.rollback)]).size !== 8) throw new Error("candidate and rollback compatibility image identities are not all distinct");
  for (const [name, result] of Object.entries(evidence.scenarios)) {
    if (result !== "passed" && !(result === "not-applicable-no-migrations" && evidence.migrationsPresent === false && name.includes("migration"))) throw new Error(`compatibility scenario did not pass: ${name}`);
  }
  (hooks.verifyAttestation ?? verifyAttestation)(path.dirname(file), [path.basename(file)], { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-deployment-rehearsal.yml", sourceDigest: plan.commit, sourceRef: `refs/tags/${plan.tag}` });
  return { ok: true, candidateCommit: evidence.candidateCommit, rollbackCommit: evidence.rollbackCommit, images: evidence.images, sha256: plan.compatibilityEvidence.sha256 };
}

export async function deployPreparedRelease(preparation, hooks = {}) {
  const { plan } = preparation;
  const forge = await (hooks.verifyForge ? hooks.verifyForge(plan) : verifyForgeEvidence(plan, hooks.forge ?? {}));
  if (!forge.ok) throw new Error("exact candidate/rollback Forge evidence is absent");
  const compatibility = await (hooks.verifyCompatibility ? hooks.verifyCompatibility(plan) : verifyCompatibilityEvidence(plan, hooks));
  if (!compatibility?.ok || compatibility.candidateCommit !== plan.commit || compatibility.rollbackCommit !== plan.rollback.commit) throw new Error("exact candidate/rollback schema compatibility evidence is absent");
  const imageEvidence = [];
  for (const [role, reference] of Object.entries(plan.candidateImages)) imageEvidence.push({ set: "candidate", role, ...inspectImmutableImage(reference, { commit: plan.commit, ...imageExpectations[role] }, hooks.images) });
  for (const [role, reference] of Object.entries(plan.rollback.images)) imageEvidence.push({ set: "rollback", role, ...inspectImmutableImage(reference, { commit: plan.rollback.commit, ...imageExpectations[role] }, hooks.images) });
  for (const image of imageEvidence) {
    const rehearsalRole = image.role === "reviewGate" ? "gate" : image.role;
    if (compatibility.images?.[image.set]?.[rehearsalRole] !== image.localImageId) throw new Error(`published ${image.set} ${image.role} image differs from the rehearsed image identity`);
  }
  const platformEvidence = await (hooks.verifyPlatformImages ? hooks.verifyPlatformImages(plan.platform) : inspectPlatformImages(plan.platform, hooks.platform ?? {}));
  if (!platformEvidence?.ok || platformEvidence.edgeImage !== plan.platform.edgeImage || platformEvidence.mongoImage !== plan.platform.mongoImage) throw new Error("platform image registry evidence is absent or mismatched");
  reverifyPreparedRelease(preparation, hooks);
  const agentScript = path.join(preparation.controlCenter, "scripts", "install-reviewed-agent.sh");
  if (!fs.existsSync(agentScript) || !fs.lstatSync(agentScript).isFile()) throw new Error("version-controlled reviewed agent installer is absent");
  const agentBackup = path.join(preparation.stage, "agent-rollback");
  const agentControl = hooks.agentControl ?? ((args) => execFileSync("bash", [agentScript, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  agentControl(["prepare", preparation.agentExtracted, agentBackup]);
  const priorCurrent = readCurrentRelease(plan.releaseRoot);
  if (priorCurrent.target !== path.resolve(plan.rollback.releaseDirectory)) throw new Error("verified rollback release is not the currently active predecessor");
  const rollbackReady = establishRollbackBeforeMutation(preparation, [...imageEvidence, platformEvidence, { role: "agent", rollbackSnapshot: agentBackup }, { role: "release-pointer", currentLink: priorCurrent.link, rollbackTarget: priorCurrent.target }]);
  const environmentFor = (images) => ({ ...process.env, OPSWORKBENCH_API_IMAGE: images.api, OPSWORKBENCH_WEB_IMAGE: images.web, OPSWORKBENCH_ADMIN_IMAGE: images.admin, OPSWORKBENCH_REVIEW_GATE_IMAGE: images.reviewGate, OPSWORKBENCH_EDGE_IMAGE: plan.platform.edgeImage, OPSWORKBENCH_MONGO_IMAGE: plan.platform.mongoImage, OPSWORKBENCH_MONGO_VOLUME: plan.platform.mongoVolume });
  const compose = hooks.compose ?? ((args, env, composeFile = preparation.compose) => execFileSync("docker", ["compose", "--project-name", plan.composeProject, "--file", composeFile, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const ready = hooks.readiness ?? (async (url) => { const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) }); return response.ok; });
  const candidateEnv = environmentFor(plan.candidateImages); const rollbackEnv = environmentFor(plan.rollback.images);
  compose(["config", "--quiet"], candidateEnv, preparation.compose);
  // First runtime mutation occurs only after the exclusive, fsynced rollback-ready record above.
  let agentActivationAttempted = false; let currentSwitched = false; let record;
  try {
    compose(["up", "-d", "--no-build", "--no-deps", "--force-recreate", "--wait", "api", "web", "admin", "review-gate"], candidateEnv, preparation.compose);
    compose(["up", "-d", "--no-build", "--no-deps", "--force-recreate", "--wait", "edge"], candidateEnv, preparation.compose);
    agentActivationAttempted = true;
    agentControl(["activate", preparation.agentExtracted, plan.tag, plan.commit, agentBackup]);
    for (let pass = 0; pass < (hooks.acceptancePasses ?? 3); pass += 1) {
      for (const url of plan.readiness) if (!await ready(url)) throw new Error(`readiness refused: ${url}`);
      if (hooks.wait) await hooks.wait();
    }
    switchCurrentRelease(priorCurrent, preparation.installedControlCenter); currentSwitched = true;
    record = { ...rollbackReady.record, runtimeMutationAuthorized: true, deployedAt: new Date().toISOString(), acceptancePasses: hooks.acceptancePasses ?? 3 };
    fs.writeFileSync(path.join(preparation.stage, "deployed.json"), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o400 });
  } catch (cause) {
    if (currentSwitched) {
      try { switchCurrentRelease(priorCurrent, priorCurrent.target); } catch (pointerCause) { throw new AggregateError([cause, pointerCause], `deployment failed and current release pointer rollback also failed: ${cause.message}; ${pointerCause.message}`, { cause: pointerCause }); }
    }
    if (agentActivationAttempted) {
      try { agentControl(["rollback", agentBackup]); } catch (agentCause) { throw new AggregateError([cause, agentCause], `deployment failed and agent rollback also failed: ${cause.message}; ${agentCause.message}`, { cause: agentCause }); }
    }
    compose(["up", "-d", "--no-build", "--no-deps", "--force-recreate", "--wait", "api", "web", "admin", "review-gate", "edge"], rollbackEnv, preparation.rollbackCompose);
    for (const url of plan.readiness) if (!await ready(url)) throw new Error(`deployment failed and rollback readiness also failed: ${cause.message}`, { cause });
    throw new Error(`deployment failed and was rolled back: ${cause.message}`, { cause });
  }
  return { status: "deployed", imageEvidence, platformEvidence, rollbackRecord: rollbackReady.file };
}

function loadPlanFile(file) {
  const resolved = path.resolve(file); const before = fs.lstatSync(resolved);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("deployment plan is not a regular file");
  const fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd); const bytes = fs.readFileSync(fd); const after = fs.fstatSync(fd);
    if (before.dev !== opened.dev || before.ino !== opened.ino || opened.dev !== after.dev || opened.ino !== after.ino || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) throw new Error("deployment plan changed while being read");
    return JSON.parse(bytes.toString("utf8"));
  } finally { fs.closeSync(fd); }
}

function assertRootOwnedPathChain(target, { directory = false } = {}) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("trusted deployment requires Linux root");
  const resolved = path.resolve(target);
  if (fs.realpathSync(resolved) !== resolved) throw new Error(`trusted deployment path traverses a symlink: ${resolved}`);
  const components = resolved.split(path.sep).filter(Boolean); let cursor = path.parse(resolved).root;
  for (const component of components) {
    cursor = path.join(cursor, component); const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || (cursor !== resolved && !stat.isDirectory())) throw new Error(`trusted deployment path has an unsafe component: ${cursor}`);
    if (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0) throw new Error(`trusted deployment path is not root-owned and non-writable: ${cursor}`);
  }
  const leaf = fs.lstatSync(resolved);
  if ((directory && !leaf.isDirectory()) || (!directory && !leaf.isFile())) throw new Error("trusted deployment path has the wrong type");
}

function assertProductionPlanLocations(planFile, plan) {
  const deployerRoot = "/var/lib/opsworkbench-deployer"; const inbox = `${deployerRoot}/inbox`; const plans = `${deployerRoot}/plans`;
  if (path.resolve(plan.releaseRoot) !== "/opt/opsworkbench/releases" || path.resolve(plan.stagingRoot) !== deployerRoot) throw new Error("production deployment roots are not the fixed trusted roots");
  for (const [name, location] of [["plan", planFile], ["candidate bundle", plan.bundleDirectory], ["rollback bundle", plan.rollback.bundleDirectory]]) {
    const allowed = name === "plan" ? plans : inbox; const resolved = path.resolve(location);
    if (!resolved.startsWith(`${allowed}${path.sep}`)) throw new Error(`${name} is outside its fixed trusted root`);
    assertRootOwnedPathChain(resolved, { directory: name !== "plan" });
  }
  assertRootOwnedPathChain(plan.stagingRoot, { directory: true }); assertRootOwnedPathChain(plan.releaseRoot, { directory: true });
}

async function main() {
  const command = process.argv[2]; const planIndex = process.argv.indexOf("--plan");
  if (!['prepare', 'deploy'].includes(command) || planIndex < 0 || !process.argv[planIndex + 1]) throw new Error("usage: trusted-deployer.mjs <prepare|deploy> --plan <absolute-plan.json>");
  const planFile = path.resolve(process.argv[planIndex + 1]); const plan = loadPlanFile(planFile); assertProductionPlanLocations(planFile, plan);
  const preparation = prepareReviewedRelease(plan);
  if (command === "prepare") process.stdout.write(`${JSON.stringify({ status: "prepared", stage: preparation.stage, commit: preparation.plan.commit, tree: preparation.plan.tree })}\n`);
  else process.stdout.write(`${JSON.stringify(await deployPreparedRelease(preparation))}\n`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((error) => { process.stderr.write(`trusted deployment refused: ${error.message}\n`); process.exitCode = 1; });
