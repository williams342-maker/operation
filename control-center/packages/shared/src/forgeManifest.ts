import crypto from "node:crypto";
import { z } from "zod";
import { verifyAgentSignature } from "./agentKeys.js";
import { agentCapabilities } from "./protocol.js";
import { ownerAuthorizationSchema, isTaskExpired, type OwnerAuthorization } from "./tasks.js";

// Forge deployment evidence — see docs/forge-manifest-spec.md.
//
// TWO documents, deliberately, because a target is not knowable at build time (owner decision
// 2026-09-01). A single manifest would have forced Forge to assert a target it cannot know, which also
// contradicted the authority model: OpsWorkbench owns target identity, not Forge.
//
//   forge-build-v2           what Forge built, from what source. NO target. A permanent fact, so it
//                            carries no expiry and no nonce — a six-month-old build is not invalid,
//                            deploying it without fresh authorization is.
//   forge-target-binding-v1  composed LATER, once a target is chosen. Binds one build to one target,
//                            names a prior build as the rollback, and expires.
//
// Who produces what:
//   Forge          builds, and is the subject of a keyless attestation. Never learns the target.
//   OpsWorkbench   composes the binding (it owns target identity, classification, and policy)…
//   the owner      …but only the owner's OFFLINE key can authorize it. Composing is not authorizing.
//
// Verification requires both parties, and NEITHER is an OpsWorkbench component:
//   Party A — Sigstore/Rekor keyless build provenance, whose authority is a public transparency log
//             outside this project. Attests the builds.
//   Party B — the owner's offline Ed25519 key. Authorizes the binding.
// Party A without Party B is a well-built artifact nobody authorized. Party B without Party A is an
// authorization for something of unknown origin.
//
// Forge signs NOTHING. There is deliberately no `signature` and no `verifierKeyId` field: a build
// manifest is a SUBJECT of a keyless attestation, so there is no Forge key to steal, rotate, or misuse.
// This module holds no private key and verifies with PUBLIC material only.
//
// All of this is EVIDENCE, never AUTHORIZATION. A successful verification is what could later turn a
// deployment preflight BLOCKED into "PASS — awaiting operator approval". It cannot deploy, and it
// grants no capability.

export const forgeBuildSchemaVersion = "forge-build-v2" as const;
export const forgeTargetBindingSchemaVersion = "forge-target-binding-v1" as const;

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const gitObject = z.string().regex(/^[0-9a-f]{40}$/);
// A pinned OCI image reference. Digest form ONLY: a tag is mutable, and the preflight documentation
// already names mutable default tags as the hazard it exists to prevent.
const imageDigest = z.string().regex(/^[a-z0-9][a-z0-9._\-/]*(:[0-9]+)?\/?[a-z0-9._\-/]*@sha256:[a-f0-9]{64}$/).max(512);
const httpsUrl = z.string().url().max(512).refine((value) => new URL(value).protocol === "https:", "Must use HTTPS");
const safeId = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const serviceName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}$/);
const identifier = z.string().min(12).max(64).regex(/^[A-Za-z0-9._:-]+$/);

// ---------------------------------------------------------------------------------------------------
// forge-build-v2 — source → all production runtime artifacts. No target, no expiry, no nonce.
// ---------------------------------------------------------------------------------------------------
export const forgeBuildManifestSchema = z.object({
  schemaVersion: z.literal(forgeBuildSchemaVersion),
  buildId: safeId,
  sourceRepository: httpsUrl,
  sourceCommit: gitObject,
  // The TREE as well as the commit: two commits can carry the same tree, and a rewritten history can
  // reuse a message and author while carrying a different one. Costs one rev-parse; makes the claim
  // checkable rather than asserted. (`16e14682` was a commit string that exists in no object database.)
  sourceTree: gitObject,
  sourceTag: z.string().regex(/^v[A-Za-z0-9._+-]{1,80}$/).optional(),
  backendImageDigest: imageDigest,
  frontendImageDigest: imageDigest,
  adminImageDigest: imageDigest,
  reviewGateImageDigest: imageDigest,
  releaseBundleSha256: sha256Hex.optional(),
  releaseManifestDigest: sha256Hex.optional(),
  // What the attestation must be checked AGAINST. Binding these is what stops a valid attestation from
  // a different workflow being accepted merely because it verifies.
  builderIdentity: httpsUrl,
  builderRunnerEnvironment: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  issuedAt: z.string().datetime()
}).strict().superRefine((value, context) => {
  if (new Set([value.backendImageDigest, value.frontendImageDigest, value.adminImageDigest, value.reviewGateImageDigest]).size !== 4) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "All runtime images must be distinct" });
  }
});

