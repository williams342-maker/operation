import { useQuery } from "@tanstack/react-query";
import type { ProjectOverview } from "@control-center/shared";
import { api, apiError } from "./api";
import { Badge, Card, Skeleton } from "./ui";

const when = (value?: string) => value ? new Date(value).toLocaleString() : "Unavailable";
const unavailable = [
  ["Releases", "Authoritative application releases are not implemented."],
  ["Logs", "Secure project log collection is not implemented."]
];
type BurnInStatus = {
  policy: { profile: string; observation: { minimumHours: number } };
  enabledHealthChecks: number;
  observation: {
    state: "pending" | "observing" | "complete";
    observationStartedAt?: string;
    minimumCompletesAt?: string;
    completionPercent: number;
    lastResetAt?: string;
    lastResetReasons: string[];
    sampleCount: number;
    metrics: { availabilityPercent: number; httpErrorRatePercent: number; p95LatencyMs: number; maximumAgentHeartbeatGapSeconds: number; maximumDiskPercent: number; unexpectedRestarts: number; criticalAlerts: number };
  };
};

export function ProjectOverviewPage({ projectId, canViewAudit, navigate }: { projectId: string; canViewAudit: boolean; navigate: (path: string) => void }) {
  const query = useQuery<ProjectOverview>({ queryKey: ["project-overview", projectId], queryFn: () => api.get(`/projects/${projectId}/overview`).then((response) => response.data), retry: false });
  const burnIn = useQuery<BurnInStatus>({ queryKey: ["project-burn-in", projectId], queryFn: () => api.get(`/projects/${projectId}/burn-in`).then((response) => response.data), retry: false, refetchInterval: 30_000 });
  if (query.isLoading) return <Skeleton />;
  if (query.error) return <Card><h2 className="font-semibold">Project unavailable</h2><p role="alert" className="mt-2 text-sm text-danger">{apiError(query.error)}</p><button className="mt-3 text-sm text-primary underline" onClick={() => navigate("/projects")}>Return to Projects</button></Card>;
  const data = query.data!;
  return <div className="space-y-4" data-testid="project-overview">
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs text-muted">Project workspace</div><h2 className="text-xl font-semibold">{data.project.name}</h2><p className="text-sm text-muted">{data.project.slug}{data.environment.name ? ` · ${data.environment.name}` : ""}</p></div><div className="flex gap-2"><Badge tone={data.project.archived ? "warning" : "success"}>{data.project.archived ? "Archived" : data.server.agentStatus}</Badge><Badge>{data.revision.confidence}</Badge></div></div>
      <nav aria-label="Project workspace" className="mt-4 flex flex-wrap gap-2">
        <button aria-current="page" className="rounded-md bg-primary px-3 py-2 text-sm text-background">Overview</button>
        <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate(`/projects/${projectId}/deployments`)}>Deployments</button>
        <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate(`/projects/${projectId}/rollbacks`)}>Rollbacks</button>
        <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate(`/configuration?projectId=${encodeURIComponent(projectId)}`)}>Environment</button>
        {unavailable.map(([name]) => <button key={name} disabled title="Planned" className="rounded-md border border-border px-3 py-2 text-sm text-muted opacity-60">{name} · Planned</button>)}
        <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate("/tasks")}>Tasks</button>
        {canViewAudit && <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate("/audit")}>Audit</button>}
        <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate(`/projects/${projectId}/builder`)}>Website Builder</button>
      </nav>
    </Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><h3 className="font-semibold">Project identity</h3><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted">Repository</dt><dd>{data.project.repository || "Unavailable"}</dd></div><div><dt className="text-muted">Configured branch</dt><dd>{data.project.configuredBranch || "Unavailable"}</dd></div><div><dt className="text-muted">Server</dt><dd>{data.server.name || "Unavailable"}</dd></div><div><dt className="text-muted">Enrollment</dt><dd>{data.server.enrollmentStatus}</dd></div></dl></Card>
      <Card><h3 className="font-semibold">Agent status</h3><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted">State</dt><dd>{data.server.agentStatus}</dd></div><div><dt className="text-muted">Heartbeat freshness</dt><dd>{data.server.freshness}</dd></div><div><dt className="text-muted">Last heartbeat</dt><dd>{when(data.server.lastHeartbeatAt)}</dd></div><div><dt className="text-muted">Capabilities</dt><dd>{data.server.capabilities.length ? data.server.capabilities.join(", ") : "Unavailable"}</dd></div></dl></Card>
      <Card><h3 className="font-semibold">Revision evidence</h3><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted">Configured</dt><dd>{data.revision.configuredBranch || "Unavailable"}</dd></div><div><dt className="text-muted">Discovered checkout</dt><dd>{data.revision.discoveredBranch || "Unavailable"}</dd></div><div><dt className="text-muted">Observed checkout</dt><dd>{data.revision.observedBranch || "Unavailable"}</dd></div><div><dt className="text-muted">Observed revision</dt><dd className="break-all">{data.revision.observedCommit || "Unavailable"}</dd></div><div><dt className="text-muted">Evidence time</dt><dd>{when(data.revision.evidenceAt)}</dd></div><div><dt className="text-muted">Confidence</dt><dd>{data.revision.confidence}{data.revision.conflicts.length ? ` (${data.revision.conflicts.join(", ")})` : ""}</dd></div></dl><p className="mt-3 text-xs text-muted">Observed and discovered Git state is not a cryptographically verified runtime release.</p></Card>
      <Card><h3 className="font-semibold">Services and health</h3>{!data.services.length && !data.health.length ? <p className="mt-3 text-sm text-muted">No current service or health evidence.</p> : <div className="mt-3 space-y-2 text-sm">{data.services.map((service) => <div key={`${service.source}-${service.name}`} className="rounded border border-border p-2"><strong>{service.name}</strong> · {service.state} · {service.health}<div className="text-xs text-muted">{service.source} · {service.freshness} · {when(service.evidenceAt)}</div></div>)}{data.health.map((check) => <div key={check.id} className="rounded border border-border p-2"><strong>{check.name}</strong> · {check.success === true ? "healthy" : check.success === false ? "unhealthy" : "unknown"}<div className="text-xs text-muted">{check.freshness} · {when(check.checkedAt)}</div></div>)}</div>}</Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><h3 className="font-semibold">Recent tasks</h3>{data.recent.tasks?.length ? <ul className="mt-3 space-y-2 text-sm">{data.recent.tasks.map((task) => <li key={task.id} className="rounded border border-border p-2"><strong>{task.type}</strong> · {task.state}<div>{task.summary || "No result summary"}</div><div className="text-xs text-muted">{task.target} · {when(task.completedAt || task.startedAt)}</div></li>)}</ul> : <p className="mt-3 text-sm text-muted">{data.recent.tasks === null ? "Not authorized" : "No recent tasks"}</p>}</Card>
      <Card><h3 className="font-semibold">Recent audit activity</h3>{data.recent.audit?.length ? <ul className="mt-3 space-y-2 text-sm">{data.recent.audit.map((event) => <li key={event.id} className="rounded border border-border p-2"><strong>{event.action}</strong> · {event.result}<div className="text-xs text-muted">{event.actor} · {when(event.timestamp)}</div></li>)}</ul> : <p className="mt-3 text-sm text-muted">{data.recent.audit === null ? "Not authorized" : "No recent audit activity"}</p>}</Card>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card><h3 className="font-semibold">Deployments</h3><Badge tone={data.availability.deployments === "available" ? "success" : "warning"}>{data.availability.deployments === "available" ? `${data.recent.deployments.length} recent` : "Unavailable"}</Badge><p className="mt-2 text-sm text-muted">{data.availability.deployments === "available" ? "Authoritative deployment records are available." : "No authoritative deployment records exist."}</p></Card><Card><h3 className="font-semibold">Rollbacks</h3><Badge tone={data.availability.rollbacks === "available" ? "success" : "warning"}>{data.availability.rollbacks === "available" ? `${data.recent.rollbacks.length} recent` : "Unavailable"}</Badge><p className="mt-2 text-sm text-muted">{data.availability.rollbacks === "available" ? "Authoritative rollback records are available." : "No authoritative rollback records exist."}</p></Card>{unavailable.map(([name, description]) => <Card key={name}><h3 className="font-semibold">{name}</h3><Badge tone="warning">Unavailable</Badge><p className="mt-2 text-sm text-muted">{description}</p></Card>)}</div>
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Staging burn-in</h3><p className="text-sm text-muted">Policy-driven observation; production publication still requires the owner Ed25519 signature.</p></div>{burnIn.data && <Badge tone={burnIn.data.observation.state === "complete" ? "success" : burnIn.data.observation.state === "observing" ? "warning" : "danger"}>{burnIn.data.observation.state}</Badge>}</div>
      {burnIn.isLoading ? <p className="mt-3 text-sm text-muted">Loading burn-in evidence…</p> : burnIn.error ? <p role="alert" className="mt-3 text-sm text-danger">Burn-in evidence is unavailable.</p> : burnIn.data && <div className="mt-3 space-y-3">
        <div className="h-2 overflow-hidden rounded bg-border" aria-label="Burn-in progress"><div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, burnIn.data.observation.completionPercent))}%` }} /></div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted">Window start</dt><dd>{when(burnIn.data.observation.observationStartedAt)}</dd></div><div><dt className="text-muted">Earliest completion</dt><dd>{when(burnIn.data.observation.minimumCompletesAt)}</dd></div><div><dt className="text-muted">Availability</dt><dd>{burnIn.data.observation.metrics.availabilityPercent.toFixed(3)}%</dd></div><div><dt className="text-muted">HTTP error rate</dt><dd>{burnIn.data.observation.metrics.httpErrorRatePercent.toFixed(3)}%</dd></div><div><dt className="text-muted">p95 latency</dt><dd>{burnIn.data.observation.metrics.p95LatencyMs.toFixed(0)} ms</dd></div><div><dt className="text-muted">Max heartbeat gap</dt><dd>{burnIn.data.observation.metrics.maximumAgentHeartbeatGapSeconds.toFixed(1)} s</dd></div><div><dt className="text-muted">Max disk use</dt><dd>{burnIn.data.observation.metrics.maximumDiskPercent.toFixed(2)}%</dd></div><div><dt className="text-muted">Restarts / critical alerts</dt><dd>{burnIn.data.observation.metrics.unexpectedRestarts} / {burnIn.data.observation.metrics.criticalAlerts}</dd></div></dl>
        <p className="text-xs text-muted">{burnIn.data.policy.profile} · {burnIn.data.policy.observation.minimumHours}-hour minimum · {burnIn.data.observation.sampleCount} telemetry samples · {burnIn.data.enabledHealthChecks} enabled HTTP check{burnIn.data.enabledHealthChecks === 1 ? "" : "s"}</p>
        {burnIn.data.observation.lastResetReasons.length > 0 && <p className="text-sm text-danger">Last reset {when(burnIn.data.observation.lastResetAt)}: {burnIn.data.observation.lastResetReasons.join(", ")}</p>}
      </div>}
    </Card>
  </div>;
}
