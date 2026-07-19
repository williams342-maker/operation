export type DiscoveryUiState = "loading" | "success" | "empty" | "stale" | "truncated" | "partial" | "permission_denied" | "agent_incompatible" | "discovery_failed" | "agent_offline";
export function discoveryUiState(input: { loading?: boolean; errorStatus?: number; agentStatus?: string; discovery?: any; now?: number }): DiscoveryUiState {
  if (input.loading) return "loading";
  if (input.errorStatus === 401 || input.errorStatus === 403) return "permission_denied";
  if (input.errorStatus) return "discovery_failed";
  if (input.agentStatus && input.agentStatus !== "online") return "agent_offline";
  if (!input.discovery) return "agent_incompatible";
  if (input.discovery.discoveryTruncated) return "truncated";
  if (input.discovery.warnings?.length) return "partial";
  if ((input.now ?? Date.now()) - new Date(input.discovery.collectedAt).getTime() > 120_000) return "stale";
  if (!input.discovery.dockerInstalled && !input.discovery.nginxInstalled && !input.discovery.repositories?.length && !input.discovery.composeProjects?.length && !input.discovery.applications?.length) return "empty";
  return "success";
}
