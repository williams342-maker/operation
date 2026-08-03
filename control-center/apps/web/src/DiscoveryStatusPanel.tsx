import React from "react";
import type { DiscoveryUiState } from "./discoveryState";
import { Badge, Button, GhostButton } from "./ui";

const labels: Record<DiscoveryUiState, string> = { loading: "Loading", success: "Current", empty: "No applications detected", stale: "Stale", truncated: "Truncated", partial: "Partial", permission_denied: "Permission denied", agent_incompatible: "Discovery unavailable", discovery_failed: "Discovery failed", agent_offline: "Agent offline" };
export function DiscoveryStatusPanel({ state, collectedAt, onRetry, onHelp }: { state: DiscoveryUiState; collectedAt?: string; onRetry?: () => void; onHelp?: () => void }) {
  const failure = state === "permission_denied" || state === "discovery_failed";
  return <div className={`rounded-md border p-3 ${failure ? "border-danger/40" : "border-border"}`} role="status"><div className="flex flex-wrap items-center gap-2"><Badge tone={state === "success" ? "success" : failure ? "danger" : "warning"}>{labels[state]}</Badge>{collectedAt && <span className="text-xs text-muted">Last successful discovery {new Date(collectedAt).toLocaleString()}</span>}</div>{failure && <><h3 className="mt-2 font-semibold">Applications could not be refreshed</h3><p className="text-sm text-muted">{state === "permission_denied" ? "You do not have permission to view discovery data." : "The latest safe discovery report is unavailable."}</p></>}<div className="mt-2 flex gap-2">{state !== "success" && onRetry && <Button onClick={onRetry}>Retry</Button>}{onHelp && <GhostButton onClick={onHelp}>Setup Help</GhostButton>}</div></div>;
}
