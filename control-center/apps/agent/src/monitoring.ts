import type { HttpMonitoringTarget } from "@control-center/shared";

type ScheduleEntry = {
  fingerprint: string;
  nextDueAt: number;
};

const schedule = new Map<string, ScheduleEntry>();

function fingerprint(check: HttpMonitoringTarget) {
  return [check.url, check.timeoutMs, check.expectedStatus, check.intervalSeconds].join("\n");
}

export function dueHttpMonitoringChecks(checks: HttpMonitoringTarget[], now = Date.now()) {
  const configured = new Set(checks.map((check) => check.id));
  for (const id of schedule.keys()) if (!configured.has(id)) schedule.delete(id);

  return checks.filter((check) => {
    const currentFingerprint = fingerprint(check);
    const entry = schedule.get(check.id);
    if (entry && entry.fingerprint === currentFingerprint && entry.nextDueAt > now) return false;
    schedule.set(check.id, {
      fingerprint: currentFingerprint,
      nextDueAt: now + check.intervalSeconds * 1000
    });
    return true;
  });
}

export function resetHttpMonitoringSchedule() {
  schedule.clear();
}