export type ForgeBuildManifest = z.infer<typeof forgeBuildManifestSchema>;

// ---------------------------------------------------------------------------------------------------
// forge-target-binding-v1 — build → target. Composed once a target exists.
// ---------------------------------------------------------------------------------------------------
export const forgeTargetBindingSchema = z.object({
  schemaVersion: z.literal(forgeTargetBindingSchemaVersion),
  bindingId: safeId,
  // The join. Exactly one candidate build, identified by its canonical digest.
  buildDigest: sha256Hex,
  // Rollback is another ATTESTED BUILD, not a free-form image string. This is what makes "is the
  // rollback a real prior release?" answerable: the rollback's own provenance is verified too.
  rollbackBuildDigest: sha256Hex,
  targetEnvironment: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  targetOrgId: identifier,
  targetServerId: identifier,
  composeProjectName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  authorizedServices: z.array(serviceName).min(1).max(20),
  // Target-dependent, so it belongs here rather than in the build.
  requiredCapabilities: z.array(z.enum(agentCapabilities)).max(100),
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
  // A candidate that is its own rollback makes rollback a no-op that still reports success.
  if (value.buildDigest === value.rollbackBuildDigest) context.addIssue({ code: z.ZodIssueCode.custom, message: "Candidate and rollback builds are identical" });
});

export type ForgeTargetBinding = z.infer<typeof forgeTargetBindingSchema>;

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
// top-level key list are dropped from the serialization WITHOUT ERROR. Two documents differing only in
// nested content then digest identically, and a signature over one validates the other. That is correct
// today only because every current user of the idiom is flat.
//
// The ordered join removes the hazard rather than avoiding it by convention: no serialization
// ambiguity, auditable by reading, and adding a field is an explicit reviewable change to a list rather
// than an invisible consequence of a schema edit.
//
// FIELD ORDER IS PART OF EACH FORMAT. Never reorder, never remove, and only append.
const BUILD_FIELD_ORDER = [
  "schemaVersion", "buildId",
  "sourceRepository", "sourceCommit", "sourceTree", "sourceTag",
  "backendImageDigest", "frontendImageDigest", "adminImageDigest", "reviewGateImageDigest", "releaseBundleSha256", "releaseManifestDigest",
  "builderIdentity", "builderRunnerEnvironment",
  "issuedAt"
] as const satisfies readonly (keyof ForgeBuildManifest)[];

const BINDING_FIELD_ORDER = [
  "schemaVersion", "bindingId",
  "buildDigest", "rollbackBuildDigest",
  "targetEnvironment", "targetOrgId", "targetServerId", "composeProjectName",
  "authorizedServices", "requiredCapabilities",
  "issuedAt", "expiresAt", "nonce"
] as const satisfies readonly (keyof ForgeTargetBinding)[];

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

function statement(document: Record<string, unknown>, order: readonly string[]): string {
  return order.map((field) => canonicalValue(field, document[field])).join("\n");
}

// Flatness is a correctness requirement, not a style preference — see the canonicalization note above.
// Each schema already makes a nested field unrepresentable; this guard is what stops a LATER schema
// edit from quietly reintroducing the hazard, because the digest would then silently stop covering it.
export function assertFlatDocument(document: unknown, order: readonly string[]): void {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("Document must be an object");
  for (const [key, value] of Object.entries(document)) {
    if (value === null) throw new Error(`Field is not flat: ${key}`);
    if (Array.isArray(value)) {
      if (value.some((item) => typeof item !== "string")) throw new Error(`Field is not flat: ${key}`);
      continue;
    }
    if (typeof value === "object") throw new Error(`Field is not flat: ${key}`);
  }
  const declared = new Set(order);
  for (const key of Object.keys(document)) {
    // A field the schema accepts but the canonical order omits would be signed around: present in the
    // document, absent from the digest. Fail closed rather than sign a partial statement.
    if (!declared.has(key)) throw new Error(`Field is outside the canonical field order: ${key}`);
  }
}

// Parsed first, so a malformed document can never be digested — a bad document cannot be signed at all.
export function forgeBuildStatement(build: ForgeBuildManifest): string {
  const parsed = forgeBuildManifestSchema.parse(build);
  assertFlatDocument(parsed, BUILD_FIELD_ORDER);
  return statement(parsed as Record<string, unknown>, BUILD_FIELD_ORDER);
}

export function forgeBuildDigest(build: ForgeBuildManifest): string {
  return crypto.createHash("sha256").update(forgeBuildStatement(build)).digest("hex");
}

