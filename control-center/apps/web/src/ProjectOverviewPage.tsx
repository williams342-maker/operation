import { useQuery } from "@tanstack/react-query";
import type { ProjectOverview } from "@control-center/shared";
import { api, apiError } from "./api";
import { Badge, Card, Skeleton } from "./ui";

const when = (value?: string) => value ? new Date(value).toLocaleString() : "Unavailable";
const unavailable = [
  ["Environment", "Environment management is planned; no runtime environment is inferred."],
  ["Releases", "Authoritative application releases are not implemented."],
  ["Logs", "Secure project log collection is not implemented."]
];

export function ProjectOverviewPage({ projectId, canViewAudit, navigate }: { projectId: string; canViewAudit: boolean; navigate: (path: string) => void }) {
  const query = useQuery<ProjectOverview>({ queryKey: ["project-overview", projectId], queryFn: () => api.get(`/projects/${projectId}/overview`).then((response) => response.data), retry: false });
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
        {unavailable.map(([name]) => <button key={name} disabled title="Planned" className="rounded-md border border-border px-3 py-2 text-sm text-muted opacity-60">{name} · Planned</button>)}
        <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate("/tasks")}>Tasks</button>
        {canViewAudit && <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate("/audit")}>Audit</button>}
        <button disabled title="Future capability" className="rounded-md border border-border px-3 py-2 text-sm text-muted opacity-60">Builder · Future</button>
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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card><h3 className="font-semibold">Deployments</h3><Badge tone={data.availability.deployments === "available" ? "success" : "warning"}>{data.availability.deployments === "available" ? `${data.recent.deployments.length} recent` : "Unavailable"}</Badge><p className="mt-2 text-sm text-muted">{data.availability.deployments === "available" ? "Authoritative deployment records are available." : "No authoritative deployment records exist."}</p></Card><Card><h3 className="font-semibold">Rollbacks</h3><Badge tone={data.availability.rollbacks === "available" ? "success" : "warning"}>{data.availability.rollbacks === "available" ? `${data.recent.rollbacks.length} recent` : "Unavailable"}</Badge><p className="mt-2 text-sm text-muted">{data.availability.rollbacks === "available" ? "Authoritative rollback records are available." : "No authoritative rollback records exist."}</p></Card>{unavailable.filter(([name]) => name !== "Environment").map(([name, description]) => <Card key={name}><h3 className="font-semibold">{name}</h3><Badge tone="warning">Unavailable</Badge><p className="mt-2 text-sm text-muted">{description}</p></Card>)}</div>
  </div>;
}
