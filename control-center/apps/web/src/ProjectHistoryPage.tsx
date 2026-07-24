import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ProjectDeploymentHistoryItem, ProjectHistoryResponse, ProjectRollbackHistoryItem } from "@control-center/shared";
import { api, apiError } from "./api";
import { Badge, Button, Card, Field, GhostButton, Select, Skeleton } from "./ui";

const when = (value?: string) => value ? new Date(value).toLocaleString() : "Unavailable";
const tone = (status: string): "neutral" | "success" | "danger" | "warning" => status === "succeeded" ? "success" : status === "failed" ? "danger" : status === "cancelled" || status === "rolled_back" ? "warning" : "neutral";
export const shouldPollProjectHistory = (records: Array<ProjectDeploymentHistoryItem | ProjectRollbackHistoryItem>, now = Date.now()) => records.some((record) => "requestedRevision" in record && Boolean(record.approvalExpiresAt && Date.parse(record.approvalExpiresAt) > now) && (record.gitPreflight?.status === "queued" || record.gitPreflight?.status === "running"));

export function ProjectHistoryPage({ projectId, kind, navigate }: { projectId: string; kind: "deployments" | "rollbacks"; navigate: (path: string) => void }) {
  const query = useQuery({
    queryKey: ["project-history", projectId, kind],
    queryFn: () => api.get(`/projects/${projectId}/${kind}?limit=20`).then((response) => response.data as ProjectHistoryResponse<ProjectDeploymentHistoryItem | ProjectRollbackHistoryItem>),
    retry: false,
    refetchInterval: (current) => {
      const history = current.state.data as ProjectHistoryResponse<ProjectDeploymentHistoryItem | ProjectRollbackHistoryItem> | undefined;
      return history && shouldPollProjectHistory(history.records) ? 3_000 : false;
    }
  });
  const [candidateRevision, setCandidateRevision] = useState("");
  const [candidateEnvironment, setCandidateEnvironment] = useState("staging");
  const [showPlanPreview, setShowPlanPreview] = useState(false);
  const [planMessage, setPlanMessage] = useState("");
  const revisionReady = /^[a-f0-9]{7,40}$/i.test(candidateRevision.trim());
  const createPlan = useMutation({
    mutationFn: async () => api.post(`/projects/${projectId}/deployments`, { requestedRevision: candidateRevision.trim(), environment: candidateEnvironment }),
    onSuccess: async () => { setPlanMessage("Immutable deployment plan created and pending approval."); setShowPlanPreview(false); setCandidateRevision(""); await query.refetch(); },
    onError: (error) => setPlanMessage(apiError(error))
  });
  const approvePlan = useMutation({
    mutationFn: async (deployment: ProjectDeploymentHistoryItem) => api.post(`/projects/${projectId}/deployments/${deployment.id}/approve`, { planDigest: deployment.planDigest, confirm: true }),
    onSuccess: async () => { setPlanMessage("Deployment plan approved. Execution remains unavailable."); await query.refetch(); },
    onError: (error) => setPlanMessage(apiError(error))
  });
  const cancelPlan = useMutation({
    mutationFn: async (deploymentId: string) => api.post(`/projects/${projectId}/deployments/${deploymentId}/cancel`, { confirmation: "CANCEL" }),
    onSuccess: async () => { setPlanMessage("Deployment plan cancelled. No execution was queued."); await query.refetch(); },
    onError: (error) => setPlanMessage(apiError(error))
  });
  const runControlPlanePreflight = useMutation({
    mutationFn: async (deployment: ProjectDeploymentHistoryItem) => api.post(`/projects/${projectId}/deployments/${deployment.id}/preflight`, { planDigest: deployment.planDigest, confirm: true }),
    onSuccess: async () => { setPlanMessage("Control-plane preflight passed. Read-only Git preflight API is available."); await query.refetch(); },
    onError: (error) => { setPlanMessage(apiError(error)); void query.refetch(); }
  });
  const runGitPreflight = useMutation({
    mutationFn: async (deployment: ProjectDeploymentHistoryItem) => api.post(`/projects/${projectId}/deployments/${deployment.id}/git-preflight`, { planDigest: deployment.planDigest, confirm: true }),
    onSuccess: async () => { setPlanMessage("Read-only Git preflight queued. Deployment execution remains unavailable."); await query.refetch(); },
    onError: (error) => { setPlanMessage(apiError(error)); void query.refetch(); }
  });
  const lastSuccessful = useMemo(() => kind === "deployments" ? query.data?.records.find((record) => "requestedRevision" in record && record.status === "succeeded") as ProjectDeploymentHistoryItem | undefined : undefined, [kind, query.data?.records]);
  if (query.isLoading) return <Skeleton />;
  if (query.error) return <Card><h2 className="font-semibold">History unavailable</h2><p role="alert" className="mt-2 text-sm text-danger">{apiError(query.error)}</p></Card>;
  const data = query.data!;
  const approvalCurrent = (record: ProjectDeploymentHistoryItem) => Boolean(record.approvalExpiresAt && Date.parse(record.approvalExpiresAt) > Date.now());
  const gitPreflightCandidate = kind === "deployments" ? data.records.find((record) => "requestedRevision" in record && record.status === "approved" && record.controlPlanePreflight?.status === "passed" && approvalCurrent(record)) as ProjectDeploymentHistoryItem | undefined : undefined;
  const failedPreflightCandidate = kind === "deployments" ? data.records.find((record) => "requestedRevision" in record && record.status === "approved" && record.controlPlanePreflight?.status === "failed") as ProjectDeploymentHistoryItem | undefined : undefined;
  const expiredApprovalCandidate = kind === "deployments" ? data.records.find((record) => "requestedRevision" in record && record.status === "approved" && !approvalCurrent(record)) as ProjectDeploymentHistoryItem | undefined : undefined;

  return <div className="space-y-4" data-testid={`project-${kind}-history`}>
    {expiredApprovalCandidate && <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Deployment approval expired</h3><p className="text-sm text-muted">Create and independently approve a new immutable plan before running further preflight checks.</p></div><Badge tone="warning">expired</Badge></div></Card>}
    {failedPreflightCandidate && <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">Control-plane preflight blocked</h3><p className="text-sm text-muted">Resolve the failed prerequisites before running read-only Git preflight.</p></div>
        <Badge tone="danger">blocked</Badge>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{failedPreflightCandidate.controlPlanePreflight!.checks.filter((check) => !check.passed).map((check) => <li key={check.name}>{check.name.replace(/_/g, " ")}</li>)}</ul>
    </Card>}
    {gitPreflightCandidate && <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">Read-only Git preflight</h3><p className="text-sm text-muted">Verify that the exact approved revision exists in the registered repository. This does not fetch, checkout, build, or deploy.</p></div>
        <Badge>{gitPreflightCandidate.gitPreflight?.status || "not_run"}</Badge>
      </div>
      {gitPreflightCandidate.gitPreflight?.checks.length ? <p className="mt-2 break-all text-sm">{gitPreflightCandidate.gitPreflight.checks.filter((check) => check.passed).length}/{gitPreflightCandidate.gitPreflight.checks.length} checks passed{gitPreflightCandidate.gitPreflight.resolvedRevision ? ` · resolved ${gitPreflightCandidate.gitPreflight.resolvedRevision}` : ""}{gitPreflightCandidate.gitPreflight.headRevision ? ` · HEAD ${gitPreflightCandidate.gitPreflight.headRevision}` : ""}</p> : null}
      <div className="mt-3"><GhostButton disabled={runGitPreflight.isPending || !gitPreflightCandidate.planDigest || Boolean(gitPreflightCandidate.gitPreflight)} onClick={() => runGitPreflight.mutate(gitPreflightCandidate)}>Run read-only Git preflight</GhostButton></div>
    </Card>}
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
          <h3 className="font-semibold">Deployment Manager plan review</h3>
          <p className="text-sm text-muted">Draft a value-free immutable deployment plan before the separately reviewed execution slice. This page does not queue tasks, contact agents, or mutate infrastructure.</p>
        </div>
        <Badge tone="warning">Planning only</Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">Git revision<Field aria-label="Git revision" value={candidateRevision} onChange={(event) => { setCandidateRevision(event.target.value); setShowPlanPreview(false); }} placeholder="Commit SHA, 7-40 hex characters" /></label>
        <label className="text-sm">Environment<Select aria-label="Deployment environment" value={candidateEnvironment} onChange={(event) => setCandidateEnvironment(event.target.value)}><option value="staging">staging</option><option value="preview">preview</option><option value="testing">testing</option></Select></label>
        <label className="text-sm">Health gate<Field aria-label="Health gate" value="Required before completion" readOnly /></label>
        <label className="text-sm">Rollback<Field aria-label="Rollback policy" value="Automatic on failed activation" readOnly /></label>
      </div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-border p-3"><div className="text-muted">Preflight</div><div>commit, artifact, branch, worktree</div></div>
        <div className="rounded border border-border p-3"><div className="text-muted">Activation</div><div>checkpoint, backup, health, readiness</div></div>
        <div className="rounded border border-border p-3"><div className="text-muted">Rollback boundary</div><div>{lastSuccessful?.releaseId || "Last successful release unavailable"}</div></div>
        <div className="rounded border border-border p-3"><div className="text-muted">Secrets</div><div>Never displayed or written to plan preview</div></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={!revisionReady} onClick={() => setShowPlanPreview(true)}>Preview immutable plan</Button>
        <GhostButton disabled={!showPlanPreview || createPlan.isPending} onClick={() => createPlan.mutate()}>Create plan record</GhostButton>
        <GhostButton disabled title="Requires separate deployment execution authorization">Run preflight</GhostButton>
        <GhostButton disabled title="Requires separate deployment execution authorization">Queue deployment</GhostButton>
      </div>
      {!revisionReady && candidateRevision && <p role="alert" className="mt-2 text-sm text-danger">Enter a 7 to 40 character hexadecimal Git revision.</p>}
      {planMessage && <p role="status" className="mt-2 text-sm text-muted">{planMessage}</p>}
      {showPlanPreview && <div className="mt-4 rounded-md border border-border bg-background p-3 text-sm" aria-label="Immutable deployment plan preview">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>Immutable plan preview</strong><Badge>Not queued</Badge></div>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted">Project</dt><dd>{data.project.name}</dd></div><div><dt className="text-muted">Revision</dt><dd className="break-all font-mono">{candidateRevision.trim()}</dd></div><div><dt className="text-muted">Environment</dt><dd>{candidateEnvironment}</dd></div><div><dt className="text-muted">Approval</dt><dd>Separate administrator required</dd></div><div><dt className="text-muted">Health gate</dt><dd>Required</dd></div><div><dt className="text-muted">Readiness gate</dt><dd>Required</dd></div><div><dt className="text-muted">Rollback</dt><dd>Prepared before activation</dd></div><div><dt className="text-muted">Execution</dt><dd>Unavailable in this milestone</dd></div></dl>
      </div>}
    </Card>}
    <Card>
      <h3 className="font-semibold">{kind === "deployments" ? "Deployment history" : "Rollback history"}</h3>
      {!data.records.length ? <p className="mt-3 text-sm text-muted">No authoritative {kind} have been recorded.</p> : <div className="mt-3 space-y-3">{data.records.map((record) => <article key={record.id} className="rounded border border-border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{"requestedRevision" in record ? record.releaseId || record.requestedRevision : record.restoredReleaseId || record.sourceDeploymentId}</strong><Badge tone={tone(record.status)}>{record.status}</Badge></div><dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-muted">Server</dt><dd>{record.server.name || record.server.id}</dd></div><div><dt className="text-muted">Started</dt><dd>{when(record.startedAt)}</dd></div><div><dt className="text-muted">Completed</dt><dd>{when(record.completedAt)}</dd></div>{"requestedRevision" in record ? <><div><dt className="text-muted">Revision</dt><dd className="break-all">{record.deployedRevision || record.requestedRevision}</dd></div><div><dt className="text-muted">Branch</dt><dd>{record.branch || "Unavailable"}</dd></div><div><dt className="text-muted">Validation</dt><dd>{record.validation.health} / {record.validation.readiness}</dd></div><div><dt className="text-muted">Rollback</dt><dd>{record.rollbackAvailable ? "Available" : "Unavailable"}</dd></div><div><dt className="text-muted">Plan digest</dt><dd className="break-all font-mono">{record.planDigest || "Legacy plan unavailable"}</dd></div><div><dt className="text-muted">Approval expires</dt><dd>{when(record.approvalExpiresAt)}</dd></div><div><dt className="text-muted">Approval</dt><dd>{record.approval ? `${when(record.approval.approvedAt)} by ${record.approval.approverId}` : "Pending separate administrator"}</dd></div><div><dt className="text-muted">Control-plane preflight</dt><dd>{record.controlPlanePreflight ? `${record.controlPlanePreflight.status} · ${record.controlPlanePreflight.checks.filter((check) => check.passed).length}/${record.controlPlanePreflight.checks.length} checks` : "Not run"}</dd></div>{record.cancellation && <div><dt className="text-muted">Cancellation</dt><dd>{when(record.cancellation.cancelledAt)} by {record.cancellation.cancelledById}</dd></div>}</> : <><div><dt className="text-muted">Source deployment</dt><dd className="break-all">{record.sourceDeploymentId}</dd></div><div><dt className="text-muted">Verification</dt><dd>{record.verification.health} / {record.verification.readiness}</dd></div></>}<div><dt className="text-muted">Failure classification</dt><dd>{record.failureClassification || "None"}</dd></div></dl>{"requestedRevision" in record && (record.status === "planned" || record.status === "approved") && <div className="mt-3 flex flex-wrap gap-2">{record.status === "planned" && <GhostButton disabled={approvePlan.isPending || !record.planDigest || !record.approvalExpiresAt} onClick={() => approvePlan.mutate(record)}>Approve exact plan as different administrator</GhostButton>}{record.status === "approved" && <GhostButton disabled={runControlPlanePreflight.isPending || !record.planDigest} onClick={() => runControlPlanePreflight.mutate(record)}>Run control-plane preflight</GhostButton>}<GhostButton disabled={cancelPlan.isPending} onClick={() => cancelPlan.mutate(record.id)}>Cancel deployment plan</GhostButton></div>}</article>)}</div>}
      {data.hasMore && <p className="mt-3 text-xs text-muted">Showing the newest {data.limit} authoritative records.</p>}
    </Card>
  </div>;
}
