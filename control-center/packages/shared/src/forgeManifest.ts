import crypto from "node:crypto";
import { z } from "zod";
import { verifyAgentSignature } from "./agentKeys.js";
import { agentCapabilities } from "./protocol.js";
import { ownerAuthorizationSchema, isTaskExpired, type OwnerAuthorization } from "./tasks.js";

// forge-deployment-v1 — see docs/forge-manifest-spec.md.
//
// A Forge manifest is EVIDENCE, never AUTHORIZATION. It says "this artifact was built from this source,
// and may be deployed to this target, until this time". Verifying one turns a deployment preflight
// BLOCKED into "PASS — awaiting operator approval". It cannot deploy, and it grants no capability.
//
// Two independent parties verify it, and NEITHER is an OpsWorkbench component (owner decision
// 2026-09-01):
//   Party A — Sigstore/Rekor keyless build provenance. Answers "was this built from that source, by
//             that workflow". Its authority is a public transparency log outside this project.
//   Party B — the owner's OFFLINE Ed25519 key, via the existing owner-authorization-v1 statement.
//             Answers "is this deployment authorized".
// Both must pass. Party A without Party B is a well-built artifact nobody authorized; Party B without
// Party A is an authorization for something of unknown origin. This module holds no private key and
// verifies with PUBLIC material only.
//
// Forge itself signs NOTHING. There is deliberately no `signature` and no `verifierKeyId` field: the
// manifest is a SUBJECT of a keyless attestation, so there is no Forge key to steal, rotate, or misuse.

export const forgeManifestSchemaVersion = "forge-deployment-v1" as const;

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const gitObject = z.string().regex(/^[0-9a-f]{40}$/);
// A pinned OCI image reference. Digest form ONLY: a tag is mutable, and the preflight documentation
// already names mutable default tags as the hazard it exists to prevent.
const imageDigest = z.string().regex(/^[a-z0-9][a-z0-9._\-/]*(:[0-9]+)?\/?[a-z0-9._\-/]*@sha256:[a-f0-9]{64}$/).max(512);
const httpsUrl = z.string().url().max(512).refine((value) => new URL(value).protocol === "https:", "Must use HTTPS");
const safeId = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const serviceName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}$/);

