export const DEFAULT_TELEMETRY_RETENTION_DAYS = 14;
export const DEFAULT_HEARTBEAT_STALE_SECONDS = 90;

export function isHeartbeatStale(lastHeartbeatAt: Date | string | undefined, now = new Date(), staleSeconds = DEFAULT_HEARTBEAT_STALE_SECONDS) {
  if (!lastHeartbeatAt) return true;
  const last = typeof lastHeartbeatAt === "string" ? new Date(lastHeartbeatAt) : lastHeartbeatAt;
  return now.getTime() - last.getTime() > staleSeconds * 1000;
}

export function retentionCutoff(now = new Date(), days = DEFAULT_TELEMETRY_RETENTION_DAYS) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
