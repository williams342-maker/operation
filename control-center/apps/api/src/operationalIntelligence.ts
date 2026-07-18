import type { AiAssistantResponse, AiEvidence, OperationalSourceType } from "@control-center/shared";

export type OperationalSection = { key: string; timestamp: string; freshness: "fresh" | "aging" | "stale" | "unavailable"; source: string; confidence: "low" | "medium" | "high"; complete: boolean; data: unknown };
export type OperationalSnapshot = { generatedAt: string; scope: { type: "server" | "application"; id: string; label: string }; sections: OperationalSection[]; rejectedSections: Array<{ key: string; reason: "stale" | "incomplete" | "unavailable" }> };
export type OperationalEvent = { id: string; type: OperationalSourceType; timestamp: string | Date; summary: string; status?: string; errorCategory?: string; tags?: string[]; orgId?: string };

const MINUTE = 60_000;
export function classifyFreshness(timestamp: string | Date | undefined, now = new Date(), freshMs = 2 * MINUTE, staleMs = 15 * MINUTE): OperationalSection["freshness"] {
  if (!timestamp) return "unavailable";
  const age = now.getTime() - new Date(timestamp).getTime();
  if (!Number.isFinite(age) || age < -MINUTE) return "unavailable";
  return age <= freshMs ? "fresh" : age <= staleMs ? "aging" : "stale";
}

export function normalizeSection(input: { key: string; timestamp?: string | Date; source: string; data: unknown; complete?: boolean; freshMs?: number; staleMs?: number }, now = new Date()): OperationalSection {
  const freshness = classifyFreshness(input.timestamp, now, input.freshMs, input.staleMs);
  const complete = input.complete !== false && input.data !== undefined && input.data !== null;
  const confidence = !complete || freshness === "unavailable" || freshness === "stale" ? "low" : freshness === "fresh" ? "high" : "medium";
  return { key: input.key, timestamp: input.timestamp ? new Date(input.timestamp).toISOString() : now.toISOString(), freshness, source: input.source, confidence, complete, data: input.data ?? null };
}

export function buildOperationalSnapshot(scope: OperationalSnapshot["scope"], sections: OperationalSection[], now = new Date()): OperationalSnapshot {
  const rejectedSections = sections.filter((section) => !section.complete || section.freshness === "stale" || section.freshness === "unavailable").map((section) => ({ key: section.key, reason: !section.complete ? "incomplete" as const : section.freshness === "stale" ? "stale" as const : "unavailable" as const }));
  return { generatedAt: now.toISOString(), scope, sections: sections.filter((section) => !rejectedSections.some((item) => item.key === section.key)), rejectedSections };
}

