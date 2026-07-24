import { useQuery } from "@tanstack/react-query";
import type { ProjectDeploymentHistoryItem, ProjectHistoryResponse, ProjectRollbackHistoryItem } from "@control-center/shared";
import { api, apiError } from "./api";
import { Badge, Card, Skeleton } from "./ui";

const when = (value?: string) => value ? new Date(value).toLocaleString() : "Unavailable";
const tone = (status: string): "neutral" | "success" | "danger" | "warning" => status === "succeeded" ? "success" : status === "failed" ? "danger" : status === "cancelled" || status === "rolled_back" ? "warning" : "neutral";

export function ProjectHistoryPage({ projectId, kind, navigate }: { projectId: string; kind: "deployments" | "rollbacks"; navigate: (path: string) => void }) {
  const query = useQuery({ queryKey: ["project-history", projectId, kind], queryFn: () => api.get(`/projects/${projectId}/${kind}?limit=20`).then((response) => response.data as ProjectHistoryResponse<ProjectDeploymentHistoryItem | ProjectRollbackHistoryItem>), retry: false });
  if (query.isLoading) return <Skeleton />;
  if (query.error) return <Card><h2 className="font-semibold">History unavailable</h2><p role="alert" className="mt-2 text-sm text-danger">{apiError(query.error)}</p></Card>;
  const data = query.data!;

  return <div className="space-y-4" data-testid={`project-${kind}-history`}>
    <Card>
      <div className="text-xs text-muted">Project workspace</div>
      <h2 className="text-xl font-semibold">{data.project.name}</h2>
      {data.project.archived && <Badge tone="warning">Archived</Badge>}
      <nav aria-label="Project workspace" className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate(`/projects/${projectId}/overview`)}>Overview</button>
        <button aria-current={kind === "deployments" ? "page" : undefined} className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate(`/projects/${projectId}/deployments`)}>Deployments</button>
        <button aria-current={kind === "rollbacks" ? "page" : undefined} className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate(`/projects/${projectId}/rollbacks`)}>Rollbacks</button>
        <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => navigate(`/configuration?projectId=${encodeURIComponent(projectId)}`)}>Environment</button>
        <button disabled title="Planned" className="rounded-md border border-border px-3 py-2 text-sm text-muted opacity-60">Logs · Planned</button>
      </nav>
    </Card>
    {kind === "deployments" && <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Deployment Manager foundation</h3>
          <p className="text-sm text-muted">Select Git revision, preflight, deploy, health verification, and automatic rollback will be enabled in a separately reviewed execution slice.</p>
        </div>
        <Badge tone="warning">Planning only</Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">Git revision<input aria-label="Git revision" disabled className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm opacity-70" placeholder="Select after deployment execution is enabled" /></label>
        <label className="text-sm">Environment<input aria-label="Deployment environment" disabled className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm opacity-70" value="Non-production only" readOnly /></label>
        <label className="text-sm">Health gate<input aria-label="Health gate" disabled className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm opacity-70" value="Required" readOnly /></label>
        <label className="text-sm">Rollback<input aria-label="Rollback policy" disabled className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm opacity-70" value="Automatic on failure" readOnly /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled title="Requires separate deployment execution authorization" className="rounded-md border border-border px-3 py-2 text-sm text-muted opacity-60">Run preflight</button>
        <button disabled title="Requires separate deployment execution authorization" className="rounded-md border border-border px-3 py-2 text-sm text-muted opacity-60">Create deployment plan</button>
      </div>
    </Card>}
    <Card>
      <h3 className="font-semibold">{kind === "deployments" ? "Deployment history" : "Rollback history"}</h3>
      {!data.records.length ? <p className="mt-3 text-sm text-muted">No authoritative {kind} have been recorded.</p> : <div className="mt-3 space-y-3">{data.records.map((record) => <article key={record.id} className="rounded border border-border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{"requestedRevision" in record ? record.releaseId || record.requestedRevision : record.restoredReleaseId || record.sourceDeploymentId}</strong><Badge tone={tone(record.status)}>{record.status}</Badge></div><dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-muted">Server</dt><dd>{record.server.name || record.server.id}</dd></div><div><dt className="text-muted">Started</dt><dd>{when(record.startedAt)}</dd></div><div><dt className="text-muted">Completed</dt><dd>{when(record.completedAt)}</dd></div>{"requestedRevision" in record ? <><div><dt className="text-muted">Revision</dt><dd className="break-all">{record.deployedRevision || record.requestedRevision}</dd></div><div><dt className="text-muted">Branch</dt><dd>{record.branch || "Unavailable"}</dd></div><div><dt className="text-muted">Validation</dt><dd>{record.validation.health} / {record.validation.readiness}</dd></div><div><dt className="text-muted">Rollback</dt><dd>{record.rollbackAvailable ? "Available" : "Unavailable"}</dd></div></> : <><div><dt className="text-muted">Source deployment</dt><dd className="break-all">{record.sourceDeploymentId}</dd></div><div><dt className="text-muted">Verification</dt><dd>{record.verification.health} / {record.verification.readiness}</dd></div></>}<div><dt className="text-muted">Failure classification</dt><dd>{record.failureClassification || "None"}</dd></div></dl></article>)}</div>}
      {data.hasMore && <p className="mt-3 text-xs text-muted">Showing the newest {data.limit} authoritative records.</p>}
    </Card>
  </div>;
}
