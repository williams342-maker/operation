#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectReleaseTarGz } from "./safe-release-archive.mjs";
import { attestationBundleFor, parseSha256Sums, verifyAttestation, verifyReleaseBundle } from "./verify-release-bundle.mjs";
import { compareReleaseTree, describeTree } from "./verify-release-tree.mjs";

const digestReference = /^ghcr\.io\/williams342-maker\/operation\/(control-center-api|control-center-web|control-center-admin-web|review-gate)@sha256:[a-f0-9]{64}$/;
const tagPattern = /^v(\d+)\.(\d+)\.(\d+)-operate$/;
const commitPattern = /^[a-f0-9]{40}$/;

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${name} has missing or unknown fields`);
  }
}

/** A release directory is `<releaseRoot>/<name>/app`, where `name` is the tag or `review-<commit prefix>`. */
export function isReleaseDirectoryFor(directory, releaseRoot, release) {
  const resolved = path.resolve(directory);
  if (resolved === path.resolve(releaseRoot, release.tag, "app")) return true;
  const parent = path.dirname(resolved);
  if (path.basename(resolved) !== "app" || path.dirname(parent) !== path.resolve(releaseRoot)) return false;
  const named = /^review-([0-9a-f]{7,40})$/.exec(path.basename(parent));
  return Boolean(named) && release.commit.startsWith(named[1]);
}

/** HTTPS anywhere, or plain HTTP only on loopback, where there is no network to intercept. */
export function isReadinessEndpoint(url) {
  if (typeof url !== "string") return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === "https:") return /^[A-Za-z0-9.-]+$/.test(parsed.hostname);
  if (parsed.protocol !== "http:") return false;
  return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
}

/**
 * The attestation source every verification in this file shares. With `attestationBundles` the checks
 * read attestations from disk instead of the GitHub API, which is what lets a host verify provenance
 * with no GitHub credential on it at all. Absent, every call behaves exactly as it did before.
 */
const attestationSource = (plan) => (plan?.attestationBundles ? { bundleDirectory: plan.attestationBundles } : {});

/** The digest a pinned image reference names, which is also the name of its attestation bundle. */
function imageSubjectDigest(reference) {
  const match = /@sha256:([a-f0-9]{64})$/.exec(String(reference));
  if (!match) throw new Error("image reference is not pinned to a digest");
  return match[1];
}

export function parseDeploymentPlan(value) {
  // `attestationBundles` is OPTIONAL, so the key list depends on whether the plan carries it. Adding it
  // unconditionally would have refused every existing plan; leaving it out of the list would have let
  // an unknown key through the one check whose job is to refuse unknown keys.
  const keys = ["schemaVersion", "tag", "commit", "tree", "bundleDirectory", "stagingRoot", "releaseRoot", "composeProject", "candidateImages", "platform", "rollback", "forgeEvidence", "compatibilityEvidence", "readiness"];
  if (value && typeof value === "object" && "attestationBundles" in value) keys.push("attestationBundles");
  exactKeys(value, keys, "deployment plan");
  if ("attestationBundles" in value && (typeof value.attestationBundles !== "string" || !path.isAbsolute(value.attestationBundles))) throw new Error("attestationBundles must be an absolute path");
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
  // HOW THE ROLLBACK TARGET IS ESTABLISHED, and the two answers are not interchangeable.
  //
  // "attested" is the normal case: the rollback is a published release, its bundle is attested, its
  // images are in the registry with their own attestations, and the rehearsal exercised the exact pair.
  //
  // "host-verified" is for a FIRST deployment onto a host whose current release predates all of that.
  // It cannot be rebuilt, has no Forge build document, its images were built on the box and never
  // pushed, and -- on this host -- its tree carries no production Compose file at all. What can still
  // be established is stronger in one specific way and weaker in every other: the rollback target is
  // not a release we believe we could reproduce, it is the exact set of artefacts currently serving
  // traffic, MEASURED rather than declared. Nothing about the candidate side is relaxed.
  if (value.rollback.evidence !== "attested" && value.rollback.evidence !== "host-verified") throw new Error("rollback evidence must be attested or host-verified");
  const hostVerifiedRollback = value.rollback.evidence === "host-verified";
  // The plan does not get to say what a host-verified rollback consists of; the host does. So it names
  // only the identity being rolled back TO, and carries no images, bundle or artifact digest to be
  // trusted -- there is nothing there for a bad plan to lie about.
  exactKeys(value.rollback, hostVerifiedRollback ? ["evidence", "tag", "commit", "tree", "bundleDirectory", "releaseDirectory", "evidenceSha256", "adoptionRecords"] : ["evidence", "tag", "commit", "tree", "images", "bundleDirectory", "releaseDirectory", "evidenceSha256"], "rollback");
  // The records written when a person stopped an unmanaged container. They are how a predecessor found
  // by its published port is identified, rather than assumed from the port alone. An empty list is
  // allowed and means every service is expected to be found running under a Compose label.
  if (hostVerifiedRollback) {
    if (!Array.isArray(value.rollback.adoptionRecords) || value.rollback.adoptionRecords.length > 8) throw new Error("rollback adoptionRecords must be a list of at most eight paths");
    for (const record of value.rollback.adoptionRecords) if (typeof record !== "string" || !path.isAbsolute(record)) throw new Error("rollback adoptionRecords must be absolute paths");
  }
  if (!tagPattern.test(value.rollback.tag) || !commitPattern.test(value.rollback.commit) || !commitPattern.test(value.rollback.tree) || !/^[a-f0-9]{64}$/.test(value.rollback.evidenceSha256) || !path.isAbsolute(value.rollback.bundleDirectory) || !path.isAbsolute(value.rollback.releaseDirectory)) throw new Error("rollback identity is invalid");
  // A release directory may be named after the TAG or after its own COMMIT. Production names every
  // release `review-<short commit>` -- 97 of them -- and nothing there is named after a tag, so the
  // tag-only rule made the plan unsatisfiable on the host it was written for. The commit form is
  // accepted only when the hex actually prefixes that release's own commit, so a directory name still
  // cannot be pointed at an unrelated release: the binding between name and identity is preserved,
  // only its spelling is widened.
  if (!isReleaseDirectoryFor(value.rollback.releaseDirectory, value.releaseRoot, value.rollback)) throw new Error("rollback release directory does not name that release");
  if (path.resolve(value.rollback.bundleDirectory) === path.resolve(value.bundleDirectory)) throw new Error("rollback source location is ambiguous");
  if (value.rollback.tag === value.tag || value.rollback.commit === value.commit || value.rollback.tree === value.tree) throw new Error("candidate and rollback release identities must be distinct");
  if (!hostVerifiedRollback) {
    exactKeys(value.rollback.images, ["api", "web", "admin", "reviewGate"], "rollback images");
    for (const [role, reference] of Object.entries(value.rollback.images)) {
      const match = typeof reference === "string" && reference.match(digestReference);
      if (!match || match[1] !== roles[role]) throw new Error(`rollback ${role} image is not the expected immutable repository`);
      if (reference === value.candidateImages[role]) throw new Error(`candidate and rollback ${role} image are identical`);
    }
    if (new Set(Object.values(value.rollback.images)).size !== 4) throw new Error("rollback runtime images are not distinct");
  }
  // There is no Forge build document for a host-verified rollback -- the release predates Forge -- so
  // the plan must not carry a path pretending otherwise.
  exactKeys(value.forgeEvidence, hostVerifiedRollback ? ["candidatePath", "candidateSha256"] : ["candidatePath", "candidateSha256", "rollbackPath", "rollbackSha256"], "forgeEvidence");
  for (const field of hostVerifiedRollback ? ["candidatePath"] : ["candidatePath", "rollbackPath"]) if (!path.isAbsolute(value.forgeEvidence[field])) throw new Error(`forgeEvidence.${field} must be absolute`);
  for (const field of hostVerifiedRollback ? ["candidateSha256"] : ["candidateSha256", "rollbackSha256"]) if (!/^[a-f0-9]{64}$/.test(value.forgeEvidence[field])) throw new Error(`forgeEvidence.${field} is invalid`);
  exactKeys(value.compatibilityEvidence, ["path", "sha256"], "compatibilityEvidence");
  if (!path.isAbsolute(value.compatibilityEvidence.path) || !/^[a-f0-9]{64}$/.test(value.compatibilityEvidence.sha256)) throw new Error("compatibility evidence identity is invalid");
  // Readiness must not be interceptable. Off-host that means HTTPS; on loopback it means loopback --
  // packets to 127.0.0.1 never reach a network, so TLS adds nothing there. This host's edge listens on
  // 127.0.0.1:18080 behind a Cloudflare tunnel whose ingress cannot be read from the machine, so an
  // HTTPS-only rule left no satisfiable endpoint at all, and the honest alternatives were a self-signed
  // certificate or no readiness check. Anything not on loopback is still required to be HTTPS.
  if (!Array.isArray(value.readiness) || value.readiness.length < 3 || value.readiness.some((url) => !isReadinessEndpoint(url))) throw new Error("at least three readiness endpoints are required, HTTPS unless they are on loopback");
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
  // Scope, stated precisely, because an earlier version of this comment said "universal" and a reviewer
  // was right that the whole check returns immediately off Linux — so neither half is universal.
  // ON LINUX: the mode half always applies; the OWNERSHIP half is only assertable by root, and this
  // deployer refuses to run as anything else — `assertRootOwnedPathChain` throws unless `getuid() === 0`,
  // and it runs over the plan and both roots before any release is prepared. So in production this is
  // always the full check, unchanged. Off that path (a test, which cannot chown to root) the read-only
  // half still applies, which is the half that does not depend on who is asking.
  // OFF LINUX: nothing below runs at all. Production is Linux; a non-Linux run is a test.
  const validateSealed = (directory) => {
    if (process.platform !== "linux") return;
    const requireRootOwner = process.getuid?.() === 0;
    const visit = (file) => {
      const stat = fs.lstatSync(file);
      if (requireRootOwner && (stat.uid !== 0 || stat.gid !== 0)) throw new Error(`installed release object is not root-owned: ${file}`);
      if ((stat.mode & 0o222) !== 0) throw new Error(`installed release object is writable: ${file}`);
      if (stat.isDirectory()) for (const entry of fs.readdirSync(file)) visit(path.join(file, entry));
    };
    visit(directory);
  };
  // CLEANUP HAS TO BE ABLE TO REMOVE WHAT SEALING JUST CREATED. `makeReadonly` strips write from every
  // directory, so the failure handler's `rm -r` then died with EACCES and reported THAT instead of the
  // error it was cleaning up after — the real refusal was invisible. Best-effort throughout: a failure
  // to tidy up must never replace the reason we are tidying up.
  const makeRemovable = (directory) => {
    try { fs.chmodSync(directory, 0o700); } catch { /* report the original error, not this one */ }
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) makeRemovable(file);
      else try { fs.chmodSync(file, 0o600); } catch { /* as above */ }
    }
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
    } catch (error) {
      try {
        if (fs.existsSync(pending)) { makeRemovable(pending); fs.rmSync(pending, { recursive: true, force: true }); }
      } catch { /* A leftover pending tree must not replace the installation refusal. */ }
      throw error;
    }
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
    (hooks.verifyAttestation ?? verifyAttestation)(stage, listed, { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-release.yml", sourceDigest: plan.commit, sourceRef: `refs/tags/${plan.tag}`, ...attestationSource(plan) });
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
    // The agent artifact is the CANDIDATE's, and nothing reads a rollback bundle's. A host-verified
    // rollback targets the release actually running, which on this host predates the agent artifact, so
    // demanding one would refuse the only rollback target a first deployment can have.
    const rollbackCheck = verifyReleaseBundle(plan.rollback.bundleDirectory, { expectedTag: plan.rollback.tag, requireAgentArtifact: !hostVerified(plan) });
    if (!rollbackCheck.ok || rollbackCheck.manifest.commit !== plan.rollback.commit) throw new Error("rollback release bundle failed verification");
    const rollbackListed = parseSha256Sums(fs.readFileSync(path.join(plan.rollback.bundleDirectory, "SHA256SUMS"), "utf8")).filter(Boolean).map((entry) => entry.name);
    for (const name of ["SHA256SUMS", ...rollbackListed]) copyStableRegular(path.join(plan.rollback.bundleDirectory, name), path.join(rollbackBundle, name));
    (hooks.verifyAttestation ?? verifyAttestation)(rollbackBundle, rollbackListed, { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-release.yml", sourceDigest: plan.rollback.commit, sourceRef: `refs/tags/${plan.rollback.tag}`, ...attestationSource(plan) });
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
    // A host-verified rollback target is the release that is SERVING TRAFFIC RIGHT NOW. Reinstalling it
    // would rewrite the live release directory during preparation -- before any mutation is authorised
    // -- to make it match something it is already expected to match. So it is compared in place and
    // left alone, and a difference is a refusal rather than a repair.
    const rollbackControlCenter = hostVerified(plan)
      ? verifyInstalledTree(plan.rollback.releaseDirectory, rollbackExpectedTree)
      : installAndVerifyExactTree(path.join(rollbackExtracted, rollbackPrefix, "control-center"), plan.rollback.releaseDirectory, rollbackExpectedTree);
    // The rollback release predates the production Compose file on this lineage, so under a
    // host-verified rollback there is nothing to run it from. The candidate's Compose file is used
    // instead, with the measured rollback IMAGES. That restores the code that was serving, under the
    // service definitions of the release being rolled back FROM -- which is a real difference and the
    // reason this mode is limited to a first deployment.
    const rollbackCompose = hostVerified(plan) ? compose : path.join(rollbackControlCenter, "deploy", "docker-compose.production.yml");
    if (!fs.lstatSync(rollbackCompose).isFile()) throw new Error("rollback compose file is absent");
    const evidence = { schemaVersion: "opsworkbench-deployment-preparation-v1", tag: plan.tag, commit: plan.commit, tree: plan.tree, preparedAt: new Date().toISOString(), hostname: os.hostname(), artifactSha256: crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex"), agentArtifactSha256: crypto.createHash("sha256").update(fs.readFileSync(agentPath)).digest("hex"), candidateImages: plan.candidateImages, rollback: plan.rollback };
    fs.writeFileSync(path.join(stage, "preparation.json"), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o400 });
    return { stage, extracted, controlCenter: installedControlCenter, compose, installedControlCenter, candidateExpectedTree, rollbackBundle, rollbackExtracted, rollbackControlCenter, rollbackCompose, rollbackExpectedTree, rollbackArchiveTree, rollbackPrefix, agentExtracted, agentPath, evidence, plan, expectedTree: expectedArchiveTree(inspected.members), expectedAgentTree: expectedArchiveTree(inspectedAgent.members), prefix };
  } catch (error) {
    try { fs.writeFileSync(path.join(stage, "FAILED"), `${error.message}\n`, { flag: "wx", mode: 0o400 }); }
    catch { /* Preserve the refusal even if the private stage cannot accept its diagnostic. */ }
    throw error;
  }
}

/**
 * Docker's own reference normalisation, applied before comparing two spellings of one image.
 *
 * THE REGISTRY AND THE LOCAL DAEMON DISAGREE about how to write a Docker Hub image. Measured on the
 * target: `docker buildx imagetools inspect nginx@sha256:65645c...` reports
 * `Name: docker.io/library/nginx@sha256:65645c...`, while `docker image inspect` lists
 * `nginx@sha256:65645c...` in RepoDigests. Both name the same bytes.
 *
 * Comparing those as strings made a correct platform image look like a registry binding failure, and no
 * spelling satisfied both checks: the short form failed the remote comparison, the fully qualified form
 * failed the local one. The tests never saw it because their remoteInspect hook echoes back whatever
 * reference it is handed, so the two forms are identical in the fixture and cannot disagree.
 *
 * The rules are Docker's. A first path segment containing "." or ":", or equal to "localhost", is a
 * registry host; otherwise the reference is on docker.io. A docker.io name with a single path segment
 * lives under "library/". Normalising is not loosening: two references are equal here only when they
 * resolve to the same registry, repository and digest.
 */
export function normalizeImageReference(reference) {
  const text = String(reference ?? "");
  const at = text.indexOf("@");
  const name = at === -1 ? text : text.slice(0, at);
  const digest = at === -1 ? "" : text.slice(at);
  const segments = name.split("/").filter(Boolean);
  const first = segments[0] ?? "";
  const hasRegistry = segments.length > 1 && (first.includes(".") || first.includes(":") || first === "localhost");
  const registry = hasRegistry ? first : "docker.io";
  const remainder = hasRegistry ? segments.slice(1) : segments;
  const repository = registry === "docker.io" && remainder.length === 1 ? ["library", ...remainder] : remainder;
  return `${registry}/${repository.join("/")}${digest}`;
}

/** Whether two image references name the same registry, repository and digest. */
const sameImageReference = (one, other) => normalizeImageReference(one) === normalizeImageReference(other);

export function inspectImmutableImage(reference, expectation, hooks = {}) {
  if (!digestReference.test(reference)) throw new Error("image reference is not an approved immutable repository digest");
  const expectedDigest = reference.slice(reference.indexOf("@") + 1);
  const remote = (hooks.remoteInspect ?? ((ref) => execFileSync("docker", ["buildx", "imagetools", "inspect", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })))(reference);
  const remoteName = String(remote).split(/\r?\n/).map((line) => line.match(/^Name:\s+(\S+)$/)?.[1]).find(Boolean);
  if (!sameImageReference(remoteName, reference)) throw new Error(`registry inspection did not bind the requested digest: ${reference}`);
  (hooks.pull ?? ((ref) => execFileSync("docker", ["pull", ref], { stdio: "pipe" })))(reference);
  const inspectLocal = hooks.localInspect ?? ((ref) => {
    const output = execFileSync("docker", ["image", "inspect", ref, "--format", "{{json .}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(output);
  });
  const local = inspectLocal(reference);
  const repoDigests = Array.isArray(local.RepoDigests) ? local.RepoDigests : [];
  if (!repoDigests.some((candidate) => sameImageReference(candidate, reference))) throw new Error(`local image does not retain the registry digest: ${reference}`);
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
    if (!sameImageReference(remoteName, reference)) throw new Error(`platform registry inspection did not bind ${reference}`);
    (hooks.pull ?? ((ref) => execFileSync("docker", ["pull", ref], { stdio: "pipe" })))(reference);
    const local = (hooks.localInspect ?? ((ref) => JSON.parse(execFileSync("docker", ["image", "inspect", ref, "--format", "{{json .}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))))(reference);
    if (!Array.isArray(local.RepoDigests) || !local.RepoDigests.some((candidate) => sameImageReference(candidate, reference)) || !/^sha256:[a-f0-9]{64}$/.test(local.Id ?? "")) throw new Error(`platform local image identity is not digest-bound: ${reference}`);
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

// Two files were written into production outside any release, and the running admin image is built from
// them. Reinstalling the tree would take them away, so verifying it in place has to tolerate them.
//
// TYPED, through compareReleaseTree's own allowance API, which exists for exactly this and is stricter
// than anything worth hand-rolling: a bare path would let one of these arrive as a SYMLINK pointing
// anywhere, and a directory allowance covers that entry alone rather than everything anyone puts in it.
// An earlier version of this parsed the comparator's human-readable problem strings with a regex, which
// discarded the entry type the comparator had gone to the trouble of reporting.
const offChainProductionFiles = [
  { path: "apps", type: "directory" },
  { path: "apps/web", type: "directory" },
  { path: "apps/web/Dockerfile.admin", type: "file" },
  { path: "deploy/nginx", type: "directory" },
  { path: "deploy/nginx/admin-web.conf", type: "file" },
];

/** Whether this plan's rollback target is established by measuring the host rather than by attestation. */
const hostVerified = (plan) => plan?.rollback?.evidence === "host-verified";

/**
 * The same tree comparison installAndVerifyExactTree performs, without the install. Used where the
 * directory is already the live one: a mismatch there is something to refuse, not something to fix.
 */
function verifyInstalledTree(directory, expectedTree) {
  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved) || !fs.lstatSync(resolved).isDirectory()) throw new Error("rollback release directory is absent");
  const check = compareReleaseTree(expectedTree, describeTree(resolved), { allowExtra: offChainProductionFiles });
  if (!check.ok) throw new Error(`rollback release directory differs from its attested bundle: ${(check.problems ?? []).join("; ")}`);
  return resolved;
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
  (hooks.verifyAttestation ?? verifyAttestation)(preparation.stage, listed, { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-release.yml", sourceDigest: preparation.plan.commit, sourceRef: `refs/tags/${preparation.plan.tag}`, ...attestationSource(preparation.plan) });
  const inspected = inspectReleaseTarGz(path.join(preparation.stage, check.manifest.artifact), { expectedPrefix: preparation.prefix });
  if (inspected.archiveCommit !== preparation.plan.commit) throw new Error("prepared archive commit changed");
  const tree = compareReleaseTree(preparation.expectedTree, describeTree(preparation.extracted));
  if (!tree.ok) throw new Error(`prepared tree changed before consumption: ${tree.problems.join("; ")}`);
  const installedTree = compareReleaseTree(preparation.candidateExpectedTree, describeTree(preparation.installedControlCenter));
  if (!installedTree.ok) throw new Error(`installed candidate tree changed before consumption: ${installedTree.problems.join("; ")}`);
  const inspectedAgent = inspectReleaseTarGz(preparation.agentPath, { expectedPrefix: "control-center" });
  if (inspectedAgent.archiveCommit !== preparation.plan.commit) throw new Error("prepared agent archive commit changed");
  const agentTree = compareReleaseTree(preparation.expectedAgentTree, describeTree(preparation.agentExtracted));
  if (!inspectedAgent.members.size || !agentTree.ok) throw new Error(`prepared agent tree changed before consumption: ${agentTree.problems.join("; ")}`);
  // Same option as preparation used. A stricter re-verification would refuse at the last moment over
  // the exact bundle preparation accepted, which is the drift that makes a late check worse than none.
  const rollbackCheck = verifyReleaseBundle(preparation.rollbackBundle, { expectedTag: preparation.plan.rollback.tag, requireAgentArtifact: !hostVerified(preparation.plan) });
  if (!rollbackCheck.ok || rollbackCheck.manifest.commit !== preparation.plan.rollback.commit) throw new Error("rollback bundle changed before consumption");
  const rollbackListed = parseSha256Sums(fs.readFileSync(path.join(preparation.rollbackBundle, "SHA256SUMS"), "utf8")).filter(Boolean).map((entry) => entry.name);
  (hooks.verifyAttestation ?? verifyAttestation)(preparation.rollbackBundle, rollbackListed, { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-release.yml", sourceDigest: preparation.plan.rollback.commit, sourceRef: `refs/tags/${preparation.plan.rollback.tag}`, ...attestationSource(preparation.plan) });
  const rollbackTree = compareReleaseTree(preparation.rollbackArchiveTree, describeTree(preparation.rollbackExtracted));
  // Same allowances as preparation used. A stricter check here would refuse at the last moment over the
  // very files preparation deliberately tolerated, and a looser one would carry a weaker check into the
  // moment that matters. They have to be the same policy, so they are the same list.
  const installedRollbackTree = compareReleaseTree(preparation.rollbackExpectedTree, describeTree(preparation.rollbackControlCenter), hostVerified(preparation.plan) ? { allowExtra: offChainProductionFiles } : {});
  if (!rollbackTree.ok || !installedRollbackTree.ok) throw new Error("rollback source tree changed before consumption");
  return { bundle: check, tree, installedTree, agentTree, rollbackTree, installedRollbackTree };
}

const imageExpectations = {
  api: { role: "api", title: "opsworkbench-control-center-api" },
  web: { role: "web", title: "opsworkbench-control-center-web" },
  admin: { role: "admin", title: "opsworkbench-control-center-admin-web" },
  reviewGate: { role: "review-gate", title: "opsworkbench-review-gate" },
};

// The services this target RUNS, which is not the same set as the images the release BUILDS.
//
// Four images are built, attested and bound; three application services are started here. Production
// runs api, web and admin, and has never run a review gate. Keeping the fourth image fully verified
// while not starting it keeps provenance intact without claiming the target runs something it does
// not -- the image set is a property of the build, the running set is a property of the target.
//
// Forward and rollback MUST start the same services. They were two separate literal lists, and a
// rollback that recreates a different set than the deployment it is undoing does not restore the
// state it promised. One constant removes the chance of that drift.
const applicationServices = ["api", "web", "admin"];

const composeProjectLabel = "com.docker.compose.project";

/**
 * A host binding blocks another whenever the ports and protocols match and the addresses overlap.
 * An unset or wildcard address covers every address, so `0.0.0.0:18081` and `127.0.0.1:18081` are a
 * conflict even though the strings differ -- comparing them as strings reports "no conflict" and then
 * the bind fails at `up`, which is the whole failure this is here to prevent.
 */
function hostAddressesOverlap(one, other) {
  const wildcard = (value) => !value || value === "0.0.0.0" || value === "::" || value === "[::]";
  return wildcard(one) || wildcard(other) || one === other;
}

function publishedEndpoints(model, services) {
  const wanted = [];
  for (const name of services) {
    for (const mapping of model?.services?.[name]?.ports ?? []) {
      const published = String(mapping?.published ?? "").trim();
      if (!published) continue;
      // Compose usually expands a published RANGE into one entry per port, but long syntax can carry
      // the range through as "8100-8105". Comparing that as a string matches no held port, so the check
      // would look present and detect nothing. Refuse instead: a shape this cannot evaluate must not
      // read as "no conflict".
      if (!/^[0-9]{1,5}$/.test(published) || Number(published) < 1 || Number(published) > 65535) throw new Error(`service ${name} publishes ${published}, which this conflict check cannot evaluate`);
      // Compared as a NUMBER. Compose preserves a long-syntax `published: "01881"` verbatim while the
      // daemon reports the held binding as "1881", and comparing those as strings finds no conflict on
      // a port that is genuinely taken.
      wanted.push({ service: name, hostIp: mapping.host_ip ?? "", hostPort: Number(published), protocol: mapping.protocol || "tcp" });
    }
  }
  return wanted;
}

/** Every wanted endpoint this container's own published bindings would collide with. */
function matchingEndpoints(container, wanted) {
  const matches = [];
  for (const [port, bindings] of Object.entries(container?.HostConfig?.PortBindings ?? {})) {
    const protocol = port.split("/")[1] || "tcp";
    for (const binding of bindings ?? []) {
      const held = String(binding?.HostPort ?? "");
      if (!/^[0-9]{1,5}$/.test(held)) continue;
      for (const target of wanted) {
        if (target.protocol !== protocol || target.hostPort !== Number(held)) continue;
        if (!hostAddressesOverlap(target.hostIp, binding?.HostIp ?? "")) continue;
        matches.push({ service: target.service, endpoint: `${binding?.HostIp || "0.0.0.0"}:${held}/${protocol}` });
      }
    }
  }
  return matches;
}

const holdsAnyEndpoint = (container, wanted) => matchingEndpoints(container, wanted).length > 0;

/**
 * Containers this project does not own, holding a host port a service we are about to start publishes.
 *
 * Compose adopts a container only by its own project/service LABELS. A container started outside
 * Compose -- `docker run` -- carries none, so Compose will not reuse it, will not stop it, and will
 * try to create a second container on the same host binding. Docker then refuses the bind and `up`
 * fails PART WAY THROUGH, after earlier services in the same command were already recreated. Nothing
 * else in this deployer looks at running containers at all: the image inspections inspect images, and
 * the Compose preflights validate configuration. Port ownership is neither.
 */
export function detectForeignPortConflicts(model, services, projectName, containers) {
  const wanted = publishedEndpoints(model, services);
  const conflicts = [];
  for (const container of containers ?? []) {
    const labels = container?.Config?.Labels ?? {};
    // Containers this project already owns are not conflicts: Compose recreates its own by label.
    if (labels[composeProjectLabel] === projectName) continue;
    const name = String(container?.Name ?? "").replace(/^\//, "");
    for (const match of matchingEndpoints(container, wanted)) {
      conflicts.push({ service: match.service, endpoint: match.endpoint, container: name, project: labels[composeProjectLabel] ?? null, image: container?.Config?.Image ?? null });
    }
  }
  return conflicts;
}

/**
 * The image each application service is being replaced FROM, taken from the host rather than the plan.
 *
 * This is what makes a host-verified rollback meaningful. The rollback target is not a release we
 * believe we could rebuild -- it is the exact set of images that were serving, so the strongest true
 * statement about it is also the one that matters: rolling back puts back what was there.
 *
 * IT MUST BE GIVEN STOPPED CONTAINERS TOO, and that is not a detail. The unmanaged admin container has
 * to be stopped before this deployment can run at all, because otherwise it holds the port the admin
 * service publishes and the conflict check refuses. So by the time the predecessor is measured, the one
 * container that can say what admin was running is already stopped. Measuring only running containers
 * would refuse every first deployment for the exact reason the deployment was made possible. A stopped
 * container still carries its image and its port bindings, which is all this reads.
 *
 * Two ways to find a service's container, and NEITHER of them is uniqueness alone. A container labelled
 * with this project and service must also be RUNNING, because Compose labels outlive every container it
 * ever made and this host keeps 97 releases of history. A container found by the published port must be
 * named by an adoption record, because that path exists for the unmanaged container, which is stopped by
 * the time we look and so cannot be told apart from a stale one by its state.
 *
 * Recording which container was chosen makes the choice auditable. Requiring it to be running, or to be
 * one a person deliberately stopped, is what makes it right.
 */
export function measurePredecessorImages(model, services, projectName, containers, adoptedContainerIds = new Set()) {
  const measured = {};
  for (const service of services) {
    const labelled = (containers ?? []).filter((container) => {
      const labels = container?.Config?.Labels ?? {};
      // `docker compose run api ...` produces a container with THIS project's and service's labels that
      // is not the service. It can be running while the real one is stopped, and it would then be the
      // only running match -- so uniqueness plus running would have selected a one-off shell as the
      // thing being replaced. Compose marks them, and the marker is the only thing that separates them.
      if (String(labels["com.docker.compose.oneoff"] ?? "").toLowerCase() === "true") return false;
      return labels[composeProjectLabel] === projectName && labels["com.docker.compose.service"] === service;
    });
    // A LABEL MATCH MUST BE RUNNING. Compose labels persist on every container it ever created, and this
    // host keeps 97 releases' worth of history, so a stopped container from an old release carries the
    // same project and service labels as the live one. Uniqueness alone would let that stale container
    // win. Requiring it to be running is what makes the label match mean "the one serving".
    let found = labelled.filter((container) => container?.State?.Running === true);
    let matchedBy = "compose-label";
    if (!found.length) {
      // A PORT MATCH MUST BE A CONTAINER SOMEONE ADOPTED. This path exists for the unmanaged container,
      // which is stopped by the time we look -- it had to be, or it would still hold the port -- so
      // "running" cannot be the discriminator here. Instead its identity comes from the adoption record
      // written when a person stopped it: an id that was reviewed, not one inferred from a port that
      // several stopped containers in this host's history could equally claim.
      const wanted = publishedEndpoints(model, [service]);
      const byPort = wanted.length ? (containers ?? []).filter((container) => holdsAnyEndpoint(container, wanted)) : [];
      found = byPort.filter((container) => adoptedContainerIds.has(String(container?.Id ?? "")));
      matchedBy = "adoption-record";
      if (!found.length && byPort.length) throw new Error(`the container holding ${service}'s published port is not named by any adoption record; refusing to guess that it is the predecessor`);
    }
    if (found.length !== 1) throw new Error(`cannot identify exactly one predecessor container for ${service}: found ${found.length}`);
    const image = String(found[0]?.Image ?? "");
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error(`predecessor container for ${service} has no content-addressed image id`);
    // The container is named as well as its image. An image id alone cannot be traced back to what was
    // inspected, and a recovery reading this record afterwards has no other way to know what was chosen.
    const containerId = String(found[0]?.Id ?? "");
    // Without an id the record cannot name what was chosen, and a recovery reading it later has nothing
    // to check against. An inspect that reports no id is a refusal, not a blank field.
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error(`predecessor container for ${service} has no full container id`);
    measured[service] = { image, container: String(found[0]?.Name ?? "").replace(/^\//, ""), containerId, matchedBy };
  }
  const images = Object.values(measured).map((entry) => entry.image);
  if (new Set(images).size !== images.length) throw new Error("two services report the same running image; the measurement is ambiguous");
  return measured;
}