function values(data: unknown) { return typeof data === "object" && data ? data as Record<string, any> : {}; }
export function snapshotEvidence(snapshot: OperationalSnapshot): AiEvidence[] {
  return snapshot.sections.flatMap((section) => {
    const data = values(section.data); const evidence: AiEvidence[] = [];
    const add = (sourceType: OperationalSourceType, label: string, value: unknown) => evidence.push({ sourceType, label, value: String(value), timestamp: section.timestamp, freshness: section.freshness, source: section.source, confidence: section.confidence });
    if (section.key === "server") { add("server", "Server status", data.agentStatus || data.status || "unknown"); if (data.lastHeartbeatAt) add("agent_heartbeat", "Agent heartbeat", data.lastHeartbeatAt); }
    if (section.key === "metrics") { if (data.cpu?.usagePercent != null) add("metrics", "CPU", `${Math.round(data.cpu.usagePercent)}%`); if (data.memory?.usedBytes != null && data.memory?.totalBytes) add("metrics", "Memory", `${Math.round(data.memory.usedBytes / data.memory.totalBytes * 100)}%`); if (Array.isArray(data.disk)) add("metrics", "Disk volumes", data.disk.length); if (data.network) add("metrics", "Network telemetry", "available"); }
    if (section.key === "containers") add("containers", "Running containers", Array.isArray(section.data) ? section.data.length : 0);
    if (section.key === "compose") add("compose", "Compose services", Array.isArray(section.data) ? section.data.length : 0);
    if (section.key === "services") add("services", "Running services", Array.isArray(section.data) ? section.data.length : 0);
    if (section.key === "discovery") { add("discovery", "Applications discovered", data.applications?.length || 0); add("discovery", "Repositories discovered", data.repositories?.length || 0); add("discovery", "Compose projects discovered", data.composeProjects?.length || 0); }
    if (section.key === "git") { const row = Array.isArray(section.data) ? section.data[0] || {} : data; add("git", "Current branch", row.branch || "unknown"); add("git", "Last commit", row.commit || "unknown"); add("git", "Working tree", row.dirty ? "uncommitted files" : "clean"); }
    if (section.key === "health") for (const row of (data.health || [])) add("health_check", row.name || "Health check", row.lastResult?.success === true ? "healthy" : row.lastResult?.success === false ? `unhealthy${row.lastResult.errorCategory ? ` (${row.lastResult.errorCategory})` : ""}` : "unknown");
    if (["deployments", "rollbacks", "failures", "alerts", "audit", "scheduledTasks", "rateLimit", "aiUsage", "ci", "logs"].includes(section.key)) add(({ deployments: "deployment", rollbacks: "rollback", failures: "failure", alerts: "alert", audit: "audit", scheduledTasks: "scheduled_task", rateLimit: "rate_limit", aiUsage: "ai_usage", ci: "ci_summary", logs: "logs" } as Record<string, OperationalSourceType>)[section.key], section.key, Array.isArray(section.data) ? `${section.data.length} records` : JSON.stringify(section.data).slice(0, 500));
    return evidence;
  }).slice(0, 50);
}

export function rankRootCauses(evidence: AiEvidence[]) {
  const text = evidence.map((item) => `${item.label} ${item.value}`.toLowerCase());
  const rules = [
    { title: "Missing environment variable", score: 0.92, patterns: [/missing env/, /environment variable/, /configuration/, /undefined variable/] },
    { title: "Health timeout", score: 0.76, patterns: [/timeout/, /timed out/, /unhealthy/] },
    { title: "Resource exhaustion", score: 0.72, patterns: [/cpu (9\d|100)%/, /memory (9\d|100)%/, /disk.*(9\d|100)%/, /out of memory/] },
    { title: "Failed deployment", score: 0.68, patterns: [/deploy.*fail/, /rollback/] },
    { title: "Port conflict", score: 0.31, patterns: [/port.*conflict/, /address already in use/, /eaddrinuse/] }
  ];
  return rules.map((rule) => ({ title: rule.title, score: rule.score, evidence: evidence.filter((_item, index) => rule.patterns.some((pattern) => pattern.test(text[index]))).map((item) => `${item.label}: ${item.value}`).slice(0, 10) })).filter((item) => item.evidence.length).sort((a, b) => b.score - a.score);
}

