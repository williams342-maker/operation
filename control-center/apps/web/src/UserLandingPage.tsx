import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowRight, Boxes, CheckCircle2, Cpu, Gauge, Globe2, HardDrive, HeartPulse, MemoryStick, Server, Sparkles } from "lucide-react";
import { hasPermission, type Role } from "@control-center/shared";
import { api, apiError } from "./api";

type AuditEvent = { _id?: string; action: string; result: string; createdAt: string; targetType?: string };
type Metrics = { cpu?: { loadPercent?: number }; memory?: { totalBytes?: number; usedBytes?: number }; disk?: Array<{ totalBytes?: number; usedBytes?: number }> };
type ServerRecord = { _id: string; name: string; status?: string; agentStatus?: string; currentState?: { metrics?: Metrics } };
type ProjectRecord = { _id: string; name: string; slug: string; createdAt?: string };
type OverviewData = { serverCount: number; onlineServers: number; projectCount: number; recentAudit: AuditEvent[] };

const percent = (used?: number, total?: number) => total && used !== undefined ? Math.round((used / total) * 100) : null;
const average = (values: Array<number | null>) => {
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return available.length ? Math.round(available.reduce((sum, value) => sum + value, 0) / available.length) : null;
};
const timeAgo = (raw?: string) => {
  if (!raw) return "Unknown time";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(raw).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
};
const actionLabel = (action: string) => action.split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
};

function MetricCard({ icon: Icon, label, value, detail, tone }: { icon: typeof Boxes; label: string; value: string | number; detail: string; tone: "blue" | "green" | "purple" | "teal" | "lime" }) {
  return <article className="user-stat-card">
    <div className={`user-stat-icon user-stat-icon--${tone}`}><Icon aria-hidden="true" /></div>
    <div><p>{label}</p><strong>{value}</strong><span>{detail}</span></div>
  </article>;
}

function UtilizationRow({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: number | null }) {
  return <div className="user-utilization-row">
    <div className="user-utilization-label"><Icon aria-hidden="true" /><span>{label}</span></div>
    <div className="user-utilization-track"><span style={{ width: `${Math.min(100, value || 0)}%` }} /></div>
    <strong>{value === null ? "Unavailable" : `${value}%`}</strong>
  </div>;
}

