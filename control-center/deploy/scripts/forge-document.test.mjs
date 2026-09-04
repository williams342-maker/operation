import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildForgeDocument } from "../../scripts/build-forge-document.mjs";
import { forgeBuildManifestSchema, forgeBuildDigest } from "../../packages/shared/dist/index.js";

// The producer is validated against the REAL schema, not against a second copy of its rules. A
// generator checked by its own restatement of the spec is a generator that drifts silently.

const env = () => ({
  FORGE_BUILD_ID: "forge-build-1234567890-1",
  FORGE_SOURCE_REPOSITORY: "https://github.com/williams342-maker/operation",
  FORGE_SOURCE_COMMIT: "4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b",
  FORGE_SOURCE_TREE: "322b1275e498aa0d4c0c1cbb0a2f2ab5f4e6d7c8",
  FORGE_SOURCE_TAG: "v0.1.2-operate",
  FORGE_BACKEND_IMAGE_DIGEST: `ghcr.io/williams342-maker/operation/control-center-api@sha256:${"a".repeat(64)}`,
  FORGE_FRONTEND_IMAGE_DIGEST: `ghcr.io/williams342-maker/operation/control-center-web@sha256:${"b".repeat(64)}`,
  FORGE_BUILDER_IDENTITY: "https://github.com/williams342-maker/operation/.github/workflows/control-center-images.yml@refs/tags/v0.1.2-operate",
  FORGE_BUILDER_RUNNER_ENVIRONMENT: "github-hosted",
  FORGE_ISSUED_AT: "2026-09-01T12:00:00Z"
});

test("the produced document parses against the real forge-build-v1 schema", () => {
  const parsed = forgeBuildManifestSchema.safeParse(JSON.parse(buildForgeDocument(env())));
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  // And it is digestible, which is the operation the owner authorization ultimately binds to.
  assert.match(forgeBuildDigest(parsed.data), /^[a-f0-9]{64}$/);
});

test("the document is byte-stable, because its sha256 is the attestation subject", () => {
  // The verifier hashes exactly the bytes it reads and compares against the signed subject. If the
  // producer were not deterministic for identical inputs, a re-run would silently stop verifying.
  assert.equal(buildForgeDocument(env()), buildForgeDocument(env()));
});

test("an optional field that is absent stays absent rather than becoming empty", () => {
  const withoutTag = env();
  delete withoutTag.FORGE_SOURCE_TAG;
  const document = JSON.parse(buildForgeDocument(withoutTag));
  assert.equal("sourceTag" in document, false);
  assert.equal(forgeBuildManifestSchema.safeParse(document).success, true);
  // An empty optional would be a different document with a different digest, so it must not appear.
  assert.notEqual(buildForgeDocument(withoutTag), buildForgeDocument(env()));
});

test("a missing required input is an error, never a default", () => {
  // A provenance document that quietly fills in a blank is worse than no document.
  for (const key of ["FORGE_SOURCE_COMMIT", "FORGE_SOURCE_TREE", "FORGE_BACKEND_IMAGE_DIGEST", "FORGE_BUILDER_IDENTITY", "FORGE_ISSUED_AT"]) {
    const broken = env();
    delete broken[key];
    assert.throws(() => buildForgeDocument(broken), new RegExp(key), `${key} must be required`);
  }
});

test("a mutable image tag is refused — only digest-pinned references are produced", () => {
  const tagged = { ...env(), FORGE_BACKEND_IMAGE_DIGEST: "ghcr.io/williams342-maker/operation/control-center-api:v0.1.2-operate" };
  assert.throws(() => buildForgeDocument(tagged), /Malformed build provenance input/);
});

test("malformed commit, tree, identity or timestamp are refused", () => {
  for (const [key, value] of [
    ["FORGE_SOURCE_COMMIT", "not-a-commit"],
    ["FORGE_SOURCE_TREE", "0".repeat(39)],
    ["FORGE_BUILDER_IDENTITY", "http://insecure.example.com/x"],
    ["FORGE_BUILDER_RUNNER_ENVIRONMENT", "Self-Hosted"],
    ["FORGE_ISSUED_AT", "yesterday"],
    ["FORGE_SOURCE_TAG", "0.1.2-no-v-prefix"]
  ]) {
    assert.throws(() => buildForgeDocument({ ...env(), [key]: value }), /Malformed build provenance input/, `${key}=${value} must be refused`);
  }
});

test("identical backend and frontend images are refused", () => {
  const same = env();
  same.FORGE_FRONTEND_IMAGE_DIGEST = same.FORGE_BACKEND_IMAGE_DIGEST;
  assert.throws(() => buildForgeDocument(same), /identical/);
});

test("the builder identity the document claims is the one an attestation can prove", () => {
  // The document's builderIdentity must be the workflow's own OIDC identity, because the verifier
  // compares it against the certificate SAN. A document naming a different workflow is unverifiable by
  // construction — which is the correct outcome, but it should be produced correctly in the first place.
  const document = JSON.parse(buildForgeDocument(env()));
  assert.match(document.builderIdentity, /^https:\/\/github\.com\/[^/]+\/[^/]+\/\.github\/workflows\/[^@]+@refs\//);
});

// ── the producer's own dispatch contract ────────────────────────────────────────────────────────────

const producerWorkflow = () => fs.readFileSync(
  path.join(import.meta.dirname, "..", "..", "..", ".github", "workflows", "control-center-images.yml"),
  "utf8",
);

test("REGRESSION: the producer refuses to run unless the dispatch ref IS the tag", () => {
  // WHY THIS GUARD EXISTS. `actions/attest-build-provenance` derives its SLSA predicate from the GitHub
  // context, where `resolvedDependencies[].digest.gitCommit` is `github.sha` -- the commit of the ref the
  // run was DISPATCHED from. `actions/checkout` with `ref: <tag>` changes the working tree and nothing
  // else. Dispatching from `main` with a tag input therefore produced a document recording the TAG's
  // commit beside an attestation recording MAIN's, and every agent refused the pair with
  // `source-commit-mismatch`. That is why the producer had never completed a real run.
  //
  // The predicate cannot be told to record the checkout, so the run must BE the tag. Asserted here so
  // the guard cannot be removed while the two mismatching sources stay in place.
  //
  // This is an assertion over the workflow YAML, which is the honest limit: it proves the file declares
  // the check, not that a runner executed it.
  const workflow = producerWorkflow();
  assert.match(workflow, /GITHUB_SHA/,
    "the producer must compare the dispatch commit against the tag's commit");
  assert.match(workflow, /source-commit-mismatch/,
    "the guard must name the failure it prevents, so the next reader does not have to re-derive it");
  assert.match(workflow, /--ref \$tag/,
    "the refusal must tell the operator how to dispatch correctly");
});

test("the document's source commit comes from the TAG, which is the half the guard makes provable", () => {
  // The two halves of the fix, asserted together so they cannot drift apart:
  //   document side  -- FORGE_SOURCE_COMMIT is the tag's commit, resolved by the `source` step;
  //   attestation side -- the guard forces the dispatch ref to be that same commit.
  // Either alone is useless. The document has always used the tag; what was missing was anything making
  // the attestation able to agree with it.
  const workflow = producerWorkflow();
  assert.match(workflow, /FORGE_SOURCE_COMMIT: \$\{\{ steps\.source\.outputs\.commit \}\}/,
    "the document must record the tag's commit, resolved by the source step");
  assert.match(workflow, /commit="\$\(git rev-parse "\$\{tag\}\^\{commit\}"\)"/,
    "and that commit must be the annotated tag's, not HEAD's by coincidence");
});
