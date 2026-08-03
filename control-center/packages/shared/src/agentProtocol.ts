import { z } from "zod";
import { verifyEnrollmentProof } from "./agentKeys.js";

// Versioned agent credential protocol. "agent-v1" is the legacy symmetric HMAC scheme; "agent-v2" is
// the asymmetric scheme (Ed25519 request/enrollment signing + X25519 deployment-secret sealing). A
// server document with no explicit version is treated as legacy. See docs/agent-key-redesign.md.
export const agentProtocolVersions = ["agent-v1", "agent-v2"] as const;
export type AgentProtocolVersion = (typeof agentProtocolVersions)[number];
export const agentProtocolVersionSchema = z.enum(agentProtocolVersions);
export const defaultAgentProtocolVersion: AgentProtocolVersion = "agent-v1";

// Per-agent migration state within a dual-accept window:
//  legacy → dual : v2 keys registered; control plane accepts BOTH v1 and v2 for this agent.
//  dual   → v2   : migration complete; v1 no longer accepted for this agent.
//  dual   → legacy | v2 → dual : rollback (legacy credential must still exist; guarded by caller).
export const agentMigrationStates = ["legacy", "dual", "v2"] as const;
export type AgentMigrationState = (typeof agentMigrationStates)[number];
export const defaultAgentMigrationState: AgentMigrationState = "legacy";

export type AgentMigrationAction = "begin" | "complete" | "rollback";

// Pure transition function. Idempotent where the target equals the current state; throws on an illegal
// transition so callers fail closed rather than silently corrupting migration state.
export function nextMigrationState(current: AgentMigrationState, action: AgentMigrationAction): AgentMigrationState {
  switch (action) {
    case "begin":
      if (current === "legacy" || current === "dual") return "dual";
      throw new Error(`Cannot begin migration from state ${current}`);
    case "complete":
      if (current === "dual" || current === "v2") return "v2";
      throw new Error(`Cannot complete migration from state ${current}`);
    case "rollback":
      if (current === "v2") return "dual";
      if (current === "dual" || current === "legacy") return "legacy";
      throw new Error(`Cannot roll back migration from state ${current}`);
  }
}

// Which credential schemes the control plane will accept for a given per-agent state, once the global
// CONTROL_CENTER_AGENT_PROTOCOL_V2 flag is enabled. With the flag OFF, callers must accept v1 only.
export function acceptedSchemes(state: AgentMigrationState): AgentProtocolVersion[] {
  switch (state) {
    case "legacy": return ["agent-v1"];
    case "dual": return ["agent-v1", "agent-v2"];
    case "v2": return ["agent-v2"];
  }
}

export type AgentCredentialLike = {
  keyProtocolVersion?: string;
  migrationState?: string;
  signingKeyFingerprint?: string;
  encryptionKeyFingerprint?: string;
  credentialVersion?: number;
  revokedAt?: Date;
  revokedKeyFingerprints?: string[];
};

// Audit-/telemetry-safe view of an agent's credential status: key FINGERPRINTS only, never the raw
// public keys, never the legacy secret hash, never any private material.
export type AgentCredentialStatus = {
  keyProtocolVersion: AgentProtocolVersion;
  migrationState: AgentMigrationState;
  signingKeyFingerprint: string | null;
  encryptionKeyFingerprint: string | null;
  credentialVersion: number;
  revoked: boolean;
  revokedKeyCount: number;
};

export type EnrollmentV2Request = {
  enrollmentToken: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  issuedAt: string;
  protocolVersion: string;
  proof: string;
};

export type EnrollmentV2Result =
  | { valid: true }
  | { valid: false; reason: "downgrade" | "key-reuse" | "malformed" | "expired" | "forged" };

// Pure verification of a v2 enrollment request. Fails closed with a specific reason. Replay of an
// entire enrollment is additionally prevented at the data layer by the single-use enrollment token;
// this function enforces version (anti-downgrade), key separation, freshness (anti-expiry/-replay of a
// stale challenge), and proof-of-possession (anti-forgery). maxSkewMs bounds the issuedAt window.
export function verifyEnrollmentV2(request: EnrollmentV2Request, now = Date.now(), maxSkewMs = 5 * 60 * 1000): EnrollmentV2Result {
  if (request.protocolVersion !== "agent-v2") return { valid: false, reason: "downgrade" };
  if (!request.signingPublicKey || !request.encryptionPublicKey) return { valid: false, reason: "malformed" };
  if (request.signingPublicKey === request.encryptionPublicKey) return { valid: false, reason: "key-reuse" };
  const issuedAt = Date.parse(request.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > maxSkewMs) return { valid: false, reason: "expired" };
  const ok = verifyEnrollmentProof(request.signingPublicKey, {
    enrollmentToken: request.enrollmentToken,
    signingPublicKey: request.signingPublicKey,
    encryptionPublicKey: request.encryptionPublicKey,
    issuedAt: request.issuedAt,
    protocolVersion: request.protocolVersion
  }, request.proof);
  return ok ? { valid: true } : { valid: false, reason: "forged" };
}

export function describeAgentCredential(server: AgentCredentialLike): AgentCredentialStatus {
  const version = agentProtocolVersions.includes(server.keyProtocolVersion as AgentProtocolVersion)
    ? (server.keyProtocolVersion as AgentProtocolVersion)
    : defaultAgentProtocolVersion;
  const state = agentMigrationStates.includes(server.migrationState as AgentMigrationState)
    ? (server.migrationState as AgentMigrationState)
    : defaultAgentMigrationState;
  return {
    keyProtocolVersion: version,
    migrationState: state,
    signingKeyFingerprint: server.signingKeyFingerprint ?? null,
    encryptionKeyFingerprint: server.encryptionKeyFingerprint ?? null,
    credentialVersion: server.credentialVersion ?? 1,
    revoked: Boolean(server.revokedAt),
    revokedKeyCount: server.revokedKeyFingerprints?.length ?? 0
  };
}
