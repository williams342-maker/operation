#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  exactKeys(value, ["schemaVersion", "tag", "commit", "tree", "bundleDirectory", "stagingRoot", "releaseRoot", "composeProject", "candidateImages", "rollback", "readiness"], "deployment plan");
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
  exactKeys(value.rollback, ["tag", "commit", "tree", "images", "releaseDirectory", "evidenceSha256"], "rollback");
  if (!tagPattern.test(value.rollback.tag) || !commitPattern.test(value.rollback.commit) || !commitPattern.test(value.rollback.tree) || !/^[a-f0-9]{64}$/.test(value.rollback.evidenceSha256) || !path.isAbsolute(value.rollback.releaseDirectory)) throw new Error("rollback identity is invalid");
  exactKeys(value.rollback.images, ["api", "web", "admin", "reviewGate"], "rollback images");
  for (const [role, reference] of Object.entries(value.rollback.images)) {
    const match = typeof reference === "string" && reference.match(digestReference);
    if (!match || match[1] !== roles[role]) throw new Error(`rollback ${role} image is not the expected immutable repository`);
    if (reference === value.candidateImages[role]) throw new Error(`candidate and rollback ${role} image are identical`);
  }
  if (new Set(Object.values(value.rollback.images)).size !== 4) throw new Error("rollback runtime images are not distinct");
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
    (hooks.verifyAttestation ?? verifyAttestation)(stage, listed, { required: true });
    const archivePath = path.join(stage, copiedCheck.manifest.artifact);
    const prefix = `opsworkbench-control-center-${plan.tag.slice(1)}`;
    const inspected = inspectReleaseTarGz(archivePath, { expectedPrefix: prefix });
    if (inspected.archiveCommit !== plan.commit) throw new Error("archive embedded commit differs from the deployment plan");
    const extracted = path.join(stage, "extracted"); fs.mkdirSync(extracted, { mode: 0o700 });
    (hooks.extract ?? ((archive, destination) => execFileSync("tar", ["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", destination], { stdio: "pipe" })))(archivePath, extracted);
    const treeCheck = compareReleaseTree(expectedArchiveTree(inspected.members), describeTree(extracted));
    if (!treeCheck.ok) throw new Error(`extracted release tree failed verification: ${treeCheck.problems.join("; ")}`);
    const controlCenter = path.join(extracted, prefix, "control-center");
    const compose = path.join(controlCenter, "deploy", "docker-compose.production.yml");
    if (!fs.existsSync(compose) || !fs.lstatSync(compose).isFile()) throw new Error("version-controlled production compose file is absent");
    const evidence = { schemaVersion: "opsworkbench-deployment-preparation-v1", tag: plan.tag, commit: plan.commit, tree: plan.tree, preparedAt: new Date().toISOString(), hostname: os.hostname(), artifactSha256: crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex"), candidateImages: plan.candidateImages, rollback: plan.rollback };
    fs.writeFileSync(path.join(stage, "preparation.json"), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o400 });
    return { stage, extracted, controlCenter, compose, evidence };
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