/** Every container on the host, running or not -- see measurePredecessorImages for why stopped counts. */
/**
 * The container ids a person deliberately stopped, read from the adoption records the plan names.
 *
 * These are consumed by a root process, so each is read the way the adoption tool writes and reads them:
 * a regular file, not a symlink, carrying the schema it claims. A record that does not parse is a
 * refusal rather than an id quietly missing from the set, because a missing id makes the predecessor
 * unidentifiable and that failure should say why.
 */
export function readAdoptedContainerIds(records, hooks = {}) {
  // Read through a file descriptor, with the bytes confirmed to have come from the file that was
  // stat-ed, and refused if it is not owned by the caller. An lstat followed by a separate read by PATH
  // is not a trust boundary: the file can be replaced in between, and a file another account can write
  // needs no race at all. This is the same shape the adoption tool uses to read its own records, which
  // an earlier version of this claimed to match and did not.
  // The filesystem is injectable so the time-of-check guard below can be exercised. Without that, an
  // implementation that reads by PATH after stat-ing is indistinguishable from one that reads the
  // descriptor it stat-ed, because the difference only shows when a file is swapped mid-read.
  const io = hooks.fs ?? fs;
  const read = hooks.readAdoptionRecord ?? ((file) => {
    const resolved = path.resolve(file);
    const before = io.lstatSync(resolved);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("adoption record is not a regular file");
    const handle = io.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const opened = io.fstatSync(handle);
      if (before.dev !== opened.dev || before.ino !== opened.ino) throw new Error("adoption record changed while being read");
      const uid = hooks.uid ?? process.getuid?.();
      if (uid !== undefined && opened.uid !== uid) throw new Error("adoption record is not owned by this user");
      return JSON.parse(io.readFileSync(handle, "utf8"));
    } finally {
      io.closeSync(handle);
    }
  });
  const ids = new Set();
  for (const file of records ?? []) {
    const record = read(file);
    if (record?.schemaVersion !== "opsworkbench-container-adoption-v3" || !/^[a-f0-9]{64}$/.test(record?.containerId ?? "")) throw new Error(`adoption record is missing or malformed: ${file}`);
    ids.add(record.containerId);
  }
  return ids;
}

