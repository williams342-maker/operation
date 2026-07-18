export type CalculatedAgentStatus = "never_connected" | "online" | "degraded" | "offline" | "revoked";

export function calculateAgentStatus(lastHeartbeatAt?: Date, revokedAt?: Date, now = new Date()): CalculatedAgentStatus {
  if (revokedAt) return "revoked";
  if (!lastHeartbeatAt) return "never_connected";
  const age = now.getTime() - lastHeartbeatAt.getTime();
  if (age <= 2 * 60_000) return "online";
  if (age <= 5 * 60_000) return "degraded";
  return "offline";
}

export function publicSiteStatus(httpStatus: number, redirected: boolean) {
  if (redirected) return "redirecting" as const;
  return httpStatus >= 100 && httpStatus < 500 ? "reachable" as const : "unreachable" as const;
}
