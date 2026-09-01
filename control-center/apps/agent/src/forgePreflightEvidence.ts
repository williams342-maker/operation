import crypto from "node:crypto";
import fs from "node:fs";
import {
  verifyForgeDeployment,
  type ForgeAttestationEvidence,
  type ForgeBuildManifest,
  type ForgeTargetBinding,
  type ForgeVerificationDecision
} from "@control-center/shared";

// Forge evidence loading for the beta deployment preflight — see docs/forge-manifest-spec.md §8.2.
//
// This module reads the operator-supplied evidence files and hands them to the shared verifier. It adds
// no execution authority: the strongest thing a complete, verified evidence set can do is let the
// preflight reach "PASS — awaiting operator approval", exactly as it does without one.
//
// Two deliberate properties:
//
//   1. THE PREFLIGHT HASHES THE FILES ITSELF. The attestation subject digest is compared against a
//      sha256 this module computes over the bytes it read, never against a digest the operator supplied.
//      A supplied digest is an assertion; a computed one is a measurement, and the whole point of this
//      mechanism is to stop trusting assertions.
//
//   2. NO NETWORK. Attestation verification (`gh attestation verify`) happens out of band and its result
//      is recorded into an evidence file. The preflight must never fetch its own evidence — a verifier
//      that can go and get the thing it is checking can be pointed somewhere else.

export type ForgeEvidencePaths = {
  /** Presence of this path is what turns the whole group on. Absent = inert. */
  forgeCandidateBuildPath?: string;
  forgeRollbackBuildPath?: string;
  forgeTargetBindingPath?: string;
  forgeOwnerAuthorizationPath?: string;
  forgeOwnerPublicKeyPath?: string;
  /** Recorded `gh attestation verify` results: { candidate: {...}, rollback: {...} }. */
  forgeAttestationPath?: string;
};

export type ForgeEvidenceOutcome =
  | { state: "absent" }
  | { state: "incomplete"; missing: string[] }
  | { state: "unreadable"; detail: string }
  | { state: "verified"; candidate: ForgeBuildManifest; rollback: ForgeBuildManifest; binding: ForgeTargetBinding; bindingDigest: string }
  | { state: "rejected"; reason: string; detail?: string };

const REQUIRED_PATHS = [
  "forgeCandidateBuildPath",
  "forgeRollbackBuildPath",
  "forgeTargetBindingPath",
  "forgeOwnerAuthorizationPath",
  "forgeOwnerPublicKeyPath",
  "forgeAttestationPath"
] as const;

export const forgeEvidenceRequested = (paths: ForgeEvidencePaths) =>
  REQUIRED_PATHS.some((key) => Boolean(paths[key]?.trim()));

function readJson(path: string): { value: unknown; sha256: string } {
  const bytes = fs.readFileSync(path);
  return { value: JSON.parse(bytes.toString("utf8")), sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

export function loadAndVerifyForgeEvidence(paths: ForgeEvidencePaths, context: { agentAdvertisedCapabilities: readonly string[]; consumedNonces?: ReadonlySet<string>; now?: number }): ForgeEvidenceOutcome {
  if (!forgeEvidenceRequested(paths)) return { state: "absent" };
  // Partial evidence must never pass. Supplying some documents and omitting the owner authorization is
  // exactly the shape of an attempt to deploy on provenance alone.
  const missing = REQUIRED_PATHS.filter((key) => !paths[key]?.trim());
  if (missing.length) return { state: "incomplete", missing: [...missing] };

  let candidate: { value: unknown; sha256: string };
  let rollback: { value: unknown; sha256: string };
  let binding: unknown;
  let ownerAuthorization: unknown;
  let ownerPublicKey: string;
  let attestations: { candidate?: ForgeAttestationEvidence; rollback?: ForgeAttestationEvidence };
  try {
    candidate = readJson(paths.forgeCandidateBuildPath!);
    rollback = readJson(paths.forgeRollbackBuildPath!);
    binding = readJson(paths.forgeTargetBindingPath!).value;
    ownerAuthorization = readJson(paths.forgeOwnerAuthorizationPath!).value;
    ownerPublicKey = fs.readFileSync(paths.forgeOwnerPublicKeyPath!, "utf8").trim();
    attestations = readJson(paths.forgeAttestationPath!).value as typeof attestations;
  } catch (error) {
    return { state: "unreadable", detail: error instanceof Error ? error.message : "unreadable evidence" };
  }
  if (!attestations?.candidate || !attestations?.rollback) return { state: "rejected", reason: "attestation-unverified", detail: "attestation evidence must cover both the candidate and the rollback build" };
  if (!ownerPublicKey) return { state: "rejected", reason: "owner-authorization-invalid", detail: "owner public key is empty" };

  const decision: ForgeVerificationDecision = verifyForgeDeployment({
    // manifestSha256 is COMPUTED here, never taken from the input.
    candidate: { manifest: candidate.value, manifestSha256: candidate.sha256, attestation: attestations.candidate },
    rollback: { manifest: rollback.value, manifestSha256: rollback.sha256, attestation: attestations.rollback },
    binding,
    ownerAuthorization: ownerAuthorization as never,
    ownerPublicKey,
    agentAdvertisedCapabilities: context.agentAdvertisedCapabilities,
    consumedNonces: context.consumedNonces,
    now: context.now
  });
  if (!decision.verified) return { state: "rejected", reason: decision.reason, detail: decision.detail };
  return { state: "verified", candidate: decision.candidate, rollback: decision.rollback, binding: decision.binding, bindingDigest: decision.bindingDigest };
}
