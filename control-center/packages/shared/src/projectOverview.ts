export type EvidenceFreshness = "fresh" | "delayed" | "stale" | "unavailable";
export type EvidenceConfidence = "configured" | "discovered" | "observed" | "conflicting" | "unavailable";
import type { ProjectDeploymentHistoryItem, ProjectRollbackHistoryItem } from "./projectHistory.js";

export type ProjectOverview = {
  schemaVersion: "project-overview-v1";
  generatedAt: string;
  project: { id: string; name: string; slug: string; archived: boolean; repository?: string; configuredBranch?: string; paths?: { repository: string; compose?: string } };
  environment: { name?: string; kind?: string; protected?: boolean; state: "configured" | "not-configured" };
  server: { id?: string; name?: string; enrollmentStatus: string; agentStatus: string; lastHeartbeatAt?: string; freshness: EvidenceFreshness; capabilities: string[]; limitations: string[] };
  revision: { configuredBranch?: string; discoveredBranch?: string; observedBranch?: string; discoveredCommit?: string; observedCommit?: string; dirty?: boolean; evidenceAt?: string; confidence: EvidenceConfidence; conflicts: string[] };
  services: Array<{ name: string; state: string; health: "healthy" | "unhealthy" | "unknown"; image?: string; source: "compose" | "docker"; evidenceAt?: string; freshness: EvidenceFreshness }>;
  health: Array<{ id: string; name: string; success?: boolean; statusCode?: number; checkedAt?: string; freshness: EvidenceFreshness }>;
  recent: {
    tasks: Array<{ id: string; type: string; state: string; target: string; summary?: string; startedAt?: string; completedAt?: string }> | null;
    audit: Array<{ id: string; action: string; actor: string; target?: string; result: string; timestamp: string }> | null;
    deployments: ProjectDeploymentHistoryItem[];
    rollbacks: ProjectRollbackHistoryItem[];
  };
  availability: { releases: "available" | "unavailable"; deployments: "available" | "unavailable"; rollbacks: "available" | "unavailable"; logs: "unavailable" };
  limitations: string[];
};
