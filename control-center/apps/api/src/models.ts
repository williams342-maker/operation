import type { ObjectId } from "mongodb";
import type { AuditAction, AuditResult, Role } from "@control-center/shared";

export type BaseDoc = { _id?: ObjectId; orgId: ObjectId; createdAt: Date; updatedAt: Date };

export type OrganizationDoc = { _id?: ObjectId; name: string; slug: string; defaultTimezone?: string; status?: "active" | "suspended"; createdAt: Date; updatedAt: Date };
export type UserDoc = BaseDoc & { email: string; name: string; role: Role; passwordHash: string; disabledAt?: Date; inviteIssuedAt?: Date; mustChangePassword?: boolean };
export type SessionDoc = BaseDoc & { userId: ObjectId; csrfTokenHash: string; authenticatedAt: Date; expiresAt: Date; lastSeenAt: Date };
export type EnrollmentDoc = BaseDoc & { tokenHash: string; expiresAt: Date; usedAt?: Date; usedByAgentId?: ObjectId; createdByUserId: ObjectId; serverId?: ObjectId; revokedAt?: Date };
export type ServerDoc = BaseDoc & { name: string; hostname: string; agentId: string; agentSecretHash: string; credentialVersion: number; revokedAt?: Date; archivedAt?: Date; lastHeartbeatAt?: Date; status: "online" | "offline" | "revoked"; agentVersion?: string; allowlistedRoots?: string[]; metadata?: Record<string, string>; currentState?: { metrics?: unknown; docker?: unknown[]; compose?: unknown[]; git?: unknown[]; httpHealth?: unknown[]; mongo?: unknown[]; collectedAt?: Date } };
export type ProjectDoc = BaseDoc & { name: string; slug: string; primaryServerId: ObjectId; repoPath?: string; composePath?: string; githubRepository?: string; branch?: string; adapter?: "docker-compose"; serviceNames?: string[]; archivedAt?: Date; healthCheckIds: ObjectId[]; mongoCheckIds: ObjectId[] };
export type HealthCheckDoc = BaseDoc & { projectId: ObjectId; serverId: ObjectId; name: string; url: string; timeoutMs: number; expectedStatus?: number; intervalSeconds?: number; enabled: boolean; archivedAt?: Date; lastResult?: unknown };
export type MongoCheckDoc = BaseDoc & { projectId: ObjectId; serverId: ObjectId; name: string; databaseNameHint?: string; encryptedConnectionString?: string; secretReference?: string; secretLocation: "agent" | "api-encrypted"; enabled: boolean; archivedAt?: Date; lastResult?: unknown };
export type TelemetryDoc = BaseDoc & { serverId: ObjectId; collectedAt: Date; agentVersion: string; metrics?: unknown; docker?: unknown[]; compose?: unknown[]; git?: unknown[]; httpHealth?: unknown[]; mongo?: unknown[]; expiresAt: Date };
export type AgentNonceDoc = BaseDoc & { agentId: string; nonce: string; expiresAt: Date };
export type AuditEventDoc = { _id?: ObjectId; orgId?: ObjectId; actorType: "user" | "agent" | "system" | "anonymous"; actorId?: ObjectId | string; action: AuditAction; targetType?: string; targetId?: ObjectId | string; result: AuditResult; requestId: string; metadata?: Record<string, string | number | boolean | null>; createdAt: Date };