export function forgeTargetBindingStatement(binding: ForgeTargetBinding): string {
  const parsed = forgeTargetBindingSchema.parse(binding);
  assertFlatDocument(parsed, BINDING_FIELD_ORDER);
  return statement(parsed as Record<string, unknown>, BINDING_FIELD_ORDER);
}

export function forgeTargetBindingDigest(binding: ForgeTargetBinding): string {
  return crypto.createHash("sha256").update(forgeTargetBindingStatement(binding)).digest("hex");
}

// ---------------------------------------------------------------------------------------------------
// Secret-shaped value detection
// ---------------------------------------------------------------------------------------------------
// These documents are value-free by design. This is a shape check, not a secret scanner: it exists so
// that a credential pasted into a field fails loudly at verification instead of travelling onward into
// an audit record.
const SECRET_PATTERNS: RegExp[] = [
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*:[^/\s]*@/i, // URI with embedded userinfo
  /\bsk_live_/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ // JWT
];
const DIGEST_BEARING_FIELDS = new Set<string>(["buildId", "bindingId", "sourceCommit", "sourceTree", "backendImageDigest", "frontendImageDigest", "adminImageDigest", "reviewGateImageDigest", "releaseBundleSha256", "releaseManifestDigest", "buildDigest", "rollbackBuildDigest", "nonce"]);

