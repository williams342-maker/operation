import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attestationBundleFor,
  attestationBundleNames,
  verifyAttestation,
  verifyReleaseBundle,
  parseSha256Sums,
  sha256Hex,
} from "../../scripts/verify-release-bundle.mjs";

// Build a minimal, self-consistent release-output/ directory in a temp dir.
// `omitAgent` reproduces the shape of a release from before the agent artifact existed: no
// `agentArtifact` key in the manifest and no agent entry in SHA256SUMS. The live release on the
// production host is exactly this, and it is the only rollback target a first deployment can have.
function makeBundle({ tag = "v1.2.3-rc1", commit = "a".repeat(40), tamper = null, schema = "opsworkbench-release-v1", omitAgent = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relbundle-"));
  const version = tag.slice(1);
  const artifact = `opsworkbench-control-center-${version}.tar.gz`;
  const agentArtifact = `opsworkbench-control-center-${version}-agent-linux-x64.tar.gz`;
  const manifestName = `opsworkbench-control-center-${version}.manifest.json`;
  const tarballBytes = Buffer.from("fake-deterministic-tarball-bytes");
  const agentBytes = Buffer.from("fake-agent-bundle");
  const manifest = { schemaVersion: schema, tag, commit, artifact, source: "test", reproducible: true };
  if (!omitAgent) manifest.agentArtifact = agentArtifact;
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, artifact), tarballBytes);
  if (!omitAgent) fs.writeFileSync(path.join(dir, agentArtifact), agentBytes);
  fs.writeFileSync(path.join(dir, manifestName), manifestBytes);
  const sums =
    `${sha256Hex(tarballBytes)}  ${artifact}\n` +
    (omitAgent ? "" : `${sha256Hex(agentBytes)}  ${agentArtifact}\n`) +
    `${sha256Hex(manifestBytes)}  ${manifestName}\n`;
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), sums);
  if (tamper === "tarball") fs.writeFileSync(path.join(dir, artifact), Buffer.from("MUTATED"));
  if (tamper === "remove-manifest") fs.rmSync(path.join(dir, manifestName));
  if (tamper === "remove-sums") fs.rmSync(path.join(dir, "SHA256SUMS"));
  return { dir, tag, commit, artifact, manifestName };
}

test("the agent artifact is required by default, optional for a rollback, and checked whenever declared", () => {
  // A release from before the agent artifact existed. Required by default, so a malformed modern
  // bundle is still caught; optional when the caller asks, which is the only way a first deployment
  // can roll back to the release it is replacing.
  const { dir, tag } = makeBundle({ tag: "v0.1.2-operate", omitAgent: true });
  const required = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(required.ok, false, "required by default");
  assert.match(required.problems.join(" "), /agentArtifact/);
  assert.equal(verifyReleaseBundle(dir, { expectedTag: tag, requireAgentArtifact: false }).ok, true, "and accepted when it is not required");

  // A DECLARED agent artifact is still checked even when one is not required. Without this, the option
  // would let a bundle name an artifact that nothing verifies -- worse than requiring it outright.
  const { dir: declared, tag: declaredTag } = makeBundle({ tag: "v0.1.2-operate" });
  const manifestPath = path.join(declared, fs.readdirSync(declared).find((name) => name.endsWith(".manifest.json")));
  const agentName = JSON.parse(fs.readFileSync(manifestPath, "utf8")).agentArtifact;
  const trimmed = fs.readFileSync(path.join(declared, "SHA256SUMS"), "utf8").split(/\r?\n/).filter(Boolean).filter((line) => !line.endsWith(agentName));
  fs.writeFileSync(path.join(declared, "SHA256SUMS"), `${trimmed.join("\n")}\n`);
  const stillChecked = verifyReleaseBundle(declared, { expectedTag: declaredTag, requireAgentArtifact: false });
  assert.equal(stillChecked.ok, false, "declared but uncovered is still a problem");
  assert.match(stillChecked.problems.join(" "), /agentArtifact/);

  // And the artifact itself is never optional, in either mode.
  const { dir: noArtifact, tag: noArtifactTag } = makeBundle({ omitAgent: true });
  const noArtifactManifest = path.join(noArtifact, fs.readdirSync(noArtifact).find((name) => name.endsWith(".manifest.json")));
  const parsed = JSON.parse(fs.readFileSync(noArtifactManifest, "utf8"));
  delete parsed.artifact;
  fs.writeFileSync(noArtifactManifest, `${JSON.stringify(parsed, null, 2)}\n`);
  assert.equal(verifyReleaseBundle(noArtifact, { expectedTag: noArtifactTag, requireAgentArtifact: false }).ok, false);
});

