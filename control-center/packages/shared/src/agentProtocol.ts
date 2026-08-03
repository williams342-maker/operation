import { z } from "zod";
import { verifyEnrollmentProof, verifyRotationProof, keyFingerprint } from "./agentKeys.js";

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

export type RotationV2Request = { agentId: string; signingPublicKey: string; encryptionPublicKey: string; issuedAt: string; protocolVersion: string; proof: string };

// Pure verification of a v2 key-rotation request (fail-closed, same reason taxonomy as enrollment). The
// PoP must be signed by the NEW signing key, bound to the agent's id, so a caller cannot register keys
// it does not hold even while authenticated with its current credential.
export function verifyRotationV2(request: RotationV2Request, now = Date.now(), maxSkewMs = 5 * 60 * 1000): EnrollmentV2Result {
  if (request.protocolVersion !== "agent-v2") return { valid: false, reason: "downgrade" };
  if (!request.signingPublicKey || !request.encryptionPublicKey) return { valid: false, reason: "malformed" };
  if (request.signingPublicKey === request.encryptionPublicKey) return { valid: false, reason: "key-reuse" };
  const issuedAt = Date.parse(request.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > maxSkewMs) return { valid: false, reason: "expired" };
  const ok = verifyRotationProof(request.signingPublicKey, { agentId: request.agentId, signingPublicKey: request.signingPublicKey, encryptionPublicKey: request.encryptionPublicKey, issuedAt: request.issuedAt, protocolVersion: request.protocolVersion }, request.proof);
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

// ---- Item 6: credential lifecycle (pure planners; the caller applies them atomically, guarded by
// credentialVersion for interrupted-rotation recovery / optimistic concurrency) ----

export type LifecycleServer = AgentCredentialLike & { signingKeyFingerprint?: string; encryptionKeyFingerprint?: string; credentialVersion?: number };

export type KeyRotationPlan = {
  keyProtocolVersion: "agent-v2";
  migrationState: AgentMigrationState;
  signingPublicKey: string;
  encryptionPublicKey: string;
  signingKeyFingerprint: string;
  encryptionKeyFingerprint: string;
  previousSigningKeyFingerprint?: string;
  previousEncryptionKeyFingerprint?: string;
  keyRotatedAt: Date;
  credentialVersion: number;
  revokedKeyFingerprints: string[];
};

// Register a new v2 keypair on an existing agent. A first rotation from legacy opens the dual-accept
// window; rotating a dual/v2 agent keeps its state. The superseded (stale) fingerprints are recorded in
// previous* AND appended to the revoked set so a rolled-over key can never authenticate again.
export function planKeyRotation(current: LifecycleServer, input: { signingPublicKey: string; encryptionPublicKey: string; now: Date }): KeyRotationPlan {
  if (!input.signingPublicKey || !input.encryptionPublicKey) throw new Error("Both public keys are required to rotate");
  if (input.signingPublicKey === input.encryptionPublicKey) throw new Error("Signing and encryption keys must differ");
  const state = agentMigrationStates.includes(current.migrationState as AgentMigrationState) ? (current.migrationState as AgentMigrationState) : defaultAgentMigrationState;
  const migrationState = state === "legacy" ? nextMigrationState("legacy", "begin") : state;
  const superseded = [current.signingKeyFingerprint, current.encryptionKeyFingerprint].filter((value): value is string => Boolean(value));
  return {
    keyProtocolVersion: "agent-v2",
    migrationState,
    signingPublicKey: input.signingPublicKey,
    encryptionPublicKey: input.encryptionPublicKey,
    signingKeyFingerprint: keyFingerprint(input.signingPublicKey),
    encryptionKeyFingerprint: keyFingerprint(input.encryptionPublicKey),
    previousSigningKeyFingerprint: current.signingKeyFingerprint,
    previousEncryptionKeyFingerprint: current.encryptionKeyFingerprint,
    keyRotatedAt: input.now,
    credentialVersion: (current.credentialVersion ?? 1) + 1,
    revokedKeyFingerprints: [...new Set([...(current.revokedKeyFingerprints ?? []), ...superseded])]
  };
}

export function planMigrationComplete(current: LifecycleServer): { migrationState: AgentMigrationState } {
  return { migrationState: nextMigrationState((current.migrationState as AgentMigrationState) ?? "legacy", "complete") };
}

export function planMigrationRollback(current: LifecycleServer): { migrationState: AgentMigrationState } {
  return { migrationState: nextMigrationState((current.migrationState as AgentMigrationState) ?? "legacy", "rollback") };
}

// Revoke the agent's current keys (lost agent / compromise). Both active fingerprints join the revoked
// set and the record is marked revoked so all auth fails closed.
export function planKeyRevocation(current: LifecycleServer, now: Date): { revokedAt: Date; revokedKeyFingerprints: string[] } {
  const active = [current.signingKeyFingerprint, current.encryptionKeyFingerprint].filter((value): value is string => Boolean(value));
  return { revokedAt: now, revokedKeyFingerprints: [...new Set([...(current.revokedKeyFingerprints ?? []), ...active])] };
}

// A key is unusable if the record is revoked or the presented fingerprint is in the revoked set (stale
// key after rotation, or explicitly revoked).
export function isFingerprintRevoked(current: LifecycleServer, fingerprint: string): boolean {
  return Boolean(current.revokedAt) || (current.revokedKeyFingerprints ?? []).includes(fingerprint);
}

export function summarizeFleetMigration(servers: LifecycleServer[]): { total: number; legacy: number; dual: number; v2: number } {
  const summary = { total: servers.length, legacy: 0, dual: 0, v2: 0 };
  for (const server of servers) summary[describeAgentCredential(server).migrationState] += 1;
  return summary;
}

// ---- Item 7: audit-safe observability. Produces a fleet + per-agent migration report built ENTIRELY
// from describeAgentCredential, so it can only ever contain fingerprints/state/version — never raw
// public keys, the legacy secret hash, or any private material, regardless of the input shape. ----
export type AgentMigrationReport = {
  fleet: { total: number; legacy: number; dual: number; v2: number };
  agents: Array<{ id: string; hostname: string } & AgentCredentialStatus>;
};

export function buildMigrationReport(servers: Array<LifecycleServer & { id: string; hostname: string }>): AgentMigrationReport {
  return {
    fleet: summarizeFleetMigration(servers),
    agents: servers.map((server) => ({ id: server.id, hostname: server.hostname, ...describeAgentCredential(server) }))
  };
}

// ---- Item 2: fail-safe flag-off (v1-only) rollback preflight. Disabling v2 is safe ONLY while every
// active agent can fall back to a usable v1 credential. An agent enrolled fresh as v2, or one whose
// legacy credential was invalidated, would be stranded — so a v1-only state must be refused. ----
export type FlagOffServer = { id: string; hostname: string; keyProtocolVersion?: string; migrationState?: string; legacyCredentialUsable?: boolean; revokedAt?: Date; archivedAt?: Date };
export type FlagOffSafety = { safe: boolean; strandedAgents: Array<{ id: string; hostname: string; reason: string }> };

export function evaluateFlagOffSafety(servers: FlagOffServer[]): FlagOffSafety {
  const stranded: Array<{ id: string; hostname: string; reason: string }> = [];
  for (const server of servers) {
    if (server.revokedAt || server.archivedAt) continue; // inactive agents cannot be stranded
    const state = describeAgentCredential(server).migrationState;
    const usesV2 = state === "v2" || state === "dual" || server.keyProtocolVersion === "agent-v2";
    if (usesV2 && server.legacyCredentialUsable === false) {
      stranded.push({ id: server.id, hostname: server.hostname, reason: state === "dual" ? "dual agent without usable v1 credential" : "enrolled fresh as v2 / legacy credential invalidated" });
    }
  }
  return { safe: stranded.length === 0, strandedAgents: stranded };
}

// Throws (fail closed) if disabling v2 would strand any agent. Call at startup when the flag is OFF.
export function assertFlagOffRollbackSafe(servers: FlagOffServer[]): void {
  const result = evaluateFlagOffSafety(servers);
  if (!result.safe) throw new Error(`Refusing v1-only (agent-v2 disabled): ${result.strandedAgents.length} agent(s) have no usable v1 credential and would be stranded: ${result.strandedAgents.map((a) => a.hostname).join(", ")}. Re-enable agent-v2 or perform a state rollback to the last v2-capable release.`);
}
