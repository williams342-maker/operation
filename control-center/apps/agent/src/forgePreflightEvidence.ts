import crypto from "node:crypto";
import fs from "node:fs";
import {
  verifyForgeDeployment,
  type ForgeAttestationEvidence,
  type ForgeBuildManifest,
  type ForgeTargetBinding,
  type ForgeVerificationDecision
} from "@control-center/shared";
import { loadTrustedRoot, verifyForgeBuildAttestation } from "./forgeAttestation.js";

// Forge evidence loading for the beta deployment preflight — see docs/forge-manifest-spec.md §8.2.
//
// REMEDIATION (2026-09-01, independent review). The previous version read an `attestation.json`
// containing `verified: true` and believed it, which let the same operator who supplies the manifests
// also play Party A. Party A is now REAL: this module verifies a Sigstore bundle against a pinned
// trusted root and derives the verdict. There is no field an operator can set to assert verification.
//
// Properties, all of which are load-bearing:
//
//   1. THE PREFLIGHT HASHES THE FILES ITSELF, and the hash is compared against the signed in-toto
//      subject — not against anything supplied alongside. A supplied digest is an assertion; a computed
//      one compared to a signature is a measurement.
//   2. NO NETWORK. The bundle and the trusted root are files. A verifier that can fetch the thing it is
//      checking can be pointed somewhere else.
//   3. PARTIAL EVIDENCE NEVER PASSES. Supplying some documents and omitting others blocks.

export type ForgeEvidencePaths = {
  /** Presence of any of these is what turns the group on. All absent = inert. */
  forgeCandidateBuildPath?: string;
  forgeCandidateAttestationPath?: string;
  forgeRollbackBuildPath?: string;
  forgeRollbackAttestationPath?: string;
  forgeTargetBindingPath?: string;
  forgeOwnerAuthorizationPath?: string;
  forgeOwnerPublicKeyPath?: string;
  /** Pinned Sigstore trusted root, provisioned out of band. Never fetched. */
  forgeTrustedRootPath?: string;
};

export type ForgeEvidenceOutcome =
  | { state: "absent" }
  | { state: "incomplete"; missing: string[] }
  | { state: "unreadable"; detail: string }
  | { state: "verified"; candidate: ForgeBuildManifest; rollback: ForgeBuildManifest; binding: ForgeTargetBinding; bindingDigest: string; nonces: string[] }
  | { state: "rejected"; reason: string; detail?: string };

const REQUIRED_PATHS = [
  "forgeCandidateBuildPath",
  "forgeCandidateAttestationPath",
  "forgeRollbackBuildPath",
  "forgeRollbackAttestationPath",
  "forgeTargetBindingPath",
  "forgeOwnerAuthorizationPath",
  "forgeOwnerPublicKeyPath",
  "forgeTrustedRootPath"
] as const;

export const forgeEvidenceRequested = (paths: ForgeEvidencePaths) =>
  REQUIRED_PATHS.some((key) => Boolean(paths[key]?.trim()));