export function generateTimeline(events: OperationalEvent[]) { return [...events].filter((event) => Number.isFinite(new Date(event.timestamp).getTime())).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).slice(-50).map((event) => ({ timestamp: new Date(event.timestamp).toISOString(), event: event.summary, source: event.type, confidence: "high" as const })); }
export function findSimilarIncidents(current: OperationalEvent, previous: OperationalEvent[], organizationId: string) {
  const tokens = new Set(`${current.summary} ${current.errorCategory || ""} ${(current.tags || []).join(" ")}`.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  return previous.filter((item) => item.orgId === organizationId && item.id !== current.id).map((item) => { const other = new Set(`${item.summary} ${item.errorCategory || ""} ${(item.tags || []).join(" ")}`.toLowerCase().match(/[a-z0-9]{3,}/g) || []); const common = [...tokens].filter((token) => other.has(token)).length; const similarity = common / Math.max(1, new Set([...tokens, ...other]).size); return { id: item.id, summary: item.summary, similarity: Number(similarity.toFixed(2)), timestamp: new Date(item.timestamp).toISOString() }; }).filter((item) => item.similarity >= 0.2).sort((a, b) => b.similarity - a.similarity).slice(0, 10);
}
export function scoreConfidence(evidence: AiEvidence[]) { const usable = evidence.filter((item) => item.freshness !== "stale" && item.freshness !== "unavailable"); const sources = new Set(usable.map((item) => item.sourceType)).size; const conflicts = usable.some((item, index) => usable.some((other, otherIndex) => index !== otherIndex && item.label === other.label && item.value !== other.value)); return conflicts || usable.length < 2 ? "low" as const : sources >= 3 && usable.filter((item) => item.freshness === "fresh").length >= 3 ? "high" as const : "medium" as const; }

export function summarizeLogs(lines: string[], limit = 100) { const groups = new Map<string, { message: string; count: number; severity: "error" | "warning" | "info"; category?: string }>(); for (const raw of lines.slice(-1000)) { const line = raw.trim(); if (!line || /^\s+at\s/.test(line)) continue; const normalized = line.replace(/\b\d+\b/g, "#").slice(0, 500); const severity = /error|fatal|exception/i.test(line) ? "error" : /warn/i.test(line) ? "warning" : "info"; const category = /timeout/i.test(line) ? "timeout" : /out of memory|enomem|disk full/i.test(line) ? "resource_exhaustion" : /config|environment variable|missing env/i.test(line) ? "configuration" : undefined; const found = groups.get(normalized); if (found) found.count++; else groups.set(normalized, { message: line.slice(0, 500), count: 1, severity, category }); } return [...groups.values()].sort((a, b) => (a.severity === "error" ? -2 : a.severity === "warning" ? -1 : 0) - (b.severity === "error" ? -2 : b.severity === "warning" ? -1 : 0) || b.count - a.count).slice(0, limit); }
export function analyzeDeployment(deployment: Record<string, any>, project?: Record<string, any>) { return { affectedServices: deployment.serviceNames || project?.serviceNames || [], dependencies: deployment.dependencies || [], databases: deployment.databases || [], expectedDowntime: deployment.expectedDowntime || "unknown", rollbackAvailable: Boolean(deployment.rollbackTaskId || deployment.previousVersion || deployment.rollbackAvailable), knownRisks: deployment.knownRisks || [] }; }
export function analyzeCiRun(run: Record<string, any>) { const jobs = Array.isArray(run.jobs) ? run.jobs : []; return { conclusion: run.conclusion || run.status || "unknown", failedJobs: jobs.filter((job: any) => ["failure", "failed"].includes(job.conclusion || job.status)).map((job: any) => job.name), failingTests: jobs.flatMap((job: any) => job.failingTests || []), warnings: jobs.flatMap((job: any) => job.warnings || []), runnerIssues: jobs.filter((job: any) => /runner|machine|hosted/i.test(job.error || "")).map((job: any) => job.error), cacheProblems: jobs.filter((job: any) => /cache/i.test(job.error || "")).map((job: any) => job.error), artifactFailures: jobs.filter((job: any) => /artifact/i.test(job.error || "")).map((job: any) => job.error) }; }

export function deterministicRecommendations(causes: ReturnType<typeof rankRootCauses>, evidence: AiEvidence[]): AiAssistantResponse["recommendedSteps"] { if (!evidence.length) return []; return (causes.length ? causes : [{ title: "Current operational state", score: 0, evidence: evidence.slice(0, 3).map((item) => `${item.label}: ${item.value}`) }]).slice(0, 5).map((cause, index) => ({ order: index + 1, title: `Verify ${cause.title.toLowerCase()}`, description: "Review the cited OpsWorkbench evidence and perform a read-only diagnostic check before considering any change.", classification: index === 0 ? "low_risk_diagnostic" : "medium_risk_investigation", evidence: cause.evidence, actionType: "manual_diagnostic" })); }

export class OperationalContextCache<T> { private entries = new Map<string, { value: T; expiresAt: number }>(); constructor(private ttlMs = 30_000) {} get(key: string, now = Date.now()) { const entry = this.entries.get(key); if (!entry || entry.expiresAt <= now) { this.entries.delete(key); return undefined; } return entry.value; } set(key: string, value: T, now = Date.now()) { this.entries.set(key, { value, expiresAt: now + this.ttlMs }); } invalidate(scopeId?: string) { if (!scopeId) return this.entries.clear(); for (const key of this.entries.keys()) if (key.includes(scopeId)) this.entries.delete(key); } }