export const forgeDeploymentManifestSchema = z.object({
  schemaVersion: z.literal(forgeManifestSchemaVersion),
  manifestId: safeId,
  // Source
  sourceRepository: httpsUrl,
  sourceCommit: gitObject,
  // The TREE as well as the commit: two commits can carry the same tree, and a rewritten history can
  // reuse a message and author while carrying a different one. Costs one rev-parse; makes the claim
  // checkable rather than asserted. (`16e14682` was a commit string that exists in no object database.)
  sourceTree: gitObject,
  sourceTag: z.string().regex(/^v[A-Za-z0-9._+-]{1,80}$/).optional(),
  // Artifact
  backendImageDigest: imageDigest,
  frontendImageDigest: imageDigest,
  releaseBundleSha256: sha256Hex.optional(),
  releaseManifestDigest: sha256Hex.optional(),
  // Target
  targetEnvironment: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  targetServerId: z.string().min(12).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  targetOrgId: z.string().min(12).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  composeProjectName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  authorizedServices: z.array(serviceName).min(1).max(20),
  // Rollback
  rollbackBackendImageDigest: imageDigest,
  rollbackFrontendImageDigest: imageDigest,
  rollbackSourceCommit: gitObject,
  // Provenance (party A). These are what the attestation must be checked AGAINST — binding them in the
  // manifest is what stops a valid attestation from a different workflow being accepted just because it
  // verifies.
  builderIdentity: httpsUrl,
  builderRunnerEnvironment: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  requiredCapabilities: z.array(z.enum(agentCapabilities)).max(100),
  // Freshness
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().regex(/^[A-Za-z0-9._:-]{16,160}$/)
}).strict().superRefine((value, context) => {
  const dup = (label: string, items: string[]) => {
    if (new Set(items).size !== items.length) context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate entry in ${label}` });
  };
  dup("authorizedServices", value.authorizedServices);
  dup("requiredCapabilities", value.requiredCapabilities);
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: "expiresAt must be after issuedAt" });
  // A candidate that equals its own rollback makes rollback a no-op that still reports success.
  if (value.backendImageDigest === value.rollbackBackendImageDigest) context.addIssue({ code: z.ZodIssueCode.custom, message: "Backend candidate and rollback images are identical" });
  if (value.frontendImageDigest === value.rollbackFrontendImageDigest) context.addIssue({ code: z.ZodIssueCode.custom, message: "Frontend candidate and rollback images are identical" });
});

export type ForgeDeploymentManifest = z.infer<typeof forgeDeploymentManifestSchema>;

// ---------------------------------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------------------------------
// This repository contains three digest patterns with materially different properties:
//
//   explicit ordered field join  (taskSigningBase, ownerAuthorizationMessage)  canonical: yes  nesting: n/a
//   plain JSON.stringify         (payloadDigest)                              canonical: NO   nesting: yes
//   JSON.stringify + replacer    (agentReleaseManifestDigest)                 canonical: yes  nesting: NO
//
// We use the FIRST. The replacer-array form looks canonical and is not: the array replacer is an
// allowlist applied to EVERY object in the graph, so a nested object's keys that are absent from the
// top-level key list are dropped from the serialization WITHOUT ERROR. Two manifests differing only in
// nested content then digest identically, and a signature over one validates the other. That is correct
// today only because every current user of the idiom is flat.
//
// The ordered join removes the hazard rather than avoiding it by convention: no serialization
// ambiguity, auditable by reading, and adding a field is an explicit reviewable change to a list rather
// than an invisible consequence of a schema edit.
//
// FIELD ORDER IS PART OF THE FORMAT. Never reorder, never remove, and only append.
const CANONICAL_FIELD_ORDER = [
  "schemaVersion", "manifestId",
  "sourceRepository", "sourceCommit", "sourceTree", "sourceTag",
  "backendImageDigest", "frontendImageDigest", "releaseBundleSha256", "releaseManifestDigest",
  "targetEnvironment", "targetServerId", "targetOrgId", "composeProjectName", "authorizedServices",
  "rollbackBackendImageDigest", "rollbackFrontendImageDigest", "rollbackSourceCommit",
  "builderIdentity", "builderRunnerEnvironment", "requiredCapabilities",
  "issuedAt", "expiresAt", "nonce"
] as const satisfies readonly (keyof ForgeDeploymentManifest)[];

// Separators must be impossible inside a field value or the join is forgeable: a value containing "\n"
// could invent additional fields, and one containing "," could shift array elements. Every field regex
// above forbids both. This guard makes that a runtime invariant rather than a property of regexes
// someone may later relax.
const FORBIDDEN_IN_VALUE = /[\n\r,]/;

function canonicalValue(field: string, raw: unknown): string {
  if (raw === undefined) return ""; // Absent optional. Unambiguous: no optional field may be empty.
  if (Array.isArray(raw)) {
    const items = [...raw].map(String).sort(); // Sorted: element order carries no meaning for either array.
    for (const item of items) if (FORBIDDEN_IN_VALUE.test(item)) throw new Error(`Unserializable value in ${field}`);
    return items.join(",");
  }
  const value = String(raw);
  if (FORBIDDEN_IN_VALUE.test(value)) throw new Error(`Unserializable value in ${field}`);
  return value;
}

// The canonical statement. Parsed first, so a malformed manifest can never be digested.
export function forgeManifestStatement(manifest: ForgeDeploymentManifest): string {
  const parsed = forgeDeploymentManifestSchema.parse(manifest);
  assertFlatManifest(parsed);
  return CANONICAL_FIELD_ORDER.map((field) => canonicalValue(field, (parsed as Record<string, unknown>)[field])).join("\n");
}

export function forgeManifestDigest(manifest: ForgeDeploymentManifest): string {
  return crypto.createHash("sha256").update(forgeManifestStatement(manifest)).digest("hex");
}

// Flatness is a correctness requirement, not a style preference — see the canonicalization note above.
// The schema already makes a nested field unrepresentable; this guard is what stops a LATER schema edit
// from quietly reintroducing the hazard, because the digest would then silently stop covering it.
export function assertFlatManifest(manifest: unknown): void {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Manifest must be an object");
  for (const [key, value] of Object.entries(manifest)) {
    if (value === null) throw new Error(`Manifest field is not flat: ${key}`);
    if (Array.isArray(value)) {
      if (value.some((item) => typeof item !== "string")) throw new Error(`Manifest field is not flat: ${key}`);
      continue;
    }
    if (typeof value === "object") throw new Error(`Manifest field is not flat: ${key}`);
  }
  const declared = new Set<string>(CANONICAL_FIELD_ORDER);
  for (const key of Object.keys(manifest)) {
    // A field the schema accepts but the canonical order omits would be signed-around: present in the
    // manifest, absent from the digest. Fail closed rather than sign a partial statement.
    if (!declared.has(key)) throw new Error(`Manifest field is outside the canonical field order: ${key}`);
  }
}

// ---------------------------------------------------------------------------------------------------
// Secret-shaped value detection
// ---------------------------------------------------------------------------------------------------
// The manifest is value-free by design. This is a shape check, not a secret scanner: it exists so that
// a credential pasted into a manifest field fails loudly at verification instead of travelling onward
// into an audit record.
const SECRET_PATTERNS: RegExp[] = [
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*:[^/\s]*@/i, // URI with embedded userinfo
  /\bsk_live_/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ // JWT
];
const DIGEST_BEARING_FIELDS = new Set<string>(["sourceCommit", "sourceTree", "rollbackSourceCommit", "backendImageDigest", "frontendImageDigest", "rollbackBackendImageDigest", "rollbackFrontendImageDigest", "releaseBundleSha256", "releaseManifestDigest", "nonce", "manifestId"]);

export function findSecretShapedField(manifest: ForgeDeploymentManifest): string | undefined {
  for (const [key, value] of Object.entries(manifest)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item !== "string") continue;
      if (SECRET_PATTERNS.some((pattern) => pattern.test(item))) return key;
      // High-entropy opaque blob in a field that is not supposed to carry one.
      if (!DIGEST_BEARING_FIELDS.has(key) && item.length >= 40 && /^[A-Za-z0-9+/=_-]+$/.test(item) && !/^https:/.test(item)) return key;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------------------------------

// What party A (Sigstore/Rekor) reports, reduced to the fields we bind. Supplied by the caller after a
// real attestation verification — this module deliberately performs no I/O, so it stays pure and
// testable and cannot be tricked into fetching its own evidence.
export type ForgeAttestationEvidence = {
  verified: boolean;
  builderId: string;
  runnerEnvironment: string;
  sourceCommit: string;
  subjectSha256: string;
};

export type ForgeManifestVerificationInput = {
  manifest: unknown;
  /** sha256 of the manifest bytes actually read, which must be the attestation's subject. */
  manifestSha256: string;
  attestation: ForgeAttestationEvidence;
  ownerAuthorization?: OwnerAuthorization;
  /** Owner PUBLIC key, provisioned out of band. No private key is ever handled here. */
  ownerPublicKey: string;
  /** Capabilities the target agent actually advertises. */
  agentAdvertisedCapabilities: readonly string[];
  /** Nonces already consumed, for replay rejection. */
  consumedNonces?: ReadonlySet<string>;
  now?: number;
};

export type ForgeManifestVerificationReason =
  | "schema-invalid"
  | "not-flat"
  | "secret-shaped-value"
  | "attestation-unverified"
  | "attestation-subject-mismatch"
  | "builder-identity-mismatch"
  | "builder-runner-mismatch"
  | "source-commit-mismatch"
  | "expired"
  | "replayed-nonce"
  | "owner-authorization-missing"
  | "owner-authorization-invalid"
  | "capability-not-advertised";

export type ForgeManifestDecision =
  | { verified: true; manifest: ForgeDeploymentManifest; digest: string }
  | { verified: false; reason: ForgeManifestVerificationReason; detail?: string };

// The owner authorization statement. Reuses owner-authorization-v1's shape and ordering discipline; the
// action being authorized is identified by the manifest digest, so one statement authorizes exactly one
// manifest against exactly one target and cannot be replayed onto another.
export function forgeOwnerAuthorizationMessage(parts: { manifestDigest: string; targetOrgId: string; targetServerId: string; expiresAt: string; nonce: string; keyVersion: string }): string {
  return ["forge-deployment-authorization-v1", parts.keyVersion, parts.targetOrgId, parts.targetServerId, parts.manifestDigest, parts.expiresAt, parts.nonce].join("\n");
}

// Fails closed with a specific reason, in a fixed order: shape, then provenance (party A), then
// freshness, then authorization (party B), then capability. Nothing short-circuits to `verified: true`.
export function verifyForgeManifest(input: ForgeManifestVerificationInput): ForgeManifestDecision {
  const parsed = forgeDeploymentManifestSchema.safeParse(input.manifest);
  if (!parsed.success) return { verified: false, reason: "schema-invalid", detail: parsed.error.issues[0]?.message };
  const manifest = parsed.data;

  try {
    assertFlatManifest(manifest);
  } catch (error) {
    return { verified: false, reason: "not-flat", detail: error instanceof Error ? error.message : undefined };
  }

  const secretField = findSecretShapedField(manifest);
  if (secretField) return { verified: false, reason: "secret-shaped-value", detail: secretField };

  // Party A — provenance. A valid attestation is not enough: it must be an attestation OF THIS MANIFEST,
  // produced by THE EXPECTED WORKFLOW, on THE EXPECTED RUNNER, for THE CLAIMED COMMIT.
  if (!input.attestation.verified) return { verified: false, reason: "attestation-unverified" };
  if (input.attestation.subjectSha256 !== input.manifestSha256) return { verified: false, reason: "attestation-subject-mismatch" };
  if (input.attestation.builderId !== manifest.builderIdentity) return { verified: false, reason: "builder-identity-mismatch" };
  if (input.attestation.runnerEnvironment !== manifest.builderRunnerEnvironment) return { verified: false, reason: "builder-runner-mismatch" };
  if (input.attestation.sourceCommit !== manifest.sourceCommit) return { verified: false, reason: "source-commit-mismatch" };

  if (isTaskExpired(manifest.expiresAt, input.now)) return { verified: false, reason: "expired" };
  if (input.consumedNonces?.has(manifest.nonce)) return { verified: false, reason: "replayed-nonce" };

  // Party B — authorization. Provenance is not authorization: a perfectly attested manifest with no
  // owner statement is rejected here, deliberately.
  if (!input.ownerAuthorization) return { verified: false, reason: "owner-authorization-missing" };
  const authorization = ownerAuthorizationSchema.safeParse(input.ownerAuthorization);
  if (!authorization.success) return { verified: false, reason: "owner-authorization-invalid", detail: "malformed" };
  if (isTaskExpired(authorization.data.expiresAt, input.now)) return { verified: false, reason: "expired" };
  if (input.consumedNonces?.has(authorization.data.nonce)) return { verified: false, reason: "replayed-nonce" };

  const digest = forgeManifestDigest(manifest);
  const authorized = verifyAgentSignature(input.ownerPublicKey, forgeOwnerAuthorizationMessage({
    manifestDigest: digest,
    targetOrgId: manifest.targetOrgId,
    targetServerId: manifest.targetServerId,
    expiresAt: authorization.data.expiresAt,
    nonce: authorization.data.nonce,
    keyVersion: authorization.data.keyVersion
  }), authorization.data.signature);
  if (!authorized) return { verified: false, reason: "owner-authorization-invalid" };

  const advertised = new Set(input.agentAdvertisedCapabilities);
  const missing = manifest.requiredCapabilities.find((capability) => !advertised.has(capability));
  if (missing) return { verified: false, reason: "capability-not-advertised", detail: missing };

  return { verified: true, manifest, digest };
}
