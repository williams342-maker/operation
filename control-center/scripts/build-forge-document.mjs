#!/usr/bin/env node
// Produces a `forge-build-v1` document — see docs/forge-manifest-spec.md §5.2.
//
// THIS IS THE MISSING PRODUCER. Two rounds of independent review found that the images workflow
// attested OCI image digests while the preflight verifier requires a bundle whose signed in-toto
// subject covers the exact bytes of a forge-build-v1 JSON document. Nothing created that document, so
// the legitimate path could not work and only a forged one could. This closes that half.
//
// It runs in CI with no dependencies so the images workflow needs no npm install. The real zod schema
// is not imported here; instead the test suite parses this script's output with
// `forgeBuildManifestSchema`, so the document is validated against the actual schema rather than
// against a second copy of its rules that could drift.
//
// Every value comes from the build environment. Nothing is defaulted or invented: a missing input is an
// error, because a provenance document that quietly fills in a blank is worse than no document.

import fs from "node:fs";

const REQUIRED = [
  "FORGE_BUILD_ID",
  "FORGE_SOURCE_REPOSITORY",
  "FORGE_SOURCE_COMMIT",
  "FORGE_SOURCE_TREE",
  "FORGE_BACKEND_IMAGE_DIGEST",
  "FORGE_FRONTEND_IMAGE_DIGEST",
  "FORGE_BUILDER_IDENTITY",
  "FORGE_BUILDER_RUNNER_ENVIRONMENT",
  "FORGE_ISSUED_AT"
];

const SHAPES = {
  FORGE_BUILD_ID: /^[A-Za-z0-9._:-]{1,160}$/,
  FORGE_SOURCE_REPOSITORY: /^https:\/\/\S+$/,
  FORGE_SOURCE_COMMIT: /^[0-9a-f]{40}$/,
  FORGE_SOURCE_TREE: /^[0-9a-f]{40}$/,
  // Digest form only. A tag is mutable, and the preflight exists to prevent a mutable reference
  // deciding which bytes run.
  FORGE_BACKEND_IMAGE_DIGEST: /^[a-z0-9][a-z0-9._\-/]*(:[0-9]+)?\/?[a-z0-9._\-/]*@sha256:[a-f0-9]{64}$/,
  FORGE_FRONTEND_IMAGE_DIGEST: /^[a-z0-9][a-z0-9._\-/]*(:[0-9]+)?\/?[a-z0-9._\-/]*@sha256:[a-f0-9]{64}$/,
  FORGE_BUILDER_IDENTITY: /^https:\/\/\S+$/,
  FORGE_BUILDER_RUNNER_ENVIRONMENT: /^[a-z][a-z0-9-]{0,39}$/,
  FORGE_ISSUED_AT: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  FORGE_SOURCE_TAG: /^v[A-Za-z0-9._+-]{1,80}$/
};

export function buildForgeDocument(env) {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing required build provenance input: ${missing.join(", ")}`);
  for (const [name, shape] of Object.entries(SHAPES)) {
    const value = env[name]?.trim();
    if (value && !shape.test(value)) throw new Error(`Malformed build provenance input: ${name}`);
  }
  if (env.FORGE_BACKEND_IMAGE_DIGEST.trim() === env.FORGE_FRONTEND_IMAGE_DIGEST.trim()) {
    throw new Error("Backend and frontend images are identical");
  }
  // Key order here is cosmetic — the canonical digest is an explicit ordered field join, not a
  // serialization of this object — but keeping it in spec order makes the artifact readable in review.
  const document = {
    schemaVersion: "forge-build-v1",
    buildId: env.FORGE_BUILD_ID.trim(),
    sourceRepository: env.FORGE_SOURCE_REPOSITORY.trim(),
    sourceCommit: env.FORGE_SOURCE_COMMIT.trim(),
    sourceTree: env.FORGE_SOURCE_TREE.trim(),
    ...(env.FORGE_SOURCE_TAG?.trim() ? { sourceTag: env.FORGE_SOURCE_TAG.trim() } : {}),
    backendImageDigest: env.FORGE_BACKEND_IMAGE_DIGEST.trim(),
    frontendImageDigest: env.FORGE_FRONTEND_IMAGE_DIGEST.trim(),
    ...(env.FORGE_RELEASE_BUNDLE_SHA256?.trim() ? { releaseBundleSha256: env.FORGE_RELEASE_BUNDLE_SHA256.trim() } : {}),
    ...(env.FORGE_RELEASE_MANIFEST_DIGEST?.trim() ? { releaseManifestDigest: env.FORGE_RELEASE_MANIFEST_DIGEST.trim() } : {}),
    builderIdentity: env.FORGE_BUILDER_IDENTITY.trim(),
    builderRunnerEnvironment: env.FORGE_BUILDER_RUNNER_ENVIRONMENT.trim(),
    issuedAt: env.FORGE_ISSUED_AT.trim()
  };
  // No trailing newline juggling: the attestation subject is the sha256 of exactly these bytes, and the
  // verifier hashes exactly the bytes it reads. Whatever is written here is what must be attested.
  return `${JSON.stringify(document, null, 2)}\n`;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) {
  const output = process.argv[2];
  if (!output) {
    process.stderr.write("Usage: node scripts/build-forge-document.mjs <output.json>\n");
    process.exit(2);
  }
  try {
    fs.writeFileSync(output, buildForgeDocument(process.env), { flag: "wx" });
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "failed to write forge build document"}\n`);
    process.exit(1);
  }
}