test("parseSha256Sums parses valid lines and flags malformed ones", () => {
  const parsed = parseSha256Sums(`${"a".repeat(64)}  file.tar.gz\nnot-a-checksum line\n`);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { hash: "a".repeat(64), name: "file.tar.gz" });
  assert.equal(parsed[1], null);
});

test("SHA256SUMS names cannot escape or create subdirectories", () => {
  for (const name of ["../outside", "sub/file", "sub\\file", ".", "-option"]) assert.equal(parseSha256Sums(`${"a".repeat(64)}  ${name}\n`)[0], null);
});

test("a well-formed bundle verifies ok", () => {
  const { dir, tag } = makeBundle();
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.problems.length, 0);
  assert.equal(result.manifest.tag, tag);
});

test("a tampered artifact is rejected with a checksum mismatch", () => {
  const { dir, tag, artifact } = makeBundle({ tamper: "tarball" });
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("checksum mismatch") && p.includes(artifact)));
});

test("a mismatched expected tag is rejected", () => {
  const { dir } = makeBundle({ tag: "v2.0.0-rc1" });
  const result = verifyReleaseBundle(dir, { expectedTag: "v9.9.9-rc1" });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("manifest tag") && p.includes("v9.9.9-rc1")));
});

test("a bad manifest schemaVersion is rejected", () => {
  const { dir, tag } = makeBundle({ schema: "something-else" });
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("schemaVersion")));
});

test("a non-40-char commit is rejected", () => {
  const { dir, tag } = makeBundle({ commit: "16e14682" });
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("40-char SHA")));
});

