import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectOverviewPage } from "../src/ProjectOverviewPage";
import { api } from "../src/api";

api.get = async () => ({ data: {
  schemaVersion: "project-overview-v1", generatedAt: new Date().toISOString(),
  project: { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Acceptance Project", slug: "acceptance-project", archived: false, repository: "owner/repository", configuredBranch: "main" },
  environment: { name: "Staging", kind: "staging", protected: true, state: "configured" },
  server: { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Acceptance server", enrollmentStatus: "connected", agentStatus: "online", lastHeartbeatAt: new Date().toISOString(), freshness: "fresh", capabilities: ["docker", "compose", "git", "http"], limitations: [] },
  revision: { configuredBranch: "main", discoveredBranch: "main", observedBranch: "main", discoveredCommit: "abcdef1234567890", observedCommit: "abcdef1", evidenceAt: new Date().toISOString(), confidence: "observed", conflicts: [] },
  services: [{ name: "web", state: "running", health: "healthy", image: "example/web:staging", source: "docker", evidenceAt: new Date().toISOString(), freshness: "fresh" }],
  health: [{ id: "cccccccccccccccccccccccc", name: "Public health", success: true, statusCode: 200, checkedAt: new Date().toISOString(), freshness: "fresh" }],
  recent: { tasks: [], audit: [] }, availability: { releases: "unavailable", deployments: "unavailable", rollbacks: "unavailable", logs: "unavailable" }, limitations: []
} });

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><main className="min-h-screen bg-background p-4 text-text"><ProjectOverviewPage projectId="aaaaaaaaaaaaaaaaaaaaaaaa" canViewAudit navigate={() => undefined} /></main></QueryClientProvider>);