export function findSecretShapedField(document: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(document)) {
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
// REMEDIATION (2026-09-01, independent review): the `verified: boolean` field is GONE. It let an
// operator assert Party A's verdict in a JSON file, which made the separation of parties nominal — the
// central finding of the review. These are now FACTS DERIVED from a real Sigstore bundle verification
// performed by the caller (apps/agent/src/forgeAttestation.ts) against a pinned trusted root. There is
// deliberately no field here that can carry a claim of verification: the existence of this value is the
// claim, and only real verification can produce one.
export type ForgeAttestationEvidence = {
  builderId: string;
  runnerEnvironment: string;
  sourceCommit: string;
  subjectSha256: string;
};

export type AttestedForgeBuild = {
  manifest: unknown;
  /** sha256 of the build manifest bytes actually read, which must be the attestation's subject. */
  manifestSha256: string;
  attestation: ForgeAttestationEvidence;
};

export type ForgeDeploymentVerificationInput = {
  candidate: AttestedForgeBuild;
  /** The rollback is a prior build, and its provenance is verified exactly as strictly. */
  rollback: AttestedForgeBuild;
  binding: unknown;
  ownerAuthorization?: OwnerAuthorization;
  /** Owner PUBLIC key, provisioned out of band. No private key is ever handled here. */
  ownerPublicKey: string;
  /** Capabilities the target agent actually advertises. */
  agentAdvertisedCapabilities: readonly string[];
  /** Nonces already consumed, for replay rejection. */
  consumedNonces?: ReadonlySet<string>;
  now?: number;
};

export type ForgeVerificationReason =
  | "candidate-build-invalid"
  | "rollback-build-invalid"
  | "binding-invalid"
  | "not-flat"
  | "secret-shaped-value"
  | "attestation-subject-mismatch"
  | "builder-identity-mismatch"
  | "builder-runner-mismatch"
  | "source-commit-mismatch"
  | "binding-build-mismatch"
  | "binding-rollback-mismatch"
  | "expired"
  | "replayed-nonce"
  | "owner-authorization-missing"
  | "owner-authorization-invalid"
  | "capability-not-advertised";

export type ForgeVerificationDecision =
  | { verified: true; candidate: ForgeBuildManifest; rollback: ForgeBuildManifest; binding: ForgeTargetBinding; bindingDigest: string }
  | { verified: false; reason: ForgeVerificationReason; detail?: string };

// The owner authorization statement. Reuses owner-authorization-v1's shape and ordering discipline. It
// covers the BINDING digest, which itself covers both build digests — so one statement authorizes
// exactly one build onto exactly one target with exactly one rollback, and cannot be replayed onto
// another target or transferred to a different build.
export function forgeOwnerAuthorizationMessage(parts: { bindingDigest: string; targetOrgId: string; targetServerId: string; expiresAt: string; nonce: string; keyVersion: string }): string {
  return ["forge-deployment-authorization-v1", parts.keyVersion, parts.targetOrgId, parts.targetServerId, parts.bindingDigest, parts.expiresAt, parts.nonce].join("\n");
}

function checkBuild(entry: AttestedForgeBuild, invalidReason: ForgeVerificationReason): { build: ForgeBuildManifest } | { reason: ForgeVerificationReason; detail?: string } {
  const parsed = forgeBuildManifestSchema.safeParse(entry.manifest);
  if (!parsed.success) return { reason: invalidReason, detail: parsed.error.issues[0]?.message };
  const build = parsed.data;
  try {
    assertFlatDocument(build, BUILD_FIELD_ORDER);
  } catch (error) {
    return { reason: "not-flat", detail: error instanceof Error ? error.message : undefined };
  }
  const secretField = findSecretShapedField(build);
  if (secretField) return { reason: "secret-shaped-value", detail: secretField };
  // A valid attestation is not enough. It must be an attestation OF THIS BUILD, produced by THE
  // EXPECTED WORKFLOW, on THE EXPECTED RUNNER, for THE CLAIMED COMMIT.
  if (entry.attestation.subjectSha256 !== entry.manifestSha256) return { reason: "attestation-subject-mismatch" };
  if (entry.attestation.builderId !== build.builderIdentity) return { reason: "builder-identity-mismatch" };
  if (entry.attestation.runnerEnvironment !== build.builderRunnerEnvironment) return { reason: "builder-runner-mismatch" };
  if (entry.attestation.sourceCommit !== build.sourceCommit) return { reason: "source-commit-mismatch" };
  return { build };
}

// Fails closed with a specific reason, in a fixed order: candidate provenance, rollback provenance,
// binding shape, the build↔binding join, freshness, authorization, capability. Nothing short-circuits
// to `verified: true`.
export function verifyForgeDeployment(input: ForgeDeploymentVerificationInput): ForgeVerificationDecision {
  const candidate = checkBuild(input.candidate, "candidate-build-invalid");
  if ("reason" in candidate) return { verified: false, reason: candidate.reason, detail: candidate.detail };
  // The rollback is held to the same standard. An unattested rollback is how a "safe" rollback becomes
  // the delivery mechanism.
  const rollback = checkBuild(input.rollback, "rollback-build-invalid");
  if ("reason" in rollback) return { verified: false, reason: rollback.reason, detail: rollback.detail };

  const parsedBinding = forgeTargetBindingSchema.safeParse(input.binding);
  if (!parsedBinding.success) return { verified: false, reason: "binding-invalid", detail: parsedBinding.error.issues[0]?.message };
  const binding = parsedBinding.data;
  try {
    assertFlatDocument(binding, BINDING_FIELD_ORDER);
  } catch (error) {
    return { verified: false, reason: "not-flat", detail: error instanceof Error ? error.message : undefined };
  }
  const bindingSecret = findSecretShapedField(binding);
  if (bindingSecret) return { verified: false, reason: "secret-shaped-value", detail: bindingSecret };

  // The join. A binding authorizes the build it names, not whichever build was handed alongside it.
  if (forgeBuildDigest(candidate.build) !== binding.buildDigest) return { verified: false, reason: "binding-build-mismatch" };
  if (forgeBuildDigest(rollback.build) !== binding.rollbackBuildDigest) return { verified: false, reason: "binding-rollback-mismatch" };

  if (isTaskExpired(binding.expiresAt, input.now)) return { verified: false, reason: "expired" };
  if (input.consumedNonces?.has(binding.nonce)) return { verified: false, reason: "replayed-nonce" };

  // Party B — authorization. Provenance is not authorization: a perfectly attested pair of builds with
  // a well-formed binding and no owner statement is rejected here, deliberately.
  if (!input.ownerAuthorization) return { verified: false, reason: "owner-authorization-missing" };
  const authorization = ownerAuthorizationSchema.safeParse(input.ownerAuthorization);
  if (!authorization.success) return { verified: false, reason: "owner-authorization-invalid", detail: "malformed" };
  if (isTaskExpired(authorization.data.expiresAt, input.now)) return { verified: false, reason: "expired" };
  if (input.consumedNonces?.has(authorization.data.nonce)) return { verified: false, reason: "replayed-nonce" };

  const bindingDigest = forgeTargetBindingDigest(binding);
  const authorized = verifyAgentSignature(input.ownerPublicKey, forgeOwnerAuthorizationMessage({
    bindingDigest,
    targetOrgId: binding.targetOrgId,
    targetServerId: binding.targetServerId,
    expiresAt: authorization.data.expiresAt,
    nonce: authorization.data.nonce,
    keyVersion: authorization.data.keyVersion
  }), authorization.data.signature);
  if (!authorized) return { verified: false, reason: "owner-authorization-invalid" };

  const advertised = new Set(input.agentAdvertisedCapabilities);
  const missing = binding.requiredCapabilities.find((capability) => !advertised.has(capability));
  if (missing) return { verified: false, reason: "capability-not-advertised", detail: missing };

  return { verified: true, candidate: candidate.build, rollback: rollback.build, binding, bindingDigest };
}
