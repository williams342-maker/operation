import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiError } from "./api";
import { Badge, Button, Card, Select, Skeleton } from "./ui";

const roles = [
  { id: "operations-analyst", name: "Operations Analyst", resources: ["server", "project"] },
  { id: "seo-analyst", name: "SEO Analyst", resources: ["seo_audit"] },
  { id: "website-planner", name: "Website Planner", resources: ["website_workflow"] },
  { id: "reviewer", name: "AI Reviewer", resources: ["seo_audit", "website_workflow"] },
];
const resourceLabels: Record<string, string> = { server: "Server", project: "Project", seo_audit: "SEO audit", website_workflow: "Website workflow" };

export function AiWorkforcePage({ toast }: { toast: (message: string) => void }) {
  const qc = useQueryClient(); const [roleId, setRoleId] = useState("operations-analyst"); const role = roles.find((item) => item.id === roleId)!;
  const [resourceType, setResourceType] = useState(role.resources[0]); const [resourceId, setResourceId] = useState("");
  const resources = useQuery({ queryKey: ["ai-workforce-resources"], queryFn: async () => { const [servers, projects, audits, workflows] = await Promise.all([api.get("/servers"), api.get("/projects"), api.get("/seo-audits"), api.get("/website-builder/workflows")]); return { server: servers.data.servers || [], project: projects.data.projects || [], seo_audit: audits.data.audits || [], website_workflow: workflows.data.workflows || [] }; } });
  const runs = useQuery({ queryKey: ["ai-workforce-runs"], queryFn: () => api.get("/ai-workforce/runs").then((response) => response.data.runs) });
  const choices = useMemo(() => ((resources.data as any)?.[resourceType] || []).map((item: any) => ({ id: item._id || item.id, label: item.name || item.pageTitle || item.finalUrl || `${item.websiteType || "Website"} workflow` })), [resources.data, resourceType]);
  const create = useMutation({ mutationFn: () => api.post("/ai-workforce/runs", { roleId, resourceType, resourceId }), onSuccess: () => { setResourceId(""); qc.invalidateQueries({ queryKey: ["ai-workforce-runs"] }); toast("AI Workforce run queued"); } });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/ai-workforce/runs/${id}/cancel`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-workforce-runs"] }); toast("Queued run cancelled"); } });
  const changeRole = (value: string) => { const next = roles.find((item) => item.id === value)!; setRoleId(value); setResourceType(next.resources[0]); setResourceId(""); };
  return <div className="space-y-5">
    <Card><h2 className="text-lg font-semibold">Queue a workforce run</h2><p className="mt-1 text-sm text-muted">Create a bounded draft or review job against an existing OpsWorkbench resource. Runs execute only when an administrator enables a compatible worker. The optional mock worker makes no external provider requests and consumes no provider credits.</p><div className="mt-4 grid gap-3 md:grid-cols-3"><label className="text-sm">Role<Select className="mt-1" value={roleId} onChange={(event) => changeRole(event.target.value)}>{roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><label className="text-sm">Resource type<Select className="mt-1" value={resourceType} onChange={(event) => { setResourceType(event.target.value); setResourceId(""); }}>{role.resources.map((value) => <option key={value} value={value}>{resourceLabels[value]}</option>)}</Select></label><label className="text-sm">Resource<Select className="mt-1" value={resourceId} onChange={(event) => setResourceId(event.target.value)}><option value="">Select a resource</option>{choices.map((item: any) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label></div><Button className="mt-4" disabled={!resourceId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Queuing..." : "Queue run"}</Button>{create.isError && <p role="alert" className="mt-2 text-sm text-danger">{apiError(create.error)}</p>}</Card>
    <div><h2 className="mb-3 text-lg font-semibold">Run history</h2>{runs.isLoading ? <Skeleton /> : !(runs.data || []).length ? <Card><p className="text-sm text-muted">No workforce runs have been queued.</p></Card> : <div className="space-y-3">{runs.data.map((run: any) => <Card key={run._id}><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{roles.find((item) => item.id === run.roleId)?.name || run.roleId}</h3><p className="text-xs text-muted">{resourceLabels[run.resourceType]} / {run.provider} / {run.model}</p><p className="mt-1 text-xs text-muted">Created {new Date(run.createdAt).toLocaleString()}</p></div><div className="flex items-center gap-2"><Badge tone={run.state === "succeeded" ? "success" : run.state === "failed" ? "danger" : "warning"}>{run.state}</Badge>{run.state === "queued" && <Button disabled={cancel.isPending} onClick={() => cancel.mutate(run._id)}>Cancel</Button>}</div></div></Card>)}</div>}</div>
  </div>;
}
