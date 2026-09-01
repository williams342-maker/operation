import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTrustedRootFile, verifyForgeBuildAttestation } from "../src/forgeAttestation.js";

// Real Sigstore material, not fixtures I invented.
//
// `release-bundle.json` is the genuine build-provenance bundle GitHub produced for the published
// v0.1.2-operate release, downloaded with `gh attestation download`. `attested-manifest.json` is one of
// the documents that bundle actually signs. `trusted-root.json` is the real Sigstore trusted root from
// `gh attestation trusted-root`.
//
// This matters: the previous design accepted a JSON file saying `verified: true`, so it could be — and
// was — "tested" entirely against material the test itself made up. Verification you can fake in a test
// is verification an operator can fake in production.

const fixtures = path.join(import.meta.dirname, "fixtures", "sigstore");
const trustedRootPath = path.join(fixtures, "trusted-root.json");
const bundlePath = path.join(fixtures, "release-bundle.json");
const documentPath = path.join(fixtures, "attested-manifest.json");

const REAL_BUILDER = "https://github.com/williams342-maker/operation/.github/workflows/control-center-release.yml@refs/tags/v0.1.2-operate";
const REAL_COMMIT = "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b";
const expectation = { builderIdentity: REAL_BUILDER, runnerEnvironment: "github-hosted", sourceCommit: REAL_COMMIT };

const trustMaterial = () => loadTrustedRootFile(trustedRootPath);
const document = () => fs.readFileSync(documentPath);
const verify = (over: Partial<Parameters<typeof verifyForgeBuildAttestation>[0]> = {}) =>
  verifyForgeBuildAttestation({ bundlePath, trustMaterial: trustMaterial(), documentBytes: document(), expectation, ...over });

test("a genuine Sigstore bundle over a genuine document verifies", () => {
  const outcome = verify();
  assert.equal(outcome.ok, true, `expected success, got ${JSON.stringify(outcome)}`);
  if (!outcome.ok) return;
  // Every fact is derived from the signed statement, not from anything an operator supplied.
  assert.equal(outcome.facts.builderIdentity, REAL_BUILDER);
  assert.equal(outcome.facts.runnerEnvironment, "github-hosted");
  assert.equal(outcome.facts.sourceCommit, REAL_COMMIT);
  assert.equal(outcome.facts.documentSha256, "c0eb41b86381496130580dc5713376dc857d1f407e137e30a20c5184a023603d");
  assert.match(outcome.facts.subjectName, /manifest\.json$/);
});

test("THE TRAP: a document the bundle does not cover is rejected", () => {
  // `Verifier.verify()` alone does NOT catch this. Confirmed against this exact real bundle on
  // 2026-09-01: passing corrupted artifact bytes to toSignedEntity(bundle, artifact) still returned
  // success, because a DSSE bundle signs the STATEMENT, not whatever you happen to hold.
  // subjectCoversDocument() is the only thing standing between "signed" and "signed THIS".
  const outcome = verify({ documentBytes: Buffer.concat([document(), Buffer.from("x")]) });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, "attestation-subject-mismatch");
});

test("an unrelated document is rejected even though the bundle is genuine", () => {
  const outcome = verify({ documentBytes: Buffer.from(JSON.stringify({ schemaVersion: "forge-build-v1", buildId: "fake" })) });
  assert.equal(outcome.ok, false);
});

test("a bundle from another workflow identity is rejected", () => {
  const outcome = verify({ expectation: { ...expectation, builderIdentity: "https://github.com/attacker/repo/.github/workflows/x.yml@refs/heads/main" } });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, "attestation-invalid");
});

test("a runner-environment or source-commit claim the attestation contradicts is rejected", () => {
  const runner = verify({ expectation: { ...expectation, runnerEnvironment: "self-hosted" } });
  assert.equal(runner.ok, false);
  if (!runner.ok) assert.equal(runner.reason, "builder-runner-mismatch");

  const commit = verify({ expectation: { ...expectation, sourceCommit: "0".repeat(40) } });
  assert.equal(commit.ok, false);
  if (!commit.ok) assert.equal(commit.reason, "source-commit-mismatch");
});