export function UserLandingPage({ navigate }: { navigate: (path: string) => void }) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get("/me").then((response) => response.data) });
  const overview = useQuery<OverviewData>({ queryKey: ["overview"], queryFn: () => api.get("/overview").then((response) => response.data), refetchInterval: 30_000 });
  const servers = useQuery<ServerRecord[]>({ queryKey: ["servers"], queryFn: () => api.get("/servers").then((response) => response.data.servers), refetchInterval: 30_000 });
  const projects = useQuery<ProjectRecord[]>({ queryKey: ["projects"], queryFn: () => api.get("/projects").then((response) => response.data.projects), refetchInterval: 30_000 });
  const error = me.error || overview.error || servers.error || projects.error;
  if (error) return <section className="user-dashboard-error"><AlertTriangle aria-hidden="true" /><div><h2>Dashboard unavailable</h2><p>{apiError(error)}</p></div></section>;

  const userName = me.data?.user?.name?.trim() || me.data?.user?.email?.split("@")[0] || "there";
  const firstName = userName.split(/\s+/)[0];
  const role = me.data?.user?.role as Role | undefined;
  const canManageProjects = Boolean(role && hasPermission(role, "projects:manage"));
  const serverList = servers.data || [];
  const projectList = projects.data || [];
  const events = overview.data?.recentAudit || [];
  const onlineServers = overview.data?.onlineServers ?? serverList.filter((server) => server.status === "online").length;
  const cpuAverage = average(serverList.map((server) => server.currentState?.metrics?.cpu?.loadPercent ?? null));
  const memoryAverage = average(serverList.map((server) => percent(server.currentState?.metrics?.memory?.usedBytes, server.currentState?.metrics?.memory?.totalBytes)));
  const diskMaximum = serverList.reduce<number | null>((maximum, server) => {
    const values = (server.currentState?.metrics?.disk || []).map((disk) => percent(disk.usedBytes, disk.totalBytes)).filter((value): value is number => value !== null);
    const next = values.length ? Math.max(...values) : null;
    return next === null ? maximum : maximum === null ? next : Math.max(maximum, next);
  }, null);
  const deploymentEvents = events.filter((event) => event.action.includes("deployment"));
  const deploymentSuccesses = deploymentEvents.filter((event) => event.result === "success").length;
  const successRate = deploymentEvents.length ? Math.round((deploymentSuccesses / deploymentEvents.length) * 1000) / 10 : null;
  const alerts = [
    ...serverList.filter((server) => server.status !== "online").map((server) => ({ severity: "danger", title: `${server.name} is offline`, detail: "Agent heartbeat requires attention" })),
    ...(diskMaximum !== null && diskMaximum >= 80 ? [{ severity: diskMaximum >= 90 ? "danger" : "warning", title: "Disk space warning", detail: `Highest reported disk usage is ${diskMaximum}%` }] : []),
    ...(cpuAverage !== null && cpuAverage >= 80 ? [{ severity: "warning", title: "High CPU usage", detail: `Fleet average is ${cpuAverage}%` }] : [])
  ].slice(0, 5);
  const healthy = alerts.every((alert) => alert.severity !== "danger") && onlineServers === serverList.length;
  const firstProject = projectList[0];

  return <div className="user-dashboard" data-testid="user-dashboard">
    <header className="user-dashboard-hero">
      <div><p className="user-dashboard-eyebrow">Workspace overview</p><h2>{greeting()}, {firstName}!</h2><p>Here&apos;s what&apos;s happening across your projects right now.</p></div>
      <div className="user-dashboard-actions"><span><Activity aria-hidden="true" /> Live data · refreshes every 30s</span><button onClick={() => navigate("/projects")}>{canManageProjects ? "+ New project" : "View projects"}</button></div>
    </header>

    <section className="user-stat-grid" aria-label="Workspace totals">
      <MetricCard icon={Boxes} label="Projects" value={overview.data?.projectCount ?? projectList.length} detail="Active workspace projects" tone="blue" />
      <MetricCard icon={Server} label="Servers" value={overview.data?.serverCount ?? serverList.length} detail={`${onlineServers} online`} tone="green" />
      <MetricCard icon={Activity} label="Deployment events" value={deploymentEvents.length || "—"} detail={deploymentEvents.length ? "Recent audit window" : "No recent deployment data"} tone="purple" />
      <MetricCard icon={Gauge} label="Success rate" value={successRate === null ? "—" : `${successRate}%`} detail={successRate === null ? "Awaiting deployment evidence" : `${deploymentSuccesses} successful events`} tone="teal" />
      <MetricCard icon={HeartPulse} label="System health" value={healthy ? "Healthy" : "Review"} detail={`${onlineServers}/${serverList.length} servers online`} tone="lime" />
    </section>

    <div className="user-dashboard-main-grid">
      <section className="user-dashboard-panel user-dashboard-projects">
        <div className="user-panel-heading"><div><p>Managed applications</p><h3>Projects</h3></div><button onClick={() => navigate("/projects")}>View all <ArrowRight aria-hidden="true" /></button></div>
        {projectList.length ? <div className="user-project-list">{projectList.slice(0, 5).map((project) => <button key={project._id} onClick={() => navigate(`/projects/${project._id}/overview`)}><span className="user-project-mark"><Globe2 aria-hidden="true" /></span><span><strong>{project.name}</strong><small>{project.slug}</small></span><ArrowRight aria-hidden="true" /></button>)}</div> : <div className="user-empty-state"><Boxes aria-hidden="true" /><p>No projects yet</p>{canManageProjects ? <button onClick={() => navigate("/projects")}>Create your first project</button> : <span>Projects will appear here when they are assigned.</span>}</div>}
      </section>

      <section className="user-dashboard-panel">
        <div className="user-panel-heading"><div><p>Latest recorded events</p><h3>Recent activity</h3></div></div>
        {events.length ? <div className="user-activity-list">{events.slice(0, 6).map((event, index) => <div key={event._id || `${event.action}-${index}`}><span className={event.result === "success" ? "is-success" : event.result === "failure" || event.result === "denied" ? "is-danger" : "is-warning"}>{event.result === "success" ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}</span><div><strong>{actionLabel(event.action)}</strong><small>{event.targetType || "Workspace"}</small></div><time>{timeAgo(event.createdAt)}</time></div>)}</div> : <div className="user-empty-state"><Activity aria-hidden="true" /><p>No recent activity</p><span>New audit events will appear here.</span></div>}
      </section>
    </div>

    <div className="user-dashboard-lower-grid">
      <section className="user-dashboard-panel"><div className="user-panel-heading"><div><p>Latest agent telemetry</p><h3>System utilization</h3></div></div><div className="user-utilization"><UtilizationRow icon={Cpu} label="CPU average" value={cpuAverage} /><UtilizationRow icon={MemoryStick} label="Memory average" value={memoryAverage} /><UtilizationRow icon={HardDrive} label="Highest disk" value={diskMaximum} /></div><button className="user-text-link" onClick={() => navigate("/health")}>View health details <ArrowRight aria-hidden="true" /></button></section>
      <section className="user-dashboard-panel"><div className="user-panel-heading"><div><p>Actionable conditions</p><h3>Active alerts</h3></div><span className={`user-health-pill ${healthy ? "is-healthy" : "is-review"}`}>{healthy ? "Operational" : "Review"}</span></div>{alerts.length ? <div className="user-alert-list">{alerts.map((alert, index) => <div key={`${alert.title}-${index}`} className={`is-${alert.severity}`}><AlertTriangle aria-hidden="true" /><span><strong>{alert.title}</strong><small>{alert.detail}</small></span></div>)}</div> : <div className="user-empty-state user-empty-state--compact"><CheckCircle2 aria-hidden="true" /><p>All monitored systems operational</p><span>No active conditions were derived from current telemetry.</span></div>}</section>
      <section className="user-builder-card"><div><span><Sparkles aria-hidden="true" /> AI Website Builder</span><h3>Turn an idea into a responsive draft.</h3><p>Create structured pages, preview them, and export safely. Publishing stays under your release controls.</p><div><button disabled={!firstProject} onClick={() => firstProject && navigate(`/projects/${firstProject._id}/builder`)}>Build my website</button><button className="secondary" onClick={() => navigate("/projects")}>Choose project</button></div></div><div className="user-builder-illustration"><Globe2 aria-hidden="true" /><Sparkles aria-hidden="true" /></div></section>
    </div>
  </div>;
}
