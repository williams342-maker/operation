import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Activity, Boxes, ClipboardList, LayoutDashboard, Server } from "lucide-react";
import { api, bootstrapOwner, bootstrapStatus, login } from "./api";
import { Badge, Button, Card, Field } from "./ui";
import "./styles.css";

const queryClient = new QueryClient();

type Page = "overview" | "projects" | "servers" | "audit";

function Bootstrap({ onComplete }: { onComplete: () => void }) {
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () => bootstrapOwner({ organizationName, organizationSlug, ownerName, ownerEmail, password }),
    onSuccess: onComplete
  });
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card>
        <div className="w-96 max-w-full space-y-3">
          <h1 className="text-lg font-semibold">Create Owner</h1>
          <Field placeholder="Organization name" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} />
          <Field placeholder="Organization slug" value={organizationSlug} onChange={(e) => setOrganizationSlug(e.target.value)} />
          <Field placeholder="Owner name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          <Field placeholder="Owner email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          <Field placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button className="w-full" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Create Owner</Button>
          {mutation.isSuccess && <p className="text-sm text-success">Owner created. Sign in with the new account.</p>}
          {mutation.error && <p className="text-sm text-danger">{(mutation.error as Error).message}</p>}
        </div>
      </Card>
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [organizationSlug, setOrg] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({ mutationFn: () => login(organizationSlug, email, password), onSuccess: onLogin });
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card>
        <div className="w-96 max-w-full space-y-3">
          <h1 className="text-lg font-semibold">Control Center</h1>
          <Field placeholder="Organization slug" value={organizationSlug} onChange={(e) => setOrg(e.target.value)} />
          <Field placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button className="w-full" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Sign in</Button>
          {mutation.error && <p className="text-sm text-danger">{(mutation.error as Error).message}</p>}
        </div>
      </Card>
    </div>
  );
}

function Overview() {
  const query = useQuery({ queryKey: ["overview"], queryFn: () => api.get("/overview").then((r) => r.data), refetchInterval: 30000 });
  const data = query.data;
  return <div className="grid gap-4 md:grid-cols-3">
    <Card><div className="text-sm text-muted">Servers</div><div className="mt-2 text-3xl font-semibold">{data?.serverCount ?? "-"}</div></Card>
    <Card><div className="text-sm text-muted">Online</div><div className="mt-2 text-3xl font-semibold">{data?.onlineServers ?? "-"}</div></Card>
    <Card><div className="text-sm text-muted">Projects</div><div className="mt-2 text-3xl font-semibold">{data?.projectCount ?? "-"}</div></Card>
  </div>;
}

function ServersPage() {
  const query = useQuery({ queryKey: ["servers"], queryFn: () => api.get("/servers").then((r) => r.data), refetchInterval: 30000 });
  return <Card><h2 className="font-semibold">Servers</h2><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><tbody>{query.data?.servers?.map((s: any) => <tr key={s._id} className="border-t border-border"><td className="py-3">{s.name}</td><td>{s.hostname}</td><td><Badge tone={s.status === "online" ? "success" : s.status === "revoked" ? "danger" : "warning"}>{s.status}</Badge></td><td className="text-muted">{s.agentVersion}</td></tr>)}</tbody></table></div></Card>;
}

function ProjectsPage() {
  const query = useQuery({ queryKey: ["projects"], queryFn: () => api.get("/projects").then((r) => r.data), refetchInterval: 30000 });
  return <Card><h2 className="font-semibold">Projects</h2><div className="mt-4 space-y-2">{query.data?.projects?.map((p: any) => <div key={p._id} className="rounded-md border border-border p-3"><div className="font-medium">{p.name}</div><div className="text-sm text-muted">{p.slug}</div></div>)}</div></Card>;
}

function AuditPage() {
  const query = useQuery({ queryKey: ["audit"], queryFn: () => api.get("/org/audit").then((r) => r.data), refetchInterval: 30000 });
  return <Card><h2 className="font-semibold">Audit Log</h2><div className="mt-4 space-y-2">{query.data?.events?.map((e: any) => <div key={e._id} className="rounded-md border border-border p-3 text-sm"><div>{e.action} <Badge tone={e.result === "success" ? "success" : "danger"}>{e.result}</Badge></div><div className="text-muted">{new Date(e.createdAt).toLocaleString()} · {e.requestId}</div></div>)}</div></Card>;
}

function AppShell() {
  const [page, setPage] = useState<Page>("overview");
  const nav = [
    ["overview", "Overview", LayoutDashboard],
    ["projects", "Projects", Boxes],
    ["servers", "Servers", Server],
    ["audit", "Audit", ClipboardList]
  ] as const;
  return <div className="min-h-screen md:pl-64"><aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-panel p-3 md:block"><div className="mb-4 flex items-center gap-2 px-2 font-semibold"><Activity className="h-5 w-5 text-primary" /> Control Center</div>{nav.map(([key, label, Icon]) => <button key={key} onClick={() => setPage(key)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${page === key ? "bg-background text-text" : "text-muted hover:bg-background"}`}><Icon className="h-4 w-4" />{label}</button>)}</aside><main className="p-5"><header className="mb-5"><h1 className="text-xl font-semibold">Hosted Deployment Control Center</h1><p className="text-sm text-muted">Read-only Phase 1 status, enrollment, telemetry, and audit foundation.</p></header>{page === "overview" && <Overview />}{page === "projects" && <ProjectsPage />}{page === "servers" && <ServersPage />}{page === "audit" && <AuditPage />}</main></div>;
}

function Root() {
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem("cc.csrf")));
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const status = useQuery({ queryKey: ["bootstrap-status", bootstrapComplete], queryFn: bootstrapStatus, retry: false });
  if (status.isLoading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Loading</div>;
  if (!authed && !bootstrapComplete && status.data?.available) return <Bootstrap onComplete={() => setBootstrapComplete(true)} />;
  return authed ? <AppShell /> : <Login onLogin={() => setAuthed(true)} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={queryClient}><Root /></QueryClientProvider></React.StrictMode>);