test("an empty trusted root rejects a genuine bundle — trust must come from the pinned root", () => {
  const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "forge-trust-")), "empty-root.json");
  fs.writeFileSync(empty, JSON.stringify({ mediaType: "application/vnd.dev.sigstore.trustedroot+json;version=0.1", certificateAuthorities: [], tlogs: [], ctlogs: [], timestampAuthorities: [] }));
  const outcome = verify({ trustMaterial: loadTrustedRootFile(empty) });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, "attestation-invalid");
});

test("a tampered bundle is rejected", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-bundle-"));
  const raw = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const inner = raw.bundle ?? raw;
  // Flip one byte of the DSSE payload; the signature no longer covers it.
  const payload = Buffer.from(inner.dsseEnvelope.payload, "base64");
  payload[10] = payload[10] ^ 0xff;
  inner.dsseEnvelope.payload = payload.toString("base64");
  const tampered = path.join(dir, "tampered.json");
  fs.writeFileSync(tampered, JSON.stringify(raw));
  const outcome = verify({ bundlePath: tampered });
  assert.equal(outcome.ok, false);
});

test("a malformed or missing bundle is rejected rather than throwing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-bad-"));
  const notJson = path.join(dir, "not.json");
  fs.writeFileSync(notJson, "this is not json");
  assert.equal(verify({ bundlePath: notJson }).ok, false);

  const emptyObject = path.join(dir, "empty.json");
  fs.writeFileSync(emptyObject, "{}");
  assert.equal(verify({ bundlePath: emptyObject }).ok, false);
});

test("REGRESSION (round 2): a SAN that merely regex-matches the builder is rejected", () => {
  // @sigstore/verify matches a STRING policy with `signerIdentity.match(policy)` — unanchored regex.
  // A builder URL is full of metacharacters, so a plain string policy is weaker than it reads. The
  // expectation is now anchored and escaped, AND the returned identity is re-compared exactly.
  // A prefix of the real identity would match an unanchored pattern; it must not match ours.
  const prefix = REAL_BUILDER.slice(0, REAL_BUILDER.indexOf("@"));
  assert.equal(verify({ expectation: { ...expectation, builderIdentity: prefix } }).ok, false);
  // `.` as a wildcard: replacing a literal dot must not still match.
  const wildcarded = REAL_BUILDER.replace("control-center-release.yml", "control-center-releaseXyml");
  assert.equal(verify({ expectation: { ...expectation, builderIdentity: wildcarded } }).ok, false);
});

test("REGRESSION (round 2): a non-hex digest is a rejection, not a crash", () => {
  // Comparing JS string length is not comparing byte length. A multibyte digest of equal character
  // count made timingSafeEqual throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH, turning a verification
  // decision into an unhandled denial. Shape is validated before the comparison now.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-digest-"));
  const raw = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const inner = raw.bundle ?? raw;
  const statement = JSON.parse(Buffer.from(inner.dsseEnvelope.payload, "base64").toString("utf8"));
  statement.subject = [{ name: "crafted", digest: { sha256: "é".repeat(64) } }];
  inner.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString("base64");
  const crafted = path.join(dir, "crafted.json");
  fs.writeFileSync(crafted, JSON.stringify(raw));
  // Must return a decision. The signature no longer covers the edited payload, so it fails earlier —
  // the point is that nothing throws out of the verifier.
  const outcome = verify({ bundlePath: crafted });
  assert.equal(outcome.ok, false);
});

test("REGRESSION (round 2): a pretty-printed trusted root is readable", () => {
  // readJsonDocument previously parsed only the first line, so any pretty-printed JSON failed —
  // including a hand-provisioned trusted root, the file most likely to be pretty-printed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-pretty-"));
  const pretty = path.join(dir, "pretty-root.json");
  fs.writeFileSync(pretty, JSON.stringify(JSON.parse(fs.readFileSync(trustedRootPath, "utf8")), null, 2));
  const outcome = verifyForgeBuildAttestation({ bundlePath, trustMaterial: loadTrustedRootFile(pretty), documentBytes: document(), expectation });
  assert.equal(outcome.ok, true, "a pretty-printed trusted root must work");
});