function defaultAllContainers() {
  const ids = execFileSync("docker", ["ps", "--all", "--quiet"], { encoding: "utf8" }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!ids.length) return [];
  return JSON.parse(execFileSync("docker", ["inspect", ...ids], { encoding: "utf8" }));
}

function defaultRunningContainers() {
  const ids = execFileSync("docker", ["ps", "--quiet"], { encoding: "utf8" }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!ids.length) return [];
  return JSON.parse(execFileSync("docker", ["inspect", ...ids], { encoding: "utf8" }));
}

const compatibilityScenarios = ["forward_compatibility", "rollback_compatibility", "migration_boundaries", "old_app_new_schema", "new_app_old_schema", "interrupted_migration", "failed_deployment_after_migration", "rollback_after_partial_switch", "service_restart_during_transition", "predecessor_artifacts_retained", "rollback_immutable_images", "rollback_target_independently_verified"];
const migrationScenarios = new Set(["migration_boundaries", "old_app_new_schema", "new_app_old_schema", "interrupted_migration", "failed_deployment_after_migration"]);

function verifyOneForgeBuild(file, expectedSha256, identity, images, hooks = {}, attestation = {}) {
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
  (hooks.verifyAttestation ?? verifyAttestation)(path.dirname(file), [path.basename(file)], { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-images.yml", sourceDigest: identity.commit, sourceRef: `refs/tags/${identity.tag}`, ...attestation });
  // The IMAGE attestations need the same treatment as the file ones, or a host with no GitHub
  // credential still cannot deploy: four of these run on every deployment, and each was an API call.
  // The subject of an image attestation is the digest the reference already pins, so the bundle is
  // addressed the same way here as everywhere else.
  // `runGh` is injectable SEPARATELY from `verifyImageAttestation`, so a test can drive the real
  // argument building — including the bundle lookup — and stub only the process spawn. Stubbing
  // `verifyImageAttestation` is stubbing the code under test, which is how a previous round shipped a
  // production path that could not run at all outside its own tests.
  const runGh = hooks.runGh ?? ((args) => execFileSync("gh", args, { stdio: "pipe" }));
  const verifyImageAttestation = hooks.verifyImageAttestation ?? ((reference) => {
    const args = ["attestation", "verify", `oci://${reference}`, "--repo", "williams342-maker/operation", "--signer-workflow", "williams342-maker/operation/.github/workflows/control-center-images.yml", "--source-digest", identity.commit, "--source-ref", `refs/tags/${identity.tag}`];
    if (attestation.bundleDirectory) args.push("--bundle", attestationBundleFor(attestation.bundleDirectory, imageSubjectDigest(reference)));
    runGh(args);
  });
  for (const reference of Object.values(images)) verifyImageAttestation(reference, identity);
  return { sha256: expectedSha256, buildId: document.buildId, images: bound };
}

export function verifyForgeEvidence(plan, hooks = {}) {
  const candidate = verifyOneForgeBuild(plan.forgeEvidence.candidatePath, plan.forgeEvidence.candidateSha256, { tag: plan.tag, commit: plan.commit, tree: plan.tree }, plan.candidateImages, hooks, attestationSource(plan));
  // There is no Forge build document for a host-verified rollback, and the plan is not allowed to name
  // one. Branching only the CALLER would have left this reading `plan.forgeEvidence.rollbackPath`, which
  // is undefined under that mode -- the feature would have been unable to run at all outside the tests.
  if (hostVerified(plan)) return { ok: true, candidate, rollback: null };
  const rollback = verifyOneForgeBuild(plan.forgeEvidence.rollbackPath, plan.forgeEvidence.rollbackSha256, { tag: plan.rollback.tag, commit: plan.rollback.commit, tree: plan.rollback.tree }, plan.rollback.images, hooks, attestationSource(plan));
  return { ok: true, candidate, rollback };
}

export function verifyCompatibilityEvidence(plan, hooks = {}) {
  const file = plan.compatibilityEvidence.path; const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("compatibility evidence is not a regular file");
  const bytes = fs.readFileSync(file);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== plan.compatibilityEvidence.sha256) throw new Error("compatibility evidence digest mismatch");
  const evidence = JSON.parse(bytes.toString("utf8"));
  exactKeys(evidence, ["schemaVersion", "candidateTag", "candidateCommit", "rollbackTag", "rollbackCommit", "mongoTopology", "images", "migrationsPresent", "scenarios"], "compatibility evidence");
  // Under a host-verified rollback the rehearsal cannot name this rollback target -- that release cannot
  // be rebuilt, which is the reason the mode exists -- so only the candidate and the topology are bound.
  // The rehearsal still has to be a real one for a real candidate; what it does not do is speak about
  // the release being replaced, and the rollback-ready record says so.
  const rollbackNamed = hostVerified(plan) || (evidence.rollbackTag === plan.rollback.tag && evidence.rollbackCommit === plan.rollback.commit);
  if (evidence.schemaVersion !== "opsworkbench-schema-rehearsal-v1" || evidence.candidateTag !== plan.tag || evidence.candidateCommit !== plan.commit || !rollbackNamed || evidence.mongoTopology !== "replica-set") throw new Error("compatibility evidence names a different candidate, rollback, or topology");
  exactKeys(evidence.scenarios, compatibilityScenarios, "compatibility scenarios");
  exactKeys(evidence.images, ["candidate", "rollback"], "compatibility images");
  for (const set of ["candidate", "rollback"]) {
    exactKeys(evidence.images[set], ["api", "web", "admin", "gate"], `${set} compatibility images`);
    if (new Set(Object.values(evidence.images[set])).size !== 4 || Object.values(evidence.images[set]).some((id) => typeof id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(id))) throw new Error(`${set} compatibility image identities are invalid`);
  }
  if (new Set([...Object.values(evidence.images.candidate), ...Object.values(evidence.images.rollback)]).size !== 8) throw new Error("candidate and rollback compatibility image identities are not all distinct");
  for (const [name, result] of Object.entries(evidence.scenarios)) {
    if (result !== "passed" && !(result === "not-applicable-no-migrations" && evidence.migrationsPresent === false && migrationScenarios.has(name))) throw new Error(`compatibility scenario did not pass: ${name}`);
  }
  (hooks.verifyAttestation ?? verifyAttestation)(path.dirname(file), [path.basename(file)], { required: true, signerWorkflow: "williams342-maker/operation/.github/workflows/control-center-deployment-rehearsal.yml", sourceDigest: plan.commit, sourceRef: `refs/tags/${plan.tag}`, ...attestationSource(plan) });
  return { ok: true, candidateCommit: evidence.candidateCommit, rollbackCommit: evidence.rollbackCommit, images: evidence.images, sha256: plan.compatibilityEvidence.sha256 };
}

export async function deployPreparedRelease(preparation, hooks = {}) {
  const { plan } = preparation;
  const forge = await (hooks.verifyForge ? hooks.verifyForge(plan) : verifyForgeEvidence(plan, hooks.forge ?? {}));
  if (!forge.ok) throw new Error("exact candidate/rollback Forge evidence is absent");
  const compatibility = await (hooks.verifyCompatibility ? hooks.verifyCompatibility(plan) : verifyCompatibilityEvidence(plan, hooks));
  if (!compatibility?.ok || compatibility.candidateCommit !== plan.commit) throw new Error("exact candidate schema compatibility evidence is absent");
  // The rehearsal cannot cover a host-verified rollback: that release cannot be rebuilt, which is the
  // reason this mode exists. What the rehearsal still proves is that the CANDIDATE rolls back cleanly
  // to a predecessor of its own lineage. It proves nothing about the release actually being replaced,
  // and the rollback-ready record says so rather than leaving the gap to be inferred.
  if (!hostVerified(plan) && compatibility.rollbackCommit !== plan.rollback.commit) throw new Error("exact rollback schema compatibility evidence is absent");
  const imageEvidence = [];
  for (const [role, reference] of Object.entries(plan.candidateImages)) imageEvidence.push({ set: "candidate", role, ...inspectImmutableImage(reference, { commit: plan.commit, ...imageExpectations[role] }, hooks.images) });
  if (!hostVerified(plan)) for (const [role, reference] of Object.entries(plan.rollback.images)) imageEvidence.push({ set: "rollback", role, ...inspectImmutableImage(reference, { commit: plan.rollback.commit, ...imageExpectations[role] }, hooks.images) });
  // The rehearsal intentionally runs before protected publication. It retains the exact immutable local
  // IDs it exercised; publication is separately bound to the same source/tree/roles by Forge and image
  // attestations above. Comparing independent build IDs here would make the gate impossible to satisfy.
  const platformEvidence = await (hooks.verifyPlatformImages ? hooks.verifyPlatformImages(plan.platform) : inspectPlatformImages(plan.platform, hooks.platform ?? {}));
  if (!platformEvidence?.ok || platformEvidence.edgeImage !== plan.platform.edgeImage || platformEvidence.mongoImage !== plan.platform.mongoImage) throw new Error("platform image registry evidence is absent or mismatched");
  reverifyPreparedRelease(preparation, hooks);
  // ORDER MATTERS HERE. Everything in this block only READS -- compose config, the container
  // inventory, the predecessor measurement -- so it runs before the agent snapshot and before the
  // rollback-ready record is written. That is deliberate: under a host-verified rollback the images
  // to go back to are discovered here, and a record written before the discovery would be a durable
  // record that does not name them. A crash after the first container was recreated would then have
  // lost the only mapping back, at exactly the moment it is needed.
  const environmentFor = (images) => ({ ...process.env, OPSWORKBENCH_API_IMAGE: images.api, OPSWORKBENCH_WEB_IMAGE: images.web, OPSWORKBENCH_ADMIN_IMAGE: images.admin, OPSWORKBENCH_REVIEW_GATE_IMAGE: images.reviewGate, OPSWORKBENCH_EDGE_IMAGE: plan.platform.edgeImage, OPSWORKBENCH_MONGO_IMAGE: plan.platform.mongoImage, OPSWORKBENCH_MONGO_VOLUME: plan.platform.mongoVolume });
  const compose = hooks.compose ?? ((args, env, composeFile = preparation.compose) => execFileSync("docker", ["compose", "--project-name", plan.composeProject, "--file", composeFile, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const ready = hooks.readiness ?? (async (url) => { const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) }); return response.ok; });
  const candidateEnv = environmentFor(plan.candidateImages);
  compose(["config", "--quiet"], candidateEnv, preparation.compose);
  // Port ownership, which nothing here has ever checked.
  //
  // Compose adopts a container only by its own project/service labels, so a container started outside
  // Compose is invisible to it: it will not be reused, will not be stopped, and Compose will try to
  // create a second container on the same host binding. Docker refuses the bind, and because one `up`
  // starts several services, the failure lands PART WAY THROUGH -- with earlier services already
  // recreated. The recovery path then issues another `up` that hits the same held port.
  //
  // This target has exactly that: an admin container started with a bare `docker run`, carrying no
  // Compose labels, already holding the admin service's published port. Refusing here costs an aborted
  // deployment. Discovering it at `up` costs a half-applied one.
  //
  // The resolved model is the source of the ports rather than a literal, so a Compose file that changes
  // where it publishes cannot silently escape the check.
  const resolvedModel = JSON.parse(compose(["config", "--format", "json"], candidateEnv, preparation.compose));
  const runningContainers = (hooks.runningContainers ?? defaultRunningContainers)();
  const foreignConflicts = (hooks.detectConflicts ?? detectForeignPortConflicts)(resolvedModel, [...applicationServices, "edge"], plan.composeProject, runningContainers);
  if (foreignConflicts.length) throw new Error(`host ports are held by containers this project does not own: ${foreignConflicts.map((conflict) => `${conflict.endpoint} wanted by ${conflict.service}, held by ${conflict.container}${conflict.project ? ` of project ${conflict.project}` : " (no compose project)"}`).join("; ")}`);

  // The rollback images. Declared by the plan in the normal case; MEASURED from the containers actually
  // serving in the host-verified case, so a plan cannot nominate a rollback target that is not what is
  // running. The measurement happens here, before the first runtime mutation, because afterwards the
  // containers it reads are the ones the deployment has already replaced.
  const rollbackPredecessors = hostVerified(plan)
    ? (hooks.measurePredecessor ?? measurePredecessorImages)(resolvedModel, applicationServices, plan.composeProject, (hooks.allContainers ?? defaultAllContainers)(), (hooks.readAdoptedIds ?? readAdoptedContainerIds)(plan.rollback.adoptionRecords, hooks))
    : null;
  const rollbackImages = rollbackPredecessors
    ? Object.fromEntries(Object.entries(rollbackPredecessors).map(([service, entry]) => [service, entry.image]))
    : plan.rollback.images;
  const rollbackEnv = environmentFor(rollbackImages);
  if (hostVerified(plan)) {
    // A predecessor that is already the candidate means there is nothing to roll back to, and the
    // deployment would be recording itself as its own rollback target.
    //
    // The comparison is between LOCAL IMAGE IDS on both sides. The plan names candidate images by
    // registry reference and the host reports predecessors by content id, and those are different
    // namespaces -- comparing a reference to an id can never be equal, so that check would have been
    // dead code that read like a guard. The candidate ids come from the registry inspection above,
    // which resolved each reference to the id actually present on this host.
    const candidateLocalIds = new Map(imageEvidence.filter((entry) => entry.set === "candidate").map((entry) => [entry.role, entry.localImageId]));
    for (const [role, image] of Object.entries(rollbackImages)) {
      if (candidateLocalIds.get(role) && image === candidateLocalIds.get(role)) throw new Error(`${role} is already running the candidate image; there is nothing to roll back to`);
    }
  }
  // The rollback model is validated HERE, before the first RUNTIME mutation, because the only other
  // moment it is ever loaded is inside the catch below -- while recovering from a failed deployment,
  // which is the worst possible time to discover it does not load. Left unchecked that turns a
  // recoverable failure into "deployment failed and rollback also failed".
  //
  // "Before the first runtime mutation" is the honest claim, not "before anything is mutated": images
  // are already pulled, the agent snapshot is already taken and rollback-ready.json is already written
  // by this point. A failed check here leaves that preparation behind, and the CLI builds a fresh
  // preparation rather than reusing it, because the snapshot and the record are both exclusive.
  //
  // What this actually proves is narrow. Compose parses and validates the WHOLE project before
  // selecting services, so a required `env_file` that does not exist fails the load even for a service
  // that would never be started -- that is the case this catches. It does NOT prove a bind mount's
  // source exists: a short-form bind source that is missing gets created at container-creation time
  // instead, so absent TLS material is a different failure at a different moment.
  //
  // Nor is the validated model frozen. Both this call and the recovery call reload the file, and
  // external inputs it reads can change in between. Release trees are sealed and verified, which rules
  // out ordinary edits to the file itself, but nothing here reserves ports or captures the resolved
  // model.
  //
  // Practical consequence for an attested rollback: the candidate and its rollback must BOTH carry a
  // Compose file this host can load. A rollback release cut before the review gate was removed from the
  // production Compose file does not, and this refuses it up front instead of at the point of no return.
  // Under a host-verified rollback the two files are the same one, so this validates the candidate's
  // model a second time -- with the ROLLBACK image digests interpolated into it, which is the
  // combination the recovery path would actually run and is not otherwise exercised.
  compose(["config", "--quiet"], rollbackEnv, preparation.rollbackCompose);
  const agentScript = path.join(preparation.controlCenter, "scripts", "install-reviewed-agent.sh");
  if (!fs.existsSync(agentScript) || !fs.lstatSync(agentScript).isFile()) throw new Error("version-controlled reviewed agent installer is absent");
  const agentBackup = path.join(preparation.stage, "agent-rollback");
  const agentControl = hooks.agentControl ?? ((args) => execFileSync("bash", [agentScript, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  agentControl(["prepare", preparation.agentExtracted, agentBackup]);
  const priorCurrent = readCurrentRelease(plan.releaseRoot);
  if (priorCurrent.target !== path.resolve(plan.rollback.releaseDirectory)) throw new Error("verified rollback release is not the currently active predecessor");
  const rollbackEvidence = hostVerified(plan)
    ? [{
      role: "rollback-evidence",
      kind: "host-verified",
      // The measurement itself, in the durable record, before anything is mutated. This is what a
      // recovery would be run from if this process did not survive to run it.
      predecessors: rollbackPredecessors,
      // Written down because it is the part a reader would otherwise assume. None of these are
      // failures; they are the price of rolling back to a release that predates the machinery.
      notAttested: "rollback images were built on this host and never pushed; they carry no registry or image attestation",
      notRehearsed: "the schema rehearsal covers the candidate against a rebuildable predecessor, not against this rollback target",
      notItsOwnCompose: "the rollback runs the candidate's compose file, because the rollback release carries none",
    }]
    : [];
  const rollbackReady = establishRollbackBeforeMutation(preparation, [...imageEvidence, ...rollbackEvidence, platformEvidence, { role: "agent", rollbackSnapshot: agentBackup }, { role: "release-pointer", currentLink: priorCurrent.link, rollbackTarget: priorCurrent.target }]);
  // OPSWORKBENCH_REVIEW_GATE_IMAGE is still exported even though the candidate Compose file no longer
  // reads it. It is not dead: the ROLLBACK file comes from the rollback release's own tree, and any
  // release cut before the gate was removed still declares that service with `:?` -- an unset variable
  // there is a hard interpolation failure during recovery. Keep exporting it until no rollback target
  // predates the change.
  // First runtime mutation occurs only after the exclusive, fsynced rollback-ready record above.
  let agentActivationAttempted = false; let currentSwitched = false; let record;
  try {
    compose(["up", "-d", "--no-build", "--no-deps", "--force-recreate", "--wait", ...applicationServices], candidateEnv, preparation.compose);
    compose(["up", "-d", "--no-build", "--no-deps", "--force-recreate", "--wait", "edge"], candidateEnv, preparation.compose);
    agentActivationAttempted = true;
    agentControl(["activate", preparation.agentExtracted, plan.tag, plan.commit, agentBackup]);
    for (let pass = 0; pass < (hooks.acceptancePasses ?? 3); pass += 1) {
      for (const url of plan.readiness) if (!await ready(url)) throw new Error(`readiness refused: ${url}`);
      if (hooks.wait) await hooks.wait();
    }
    (hooks.switchCurrent ?? switchCurrentRelease)(priorCurrent, preparation.installedControlCenter); currentSwitched = true;
    record = { ...rollbackReady.record, runtimeMutationAuthorized: true, deployedAt: new Date().toISOString(), acceptancePasses: hooks.acceptancePasses ?? 3 };
    (hooks.writeDeploymentRecord ?? ((file, body) => fs.writeFileSync(file, body, { flag: "wx", mode: 0o400 })))(path.join(preparation.stage, "deployed.json"), `${JSON.stringify(record, null, 2)}\n`);
  } catch (cause) {
    if (currentSwitched) {
      try { (hooks.switchCurrent ?? switchCurrentRelease)(priorCurrent, priorCurrent.target); } catch (pointerCause) { throw new AggregateError([cause, pointerCause], `deployment failed and current release pointer rollback also failed: ${cause.message}; ${pointerCause.message}`, { cause: pointerCause }); }
    }
    if (agentActivationAttempted) {
      try { agentControl(["rollback", agentBackup]); } catch (agentCause) { throw new AggregateError([cause, agentCause], `deployment failed and agent rollback also failed: ${cause.message}; ${agentCause.message}`, { cause: agentCause }); }
    }
    compose(["up", "-d", "--no-build", "--no-deps", "--force-recreate", "--wait", ...applicationServices, "edge"], rollbackEnv, preparation.rollbackCompose);
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
  const forgeLocations = [["candidate Forge evidence", plan.forgeEvidence.candidatePath]];
  // Only when the plan has one. path.resolve(undefined) throws, so an unconditional entry here made
  // every host-verified plan fail in the CLI before preparation began.
  if (!hostVerified(plan)) forgeLocations.push(["rollback Forge evidence", plan.forgeEvidence.rollbackPath]);
  // Adoption records are checked alongside the rest. They decide WHICH CONTAINER becomes the rollback
  // image, which is authority of the same kind as the evidence files, and leaving them out made a
  // trusted plan able to delegate that choice to a file in an unprotected location.
  const adoptionLocations = (plan.rollback.adoptionRecords ?? []).map((record, index) => [`adoption record ${index + 1}`, record]);
  for (const [name, location] of [...forgeLocations, ...adoptionLocations, ["compatibility evidence", plan.compatibilityEvidence.path]]) {
    const resolved = path.resolve(location); if (!resolved.startsWith(`${inbox}${path.sep}`)) throw new Error(`${name} is outside the fixed trusted inbox`);
    assertRootOwnedPathChain(resolved);
  }
  // Defence in depth, and deliberately not the thing that makes bundles safe. A substituted bundle
  // cannot produce a false pass — it has to carry a Sigstore signature over THIS subject digest from
  // THIS workflow at THIS commit, and gh refuses it otherwise. What the trusted location buys is that
  // only root can cause the refusal, so a deployment cannot be denied by an unprivileged writer.
  if (plan.attestationBundles) {
    const resolved = path.resolve(plan.attestationBundles);
    if (!resolved.startsWith(`${inbox}${path.sep}`)) throw new Error("attestation bundles are outside the fixed trusted inbox");
    assertRootOwnedPathChain(resolved, { directory: true });
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