test("a manifest without the main artifact is rejected as a verification result", () => {
  const { dir, tag, manifestName } = makeBundle(); const manifestPath = path.join(dir, manifestName); const manifest = JSON.parse(fs.readFileSync(manifestPath)); delete manifest.artifact;
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`); fs.writeFileSync(manifestPath, bytes);
  const lines = fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8").trim().split("\n"); lines[2] = `${sha256Hex(bytes)}  ${manifestName}`; fs.writeFileSync(path.join(dir, "SHA256SUMS"), `${lines.join("\n")}\n`);
  const result = verifyReleaseBundle(dir, { expectedTag: tag }); assert.equal(result.ok, false); assert.ok(result.problems.some((problem) => problem.includes("manifest artifact")));
});

test("a missing manifest is rejected", () => {
  const { dir, tag } = makeBundle({ tamper: "remove-manifest" });
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("missing") || p.includes("manifest")));
});

test("a missing SHA256SUMS is rejected without throwing", () => {
  const { dir } = makeBundle({ tamper: "remove-sums" });
  const result = verifyReleaseBundle(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("SHA256SUMS")));
});

// --- Attestation bundles -------------------------------------------------------------------------
//
// These exist so a host can verify provenance with no GitHub credential on it. Every one of them
// asserts the ARGUMENTS the CLI is given, because the return value is identical whether a bundle was
// used or not: asserting "it returned" would pass with the whole feature deleted.

function attestationFixture({ withBundle = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attbundle-"));
  const bundles = fs.mkdtempSync(path.join(os.tmpdir(), "attbundles-"));
  const bytes = Buffer.from("subject-bytes");
  fs.writeFileSync(path.join(dir, "subject.tar.gz"), bytes);
  const digest = sha256Hex(bytes);
  if (withBundle) fs.writeFileSync(path.join(bundles, `sha256-${digest}.jsonl`), "{}\n");
  const calls = [];
  const hooks = { ghAvailable: () => true, run: (args) => calls.push(args) };
  return { dir, bundles, digest, calls, hooks };
}

test("a bundle is chosen by the subject's own digest, not by a name the caller supplies", () => {
  const { dir, bundles, digest, calls, hooks } = attestationFixture();
  const result = verifyAttestation(dir, ["subject.tar.gz"], { required: true, bundleDirectory: bundles, hooks });
  assert.equal(result.offline, true);
  assert.equal(calls.length, 1);
  const index = calls[0].indexOf("--bundle");
  assert.ok(index > 0, "the CLI was not given a bundle");
  assert.equal(calls[0][index + 1], path.join(bundles, `sha256-${digest}.jsonl`));
});

test("an absent bundle refuses, and does not silently fall back to the API", () => {
  const { dir, bundles, calls, hooks } = attestationFixture({ withBundle: false });
  assert.throws(() => verifyAttestation(dir, ["subject.tar.gz"], { required: true, bundleDirectory: bundles, hooks }), /no attestation bundle/);
  assert.equal(calls.length, 0, "the CLI ran anyway, which is the fall back this refuses");
});

test("without a bundle directory the command is exactly what it was before", () => {
  const { dir, calls, hooks } = attestationFixture();
  const result = verifyAttestation(dir, ["subject.tar.gz"], { required: true, hooks });
  assert.equal(result.offline, false);
  assert.equal(calls[0].includes("--bundle"), false);
});

test("a missing gh CLI is a refusal when bundles were requested, not a skip", () => {
  const { dir, bundles } = attestationFixture();
  const hooks = { ghAvailable: () => false, run: () => assert.fail("the CLI cannot run when it is absent") };
  // `required` is deliberately false: bundles remove the need for a credential, not for the CLI that
  // checks the signature, so this must refuse on its own rather than inheriting `required`.
  assert.throws(() => verifyAttestation(dir, ["subject.tar.gz"], { bundleDirectory: bundles, hooks }), /gh CLI is unavailable/);
});

test("attestationBundleFor refuses a digest that is not a sha256", () => {
  const { bundles } = attestationFixture();
  assert.throws(() => attestationBundleFor(bundles, "not-a-digest"), /subject digest is invalid/);
  assert.throws(() => attestationBundleFor(bundles, `${"a".repeat(63)}z`), /subject digest is invalid/);
});

test("a bundle that is not a regular file is refused", () => {
  // The directory case runs everywhere, including on a Windows checkout where creating a symlink needs
  // a privilege the test process does not have. Without it the whole "is this a regular file" check
  // could be deleted and every test on this machine would still pass.
  const { bundles, digest } = attestationFixture();
  const link = path.join(bundles, `sha256-${digest}.jsonl`);
  fs.unlinkSync(link);
  fs.mkdirSync(link);
  assert.throws(() => attestationBundleFor(bundles, digest), /is not a regular file/);
});

test("a bundle that is a symlink is refused", (t) => {
  const { bundles, digest } = attestationFixture();
  const target = path.join(bundles, "elsewhere.jsonl");
  fs.writeFileSync(target, "{}\n");
  const link = path.join(bundles, `sha256-${digest}.jsonl`);
  fs.unlinkSync(link);
  try {
    fs.symlinkSync(target, link);
  } catch {
    // Windows refuses symlink creation without the privilege. Skipping keeps the suite honest on this
    // machine rather than passing a test that never ran its assertion.
    t.skip("this platform does not allow creating a symlink");
    return;
  }
  assert.throws(() => attestationBundleFor(bundles, digest), /is not a regular file/);
});

test("both of gh's bundle names are accepted, because the producer and the consumer are different platforms", () => {
  // `gh attestation download` writes `sha256:<digest>.jsonl`, except on Windows where a colon is not a
  // legal filename character and it writes `sha256-<digest>.jsonl`. Bundles are produced where a
  // credential exists and consumed where none does, so those are routinely different machines. The name
  // list is asserted separately from the filesystem because Windows cannot create the colon form at all.
  const digest = "a".repeat(64);
  assert.deepEqual(attestationBundleNames(digest), [`sha256:${digest}.jsonl`, `sha256-${digest}.jsonl`]);
  assert.throws(() => attestationBundleNames("nope"), /subject digest is invalid/);
});

test("a bundle written under gh's native name is found", (t) => {
  const { bundles, digest } = attestationFixture();
  fs.unlinkSync(path.join(bundles, `sha256-${digest}.jsonl`));
  const native = path.join(bundles, `sha256:${digest}.jsonl`);
  try {
    fs.writeFileSync(native, "{}\n");
    // Windows accepts this write as an alternate data stream on the directory rather than a file, so a
    // pass here would prove nothing about the file being found by name.
    if (!fs.existsSync(native)) throw new Error("not a real file on this platform");
  } catch {
    t.skip("this platform cannot create a file whose name contains a colon");
    return;
  }
  assert.equal(attestationBundleFor(bundles, digest), native);
});