// The owner public key is public material, but pointing this at a private key would still read private
// bytes into the process. Accept ONLY something that parses as an Ed25519 public key, and never retain
// the raw text beyond that check.
function loadOwnerPublicKey(path: string): string {
  const text = fs.readFileSync(path, "utf8").trim();
  if (!text) throw new Error("owner public key file is empty");
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(text)) throw new Error("owner public key path points at private key material");
  const key = crypto.createPublicKey({ key: Buffer.from(text, "base64url"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("owner key is not Ed25519");
  return text;
}

export function loadAndVerifyForgeEvidence(paths: ForgeEvidencePaths, context: { agentAdvertisedCapabilities: readonly string[]; consumedNonces?: ReadonlySet<string>; now?: number }): ForgeEvidenceOutcome {
  if (!forgeEvidenceRequested(paths)) return { state: "absent" };
  const missing = REQUIRED_PATHS.filter((key) => !paths[key]?.trim());
  if (missing.length) return { state: "incomplete", missing: [...missing] };

  let candidateBytes: Buffer;
  let rollbackBytes: Buffer;
  let candidateDocument: unknown;
  let rollbackDocument: unknown;
  let binding: unknown;
  let ownerAuthorization: unknown;
  let ownerPublicKey: string;
  let trustMaterial: ReturnType<typeof loadTrustedRoot>;
  try {
    candidateBytes = fs.readFileSync(paths.forgeCandidateBuildPath!);
    rollbackBytes = fs.readFileSync(paths.forgeRollbackBuildPath!);
    candidateDocument = JSON.parse(candidateBytes.toString("utf8"));
    rollbackDocument = JSON.parse(rollbackBytes.toString("utf8"));
    binding = JSON.parse(fs.readFileSync(paths.forgeTargetBindingPath!, "utf8"));
    ownerAuthorization = JSON.parse(fs.readFileSync(paths.forgeOwnerAuthorizationPath!, "utf8"));
    ownerPublicKey = loadOwnerPublicKey(paths.forgeOwnerPublicKeyPath!);
    trustMaterial = loadTrustedRoot(paths.forgeTrustedRootPath!);
  } catch (error) {
    return { state: "unreadable", detail: error instanceof Error ? error.message : "unreadable evidence" };
  }

  // The build documents must parse before they can be attested against — the expectation passed to the
  // attestation verifier comes from the document, and the attestation must independently agree.
  const shapeOf = (document: unknown) => document as Partial<ForgeBuildManifest>;
  const attest = (label: "candidate" | "rollback", bundlePath: string, bytes: Buffer, document: unknown): ForgeAttestationEvidence | { reason: string; detail?: string } => {
    const shape = shapeOf(document);
    if (typeof shape.builderIdentity !== "string" || typeof shape.builderRunnerEnvironment !== "string" || typeof shape.sourceCommit !== "string") {
      return { reason: `${label}-build-invalid`, detail: "build document is missing its provenance claims" };
    }
    const outcome = verifyForgeBuildAttestation({
      bundlePath,
      trustMaterial,
      documentBytes: bytes,
      expectation: { builderIdentity: shape.builderIdentity, runnerEnvironment: shape.builderRunnerEnvironment, sourceCommit: shape.sourceCommit }
    });
    if (!outcome.ok) return { reason: outcome.reason, detail: outcome.detail };
    // Constructed ONLY from cryptographically derived facts.
    return { builderId: outcome.facts.builderIdentity, runnerEnvironment: outcome.facts.runnerEnvironment, sourceCommit: outcome.facts.sourceCommit, subjectSha256: outcome.facts.documentSha256 };
  };

  const candidateAttestation = attest("candidate", paths.forgeCandidateAttestationPath!, candidateBytes, candidateDocument);
  if ("reason" in candidateAttestation) return { state: "rejected", reason: candidateAttestation.reason, detail: candidateAttestation.detail };
  // The rollback is held to exactly the same standard. An unattested rollback is how a "safe" rollback
  // becomes the delivery mechanism, because rollback is the path taken when scrutiny is lowest.
  const rollbackAttestation = attest("rollback", paths.forgeRollbackAttestationPath!, rollbackBytes, rollbackDocument);
  if ("reason" in rollbackAttestation) return { state: "rejected", reason: rollbackAttestation.reason, detail: rollbackAttestation.detail };

  const decision: ForgeVerificationDecision = verifyForgeDeployment({
    candidate: { manifest: candidateDocument, manifestSha256: candidateAttestation.subjectSha256, attestation: candidateAttestation },
    rollback: { manifest: rollbackDocument, manifestSha256: rollbackAttestation.subjectSha256, attestation: rollbackAttestation },
    binding,
    ownerAuthorization: ownerAuthorization as never,
    ownerPublicKey,
    agentAdvertisedCapabilities: context.agentAdvertisedCapabilities,
    consumedNonces: context.consumedNonces,
    now: context.now
  });
  if (!decision.verified) return { state: "rejected", reason: decision.reason, detail: decision.detail };
  // Both nonces are returned so the caller can consume them atomically. Verification does not consume;
  // consuming is the caller's job and must outlive the process.
  const ownerNonce = (ownerAuthorization as { nonce?: string })?.nonce;
  return {
    state: "verified",
    candidate: decision.candidate,
    rollback: decision.rollback,
    binding: decision.binding,
    bindingDigest: decision.bindingDigest,
    nonces: [decision.binding.nonce, ...(typeof ownerNonce === "string" ? [ownerNonce] : [])]
  };
}
