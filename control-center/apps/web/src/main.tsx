import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Boxes,
  CircleHelp,
  ClipboardList,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ListChecks,
  Menu,
  Pencil,
  QrCode,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { enrollmentInstallCommand } from "@control-center/shared";
import { clearProjectDiscoveryValues, discoveredGithubRepositories, eligibleProjectServers, normalizeGithubRepository, projectLocationChoices, projectServerDiscovery, projectSlug, repositoryName } from "./projectAutofill";
import {
  api,
  apiError,
  authCapabilities,
  bootstrapOwner,
  bootstrapStatus,
  changePassword,
  completeEmailLogin,
  completePasswordReset,
  isRecentAuthRequired,
  login,
  logout,
  reauthenticate,
  requestEmailLogin,
  requestPasswordReset,
  SESSION_EXPIRED_EVENT,
} from "./api";
import { discoveryUiState } from "./discoveryState";
import { DiscoveryStatusPanel } from "./DiscoveryStatusPanel";
import { AiAssistantPanel } from "./AiAssistantPanel";
import { AiSettingsCard } from "./AiSettingsCard";
import { SystemHealthCard } from "./SystemHealthCard";
import { ConfigurationPage } from "./ConfigurationPage";
import { AgentUpgradesPage } from "./AgentUpgradesPage";
import { ProjectOverviewPage } from "./ProjectOverviewPage";
import { ProjectHistoryPage } from "./ProjectHistoryPage";
import { PublicLandingPage } from "./PublicLandingPage";
import { MarketingAnalyticsPage } from "./MarketingAnalyticsPage";
import { WebsiteBuilderPage } from "./WebsiteBuilderPage";
import { SeoOptimizerPage } from "./SeoOptimizerPage";
import {
  Badge,
  Button,
  Card,
  Field,
  GhostButton,
  Select,
  Skeleton,
  Table,
  Toolbar,
} from "./ui";
import "./styles.css";

const queryClient = new QueryClient();
type Page =
  | "overview"
  | "org"
  | "users"
  | "servers"
  | "upgrades"
  | "projects"
  | "configuration"
  | "enrollments"
  | "health"
  | "mongo"
  | "tasks"
  | "audit"
  | "marketing";
function fmt(v?: string) {
  return v ? new Date(v).toLocaleString() : "-";
}
function statusTone(v?: string) {
  return v === "online" || v === "success" || v === "active"
    ? "success"
    : v === "revoked" || v === "failure" || v === "suspended"
      ? "danger"
      : "warning";
}
function useToast() {
  const [message, setMessage] = useState("");
  return {
    message,
    show: (v: string) => {
      setMessage(v);
      setTimeout(() => setMessage(""), 3500);
    },
  };
}
function useForm<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState(initial);
  const field = (key: keyof T) => ({
    value: values[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value })),
  });
  return { values, setValues, field };
}
function ErrorText({ error }: { error: unknown }) {
  return error ? (
    <p className="text-sm text-danger">{apiError(error)}</p>
  ) : null;
}
function PasswordField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Field
        {...props}
        type={visible ? "text" : "password"}
        className={`pr-11 ${props.className || ""}`}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-text focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Bootstrap({ onComplete }: { onComplete: () => void }) {
  const f = useForm({
    organizationName: "",
    organizationSlug: "",
    ownerName: "",
    ownerEmail: "",
    password: "",
  });
  const mutation = useMutation({
    mutationFn: () => bootstrapOwner(f.values),
    onSuccess: onComplete,
  });
  return (
    <Centered title="Create Owner">
      <Field placeholder="Organization name" {...f.field("organizationName")} />
      <Field placeholder="Organization slug" {...f.field("organizationSlug")} />
      <Field placeholder="Owner name" {...f.field("ownerName")} />
      <Field placeholder="Owner email" {...f.field("ownerEmail")} />
      <PasswordField
        placeholder="Password"
        autoComplete="new-password"
        {...f.field("password")}
      />
      <Button
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="w-full"
      >
        Create Owner
      </Button>
      <ErrorText error={mutation.error} />
    </Centered>
  );
}
function Login({ onLogin, onForgotPassword }: { onLogin: () => void; onForgotPassword: () => void }) {
  const f = useForm({ email: "", password: "" });
  const capabilities = useQuery({ queryKey: ["auth-capabilities"], queryFn: authCapabilities, retry: false });
  const [requestedMode, setRequestedMode] = useState<"email" | "password">("email");
  const emailAvailable = capabilities.data?.emailLogin.configured === true;
  const passwordMode = !emailAvailable || requestedMode === "password";
  const [linkRequested, setLinkRequested] = useState(false);
  const passwordMutation = useMutation({
    mutationFn: () => login(f.values.email, f.values.password),
    onSuccess: onLogin,
  });
  const emailMutation = useMutation({
    mutationFn: () => requestEmailLogin(f.values.email),
    onSuccess: () => setLinkRequested(true),
  });
  const pending = passwordMutation.isPending || emailMutation.isPending;
  if (capabilities.isLoading) return <AuthShell title="Welcome back" description="Checking the secure sign-in methods available for this workspace."><p role="status" className="auth-status">Loading secure sign-in…</p></AuthShell>;
  return (
    <AuthShell title="Welcome back" description={passwordMode ? emailAvailable ? "Use your account password as a recovery sign-in method." : "Secure email delivery is not configured. Use the password recovery path." : "We’ll send a short-lived, single-use sign-in link to your secure email."}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (pending) return; if (passwordMode) passwordMutation.mutate(); else emailMutation.mutate(); }}>
        <label className="auth-field-label" htmlFor="login-email">Email address</label>
        <Field
          id="login-email"
          aria-label="Email"
          placeholder="you@example.com"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          required
          {...f.field("email")}
        />
        {passwordMode && <div><label className="auth-field-label" htmlFor="login-password">Password</label><PasswordField
          id="login-password"
          aria-label="Password"
          placeholder="Enter your password"
          autoComplete="current-password"
          required
          {...f.field("password")}
        /></div>}
        <Button
          type="submit"
          className="w-full"
          disabled={pending || !f.values.email || (passwordMode && !f.values.password)}
        >
          {pending ? "Signing in..." : passwordMode ? "Sign in with password" : "Email secure sign-in link"}
        </Button>
        {linkRequested && <div role="status" className="auth-success"><Shield className="h-4 w-4" /><span>If an active account exists, a secure sign-in link has been sent. It may take a minute to arrive.</span></div>}
        <div className="auth-alternatives">
          {emailAvailable && <button type="button" className="text-sm text-primary hover:underline" onClick={() => { setRequestedMode((current) => current === "email" ? "password" : "email"); setLinkRequested(false); }}>{passwordMode ? "Use secure email link" : "Use password instead"}</button>}
          {passwordMode && <button type="button" className="mt-2 block w-full text-sm text-primary hover:underline" onClick={onForgotPassword}>Forgot password?</button>}
        </div>
        {capabilities.isError && <p role="alert" className="auth-note">Secure email availability could not be verified. Password recovery remains available.</p>}
        <ErrorText error={passwordMutation.error || emailMutation.error} />
      </form>
    </AuthShell>
  );
}

function EmailLogin({ token, onComplete }: { token: string; onComplete: () => void }) {
  const mutation = useMutation({ mutationFn: () => completeEmailLogin(token), onSuccess: onComplete });
  useEffect(() => { if (token && !mutation.isPending && !mutation.isSuccess && !mutation.isError) mutation.mutate(); }, [token]);
  return <AuthShell title="Secure email sign-in" description="Your link is verified once and never displayed or stored in page content.">
    {!token ? <p role="alert" className="text-sm text-danger">Sign-in link is invalid or expired.</p> : mutation.isPending ? <p role="status" className="auth-status">Verifying your single-use sign-in link…</p> : mutation.isError ? <ErrorText error={mutation.error} /> : <p role="status" className="auth-status">Completing secure sign-in…</p>}
  </AuthShell>;
}
function ForgotPassword({ onBack }: { onBack: () => void }) {
  const f = useForm({ email: "" });
  const [submitted, setSubmitted] = useState(false);
  const mutation = useMutation({
    mutationFn: () => requestPasswordReset(f.values.email),
    onSuccess: () => setSubmitted(true),
  });
  return (
    <AuthShell title="Reset password" description="Request a private reset link for an active OpsWorkbench account.">
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate(); }}>
        <p className="text-sm text-muted">Enter your email address. If an active account exists, reset instructions will be sent.</p>
        <Field aria-label="Email" placeholder="Email" autoComplete="username" {...f.field("email")} />
        <Button type="submit" className="w-full" disabled={mutation.isPending || !f.values.email}>{mutation.isPending ? "Sending..." : "Send reset instructions"}</Button>
        {submitted && <p role="status" className="text-sm text-success">If an active account exists, password reset instructions have been sent.</p>}
        <button type="button" className="w-full text-sm text-primary hover:underline" onClick={onBack}>Back to sign in</button>
        <ErrorText error={mutation.error} />
      </form>
    </AuthShell>
  );
}
function ResetPassword({ token, onComplete }: { token: string; onComplete: () => void }) {
  const f = useForm({ password: "", confirmPassword: "" });
  const mutation = useMutation({
    mutationFn: () => completePasswordReset(token, f.values.password),
    onSuccess: onComplete,
  });
  const valid = token && f.values.password.length >= 12 && f.values.password === f.values.confirmPassword;
  return (
    <AuthShell title="Choose a new password" description="Use at least 12 characters and keep this password unique to OpsWorkbench.">
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid && !mutation.isPending) mutation.mutate(); }}>
        <PasswordField aria-label="New password" placeholder="New password" autoComplete="new-password" {...f.field("password")} />
        <PasswordField aria-label="Confirm new password" placeholder="Confirm new password" autoComplete="new-password" {...f.field("confirmPassword")} />
        <Button type="submit" className="w-full" disabled={!valid || mutation.isPending}>{mutation.isPending ? "Resetting..." : "Reset password"}</Button>
        {f.values.confirmPassword && f.values.password !== f.values.confirmPassword && <p className="text-sm text-danger">New passwords do not match.</p>}
        <ErrorText error={mutation.error} />
      </form>
    </AuthShell>
  );
}

function AuthShell({
  title,
  description,
  children,
}: React.PropsWithChildren<{ title: string; description: string }>) {
  return (
    <main className="auth-page">
      <a className="auth-brand" href="/" aria-label="OpsWorkbench home">
        <span className="auth-brand__mark" aria-hidden="true">OW</span>
        <span>Ops<span>Work</span><strong>Bench</strong></span>
      </a>
      <div className="auth-layout">
        <aside className="auth-story" aria-label="OpsWorkbench security overview">
          <p className="auth-kicker">SECURE WORKSPACE ACCESS</p>
          <h2>Deploy with confidence.<br />Operate with control.</h2>
          <p>Access deployments, monitoring, automation, and audit history from one approval-gated workspace.</p>
          <ul>
            <li><Shield /> Short-lived, single-use email links</li>
            <li><KeyRound /> Role-based access and protected admin routes</li>
            <li><Activity /> Audited operational activity</li>
          </ul>
        </aside>
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-card__icon" aria-hidden="true"><KeyRound /></div>
          <p className="auth-card__eyebrow">OPSWORKBENCH</p>
          <h1 id="auth-title">{title}</h1>
          <p className="auth-card__description">{description}</p>
          {children}
          <p className="auth-card__footer"><Shield className="h-4 w-4" /> Secure by design · <a href="/">Back to home</a></p>
        </section>
      </div>
    </main>
  );
}
function Centered({
  title,
  children,
}: React.PropsWithChildren<{ title: string }>) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Card>
          <div className="space-y-3">
            <h1 className="text-lg font-semibold">{title}</h1>
            {children}
          </div>
        </Card>
      </div>
    </div>
  );
}

function AuditQuickActions() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/me").then((r) => r.data),
  });
  const canManage = ["Owner", "Administrator"].includes(me.data?.user?.role);
  const clear = useMutation({
    mutationFn: () =>
      api.delete("/org/audit", { data: { confirmation: "CLEAR" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["audit"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  const downloadCompressed = async () => {
    const response = await api.get("/org/audit/export", {
      params: { format: "gzip", limit: 1000 },
      responseType: "blob",
    });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = `opsworkbench-audit-${new Date().toISOString().slice(0, 10)}.jsonl.gz`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const clearLogs = () => {
    if (
      confirm(
        "Clear all audit logs? This cannot be undone. A record of this cleanup will be retained.",
      )
    )
      clear.mutate();
  };
  return (
    <div className="flex flex-wrap gap-1">
      <GhostButton onClick={downloadCompressed}>
        <Download className="h-4 w-4" />
        Compress
      </GhostButton>
      {canManage && (
        <GhostButton onClick={clearLogs} disabled={clear.isPending}>
          <Trash2 className="h-4 w-4" />
          {clear.isPending ? "Clearing…" : "Delete audit"}
        </GhostButton>
      )}
      <ErrorText error={clear.error} />
    </div>
  );
}
function Overview() {
  const q = useQuery({
    queryKey: ["overview"],
    queryFn: () => api.get("/overview").then((r) => r.data),
    refetchInterval: 30000,
  });
  if (q.isLoading) return <Skeleton />;
  const d = q.data;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Stat label="Servers" value={d?.serverCount} />
      <Stat label="Online" value={d?.onlineServers} />
      <Stat label="Projects" value={d?.projectCount} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Recent Audit</h2>
          <AuditQuickActions />
        </div>
        <Table
          columns={["Action", "Result", "When"]}
          rows={d?.recentAudit?.map((e: any) => [
            e.action,
            <Badge tone={statusTone(e.result)}>{e.result}</Badge>,
            fmt(e.createdAt),
          ])}
        />
      </Card>
    </div>
  );
}
function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <Card>
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value ?? "-"}</div>
    </Card>
  );
}
function OrgSettings({ toast }: { toast: (m: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/org/settings").then((r) => r.data),
  });
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  React.useEffect(() => {
    if (q.data?.organization) {
      setName(q.data.organization.name);
      setTimezone(q.data.organization.defaultTimezone || "UTC");
    }
  }, [q.data]);
  const m = useMutation({
    mutationFn: () =>
      api.patch("/org/settings", {
        name,
        defaultTimezone: timezone,
        status: q.data?.organization?.status || "active",
        expectedUpdatedAt: q.data.organization.updatedAt,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-settings"] });
      toast("Organization updated");
    },
  });
  if (q.isLoading) return <Skeleton />;
  return (
    <div className="space-y-4"><Card>
      <h2 className="font-semibold">Organization Settings</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field value={name} onChange={(e) => setName(e.target.value)} />
        <Field value={q.data.organization.slug} disabled />
        <Field value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        <Field value={q.data.organization.status || "active"} disabled />
        <div className="text-sm text-muted">
          Created {fmt(q.data.organization.createdAt)}
        </div>
        <div className="text-sm text-muted">
          Updated {fmt(q.data.organization.updatedAt)}
        </div>
      </div>
      {!q.data.passwordResetEmail?.configured && (
        <p className="mt-3 rounded-md border border-warning/40 p-3 text-sm text-warning">
          Password reset email delivery is not configured. {q.data.passwordResetEmail?.guidance}
        </p>
      )}
      <Button
        className="mt-4"
        onClick={() => m.mutate()}
        disabled={m.isPending}
      >
        Save
      </Button>
      <ErrorText error={m.error} />
    </Card><AiSettingsCard toast={toast} /></div>
  );
}

function UsersPage({ toast }: { toast: (m: string) => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/me").then((r) => r.data),
  });
  const q = useQuery({
    queryKey: ["users", search],
    queryFn: () =>
      api.get("/org/users", { params: { search } }).then((r) => r.data),
  });
  const f = useForm({ email: "", name: "", role: "Viewer", password: "", confirmPassword: "" });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["users"] });
    toast("User updated");
  };
  const create = useMutation({
    mutationFn: () => api.post("/org/users", { email: f.values.email, name: f.values.name, role: f.values.role, password: f.values.password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast("User created. Share the temporary password through a secure channel.");
      f.setValues({ email: "", name: "", role: "Viewer", password: "", confirmPassword: "" });
    },
  });
  const canCreate = f.values.email.trim().length > 0 && f.values.name.trim().length > 0 && f.values.password.length >= 12 && f.values.password === f.values.confirmPassword;
  return (
    <div className="space-y-4">
    <PasswordChangeCard toast={toast} currentUser={me.data?.user} />
    <Card>
      <Header title="Users" search={search} setSearch={setSearch} />
      <div className="mb-4 rounded-lg border border-border bg-background/40 p-4">
        <h2 className="font-semibold">Create user</h2>
        <p className="mt-1 text-sm text-muted">Add a user directly when email invitations are not configured. The password is not shown again after save.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <Field aria-label="New user email" placeholder="Email" autoComplete="off" {...f.field("email")} />
          <Field aria-label="New user name" placeholder="Name" autoComplete="off" {...f.field("name")} />
          <Select aria-label="New user role" {...f.field("role")}>
            <option>Viewer</option>
            <option>Developer</option>
            <option>Administrator</option>
            <option>Owner</option>
          </Select>
          <PasswordField aria-label="Temporary password" placeholder="Temporary password" autoComplete="new-password" {...f.field("password")} />
          <PasswordField aria-label="Confirm temporary password" placeholder="Confirm temporary password" autoComplete="new-password" {...f.field("confirmPassword")} />
          <Button disabled={!canCreate || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating..." : "Create user"}</Button>
        </div>
        {f.values.confirmPassword && f.values.password !== f.values.confirmPassword && <p className="mt-2 text-sm text-danger">Temporary passwords do not match.</p>}
      </div>
      <ErrorText error={create.error} />
      {q.isLoading ? (
        <Skeleton />
      ) : (
        <Table
          columns={["Name", "Email", "Role", "Status", "Created", "Actions"]}
          rows={q.data?.users?.map((u: any) => [
            u.name,
            u.email,
            u.role,
            <Badge tone={u.disabledAt ? "danger" : "success"}>
              {u.disabledAt ? "inactive" : "active"}
            </Badge>,
            fmt(u.createdAt),
            <UserActions key={u._id} user={u} currentUser={me.data?.user} onDone={refresh} toast={toast} />,
          ])}
        />
      )}
    </Card>
    </div>
  );
}
function PasswordChangeCard({ toast, currentUser }: { toast: (m: string) => void; currentUser?: any }) {
  const f = useForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const mutation = useMutation({
    mutationFn: () => changePassword(f.values.currentPassword, f.values.newPassword),
    onSuccess: () => {
      f.setValues({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast("Password changed. Other sessions were revoked.");
    },
  });
  const valid = f.values.currentPassword.length > 0 && f.values.newPassword.length >= 12 && f.values.newPassword === f.values.confirmPassword;
  return (
    <Card>
      <h2 className="font-semibold">Change your password</h2>
      <p className="mt-1 text-sm text-text">Signed in as {currentUser?.name ? `${currentUser.name} (${currentUser.email})` : currentUser?.email || "the current user"}.</p>
      <p className="mt-1 text-sm text-muted">Use at least 12 characters. Changing your password revokes your other sessions.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <PasswordField placeholder="Current password" autoComplete="current-password" {...f.field("currentPassword")} />
        <PasswordField placeholder="New password" autoComplete="new-password" {...f.field("newPassword")} />
        <PasswordField placeholder="Confirm new password" autoComplete="new-password" {...f.field("confirmPassword")} />
        <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>Change password</Button>
      </div>
      {f.values.confirmPassword && f.values.newPassword !== f.values.confirmPassword && <p className="mt-2 text-sm text-danger">New passwords do not match.</p>}
      <ErrorText error={mutation.error} />
    </Card>
  );
}
function UserActions({ user, currentUser, onDone, toast }: { user: any; currentUser?: any; onDone: () => void; toast: (m: string) => void }) {
  const toggle = useMutation({
    mutationFn: () =>
      api.post(
        `/org/users/${user._id}/${user.disabledAt ? "activate" : "deactivate"}`,
      ),
    onSuccess: onDone,
  });
  const revoke = useMutation({
    mutationFn: () => api.post(`/org/users/${user._id}/revoke-sessions`),
    onSuccess: onDone,
  });
  const resetPassword = useMutation({
    mutationFn: () => api.post(`/org/users/${user._id}/reset-password`),
    onSuccess: (response) => {
      toast(response.data.delivery === "not_configured" ? "Password reset recorded. Configure email delivery to send reset links." : "Password reset instructions sent");
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/org/users/${user._id}`),
    onSuccess: onDone,
  });
  const canReset = currentUser?.role === "Owner" || user.role !== "Owner";
  const canDelete = currentUser?.role === "Owner" && currentUser?.id !== user._id;
  return (
    <div className="flex flex-wrap gap-2">
      <GhostButton onClick={() => confirm("Continue?") && toggle.mutate()}>
        {user.disabledAt ? "Activate" : "Deactivate"}
      </GhostButton>
      <GhostButton onClick={() => revoke.mutate()}>Revoke sessions</GhostButton>
      {canReset && <GhostButton onClick={() => confirm(`Reset the password for ${user.email}? Their sessions will be revoked.`) && resetPassword.mutate()}>Reset password</GhostButton>}
      {canDelete && <GhostButton onClick={() => confirm(`Permanently delete ${user.email}? This cannot be undone.`) && remove.mutate()}><Trash2 className="h-4 w-4" />Delete</GhostButton>}
      <ErrorText error={toggle.error || revoke.error || resetPassword.error || remove.error} />
    </div>
  );
}

function ServersPage({ toast }: { toast: (m: string) => void }) {
  const qc = useQueryClient();
  const [showHelp, setShowHelp] = useState(false);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/me").then((r) => r.data),
  });
  const canManage = ["Owner", "Administrator"].includes(me.data?.user?.role);
  const q = useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get("/servers").then((r) => r.data.servers),
  });
  const f = useForm({
    name: "",
    slug: "",
    hostname: "",
    allowlistedRoots: "/srv",
  });
  const create = useMutation({
    mutationFn: () =>
      api.post("/servers", {
        name: f.values.name,
        slug: f.values.slug.trim()
          ? f.values.slug.trim().toLowerCase()
          : undefined,
        hostname: f.values.hostname,
        allowlistedRoots: f.values.allowlistedRoots
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: (response) => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      toast(`Server created with slug ${response.data.slug}`);
      f.setValues({
        name: "",
        slug: "",
        hostname: "",
        allowlistedRoots: "/srv",
      });
    },
  });
  const updateSlug = useMutation({
    mutationFn: ({ server, slug }: { server: any; slug: string }) =>
      api.patch(`/servers/${server._id}`, {
        slug,
        expectedUpdatedAt: server.updatedAt,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      toast("Server slug updated");
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/servers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      toast("Server deleted");
    },
  });
  const incomplete = !f.values.name.trim() || !f.values.hostname.trim();
  const setSlug = (server: any) => {
    const value = prompt(
      "Server slug (lowercase letters, numbers, and hyphens)",
      server.slug || "",
    );
    if (value !== null && value.trim())
      updateSlug.mutate({ server, slug: value.trim().toLowerCase() });
  };
  const deleteServer = (server: any) => {
    if (
      confirm(
        `Delete ${server.name}? The server credentials will be revoked and it will disappear from OpsWorkbench.`,
      )
    )
      remove.mutate(server._id);
  };
  const columns = [
    "Name",
    "Slug",
    "Host",
    "Status",
    "Agent",
    "Heartbeat",
    "Metrics",
    ...(canManage ? ["Actions"] : []),
  ];
  const rows = q.data?.map((s: any) => [
    s.name,
    s.slug || "Not assigned",
    s.hostname,
    <Badge tone={statusTone(s.status)}>{s.status}</Badge>,
    s.agentVersion || "manual",
    fmt(s.lastHeartbeatAt),
    s.currentState?.metrics ? "current" : "-",
    ...(canManage
      ? [
          <div key={s._id} className="flex gap-1">
            <GhostButton onClick={() => setSlug(s)}>Set slug</GhostButton>
            <GhostButton onClick={() => deleteServer(s)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </GhostButton>
          </div>,
        ]
      : []),
  ]);
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Servers</h2>
        {canManage && (
          <GhostButton
            aria-expanded={showHelp}
            onClick={() => setShowHelp((value) => !value)}
          >
            <CircleHelp className="h-4 w-4" />
            Setup help
          </GhostButton>
        )}
      </div>
      {showHelp && (
        <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm">
          <h3 className="font-semibold">Information needed for a new server</h3>
          <dl className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <dt className="font-medium">Name</dt>
              <dd className="text-muted">
                A friendly label shown in OpsWorkbench, such as “Production
                API”.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Slug (optional)</dt>
              <dd className="text-muted">
                A short unique identifier using lowercase letters, numbers, and
                hyphens. Leave blank to generate it from the name.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Hostname</dt>
              <dd className="text-muted">
                The exact hostname reported by the target machine, for example
                “api-01”. Run <code>hostname</code> on that server to confirm
                it. Enrollment requires an exact match.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Allowlisted roots</dt>
              <dd className="text-muted">
                Comma-separated folders the agent may inspect, such as
                “/srv,/opt/apps”. Use only folders containing managed projects.
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-muted">
            After creating the server, open Administration → Enrollment, select
            this server, generate its one-use token, and run the copied install
            command on the target machine.
          </p>
        </div>
      )}
      {canManage && (
        <div className="mb-4 mt-3 grid gap-2 md:grid-cols-5">
          <Field
            placeholder="Name"
            aria-label="Server name"
            {...f.field("name")}
          />
          <Field
            placeholder="Slug (auto-generated if blank)"
            aria-label="Server slug"
            {...f.field("slug")}
          />
          <Field
            placeholder="Hostname"
            aria-label="Server hostname"
            {...f.field("hostname")}
          />
          <Field
            placeholder="Allowlisted roots"
            aria-label="Allowlisted roots"
            {...f.field("allowlistedRoots")}
          />
          <Button
            disabled={incomplete || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      )}
      <ErrorText error={create.error || updateSlug.error || remove.error} />
      {q.isLoading ? <Skeleton /> : <Table columns={columns} rows={rows} />}
    </Card>
  );
}
export function ProjectsPage({ toast, onViewProject }: { toast: (m: string) => void; onViewProject?: (id: string) => void }) {
  const qc = useQueryClient();
  const [showHelp, setShowHelp] = useState(false);
  const [viewing, setViewing] = useState<any>(null);
  const servers = useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get("/servers").then((r) => r.data.servers),
    refetchInterval: 30_000,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get("/me").then((r) => r.data) });
  const q = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data.projects),
  });
  const f = useForm({
    name: "",
    slug: "",
    primaryServerId: "",
    githubRepository: "",
    branch: "main",
    repoPath: "",
    composePath: "",
    serviceNames: "",
  });
  const eligibleServers = eligibleProjectServers(servers.data, me.data?.orgId);
  const selectedServer = eligibleServers.find((server) => server._id === f.values.primaryServerId);
  const discovery = projectServerDiscovery(selectedServer);
  const repositoryOptions = discoveredGithubRepositories(discovery);
  const locationChoices = projectLocationChoices(discovery, f.values.githubRepository);
  const selectedLocation = locationChoices.find((choice) => choice.repoPath === f.values.repoPath);
  useEffect(() => {
    if (f.values.primaryServerId && !selectedServer && !servers.isLoading && !me.isLoading) f.setValues(clearProjectDiscoveryValues);
  }, [f.values.primaryServerId, me.isLoading, selectedServer, servers.isLoading, f.setValues]);
  const selectRepository = (repository: string) => {
    const normalized = normalizeGithubRepository(repository) || repository;
    const name = repositoryName(normalized);
    const choices = projectLocationChoices(discovery, normalized);
    const onlyLocation = choices.length === 1 ? choices[0] : undefined;
    const onlyCompose = onlyLocation?.composePaths.length === 1 ? onlyLocation.composePaths[0] : "";
    f.setValues((values) => ({
      ...values,
      githubRepository: normalized,
      name,
      slug: projectSlug(name),
      branch: onlyLocation?.branch || "main",
      repoPath: onlyLocation?.repoPath || "",
      composePath: onlyCompose,
    }));
  };
  const selectLocation = (repoPath: string) => {
    const choice = locationChoices.find((item) => item.repoPath === repoPath);
    f.setValues((values) => ({ ...values, repoPath, branch: choice?.branch || values.branch, composePath: choice?.composePaths.length === 1 ? choice.composePaths[0] : "" }));
  };
  const create = useMutation({
    mutationFn: () =>
      api.post("/projects", {
        ...f.values,
        serviceNames: f.values.serviceNames
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        adapter: "docker-compose",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast("Project created");
    },
  });
  const detail = useQuery({ queryKey: ["project-detail", viewing?._id], queryFn: () => api.get(`/projects/${viewing._id}`).then((r) => r.data), enabled: Boolean(viewing) });
  if (viewing) return <div className="space-y-4"><Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{viewing.name}</h2><p className="text-sm text-muted">Managed application details</p></div><GhostButton onClick={() => setViewing(null)}>Close</GhostButton></div>{detail.isLoading ? <Skeleton /> : <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">Server</dt><dd>{detail.data?.server?.name || "Unavailable"}</dd></div><div><dt className="text-muted">Branch</dt><dd>{detail.data?.project?.branch || "Unknown"}</dd></div><div><dt className="text-muted">Health checks</dt><dd>{detail.data?.healthChecks?.length || 0}</dd></div><div><dt className="text-muted">Recent telemetry</dt><dd>{detail.data?.telemetry?.length || 0} records</dd></div></dl>}</Card><AiAssistantPanel scope={{ type: "application", id: viewing._id }} /></div>;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Projects</h2>
        <GhostButton
          aria-expanded={showHelp}
          aria-controls="project-setup-help"
          onClick={() => setShowHelp((value) => !value)}
        >
          <CircleHelp className="h-4 w-4" />
          Setup help
        </GhostButton>
      </div>
      {showHelp && (
        <div
          id="project-setup-help"
          className="mt-3 rounded-md border border-border bg-background p-4 text-sm"
        >
          <h3 className="font-semibold">
            Information needed for a new project
          </h3>
          <dl className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <dt className="font-medium">Name</dt>
              <dd className="text-muted">
                A friendly name shown in OpsWorkbench, such as “Crafters
                Market”.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Slug</dt>
              <dd className="text-muted">
                A unique lowercase identifier using letters, numbers, and
                hyphens, such as “crafters-market”.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Server</dt>
              <dd className="text-muted">
                The enrolled server where this project runs.
              </dd>
            </div>
            <div>
              <dt className="font-medium">GitHub repository</dt>
              <dd className="text-muted">
                The repository in “owner/repository” format.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Branch</dt>
              <dd className="text-muted">
                The branch deployed to the server, usually “main”.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Repository path</dt>
              <dd className="text-muted">
                The absolute folder containing the checked-out project on the
                selected server, for example “/srv/crafters-market”.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Compose path</dt>
              <dd className="text-muted">
                The Docker Compose file path relative to the repository folder,
                such as “docker-compose.yml”.
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-muted">
            The selected server must be enrolled and its allowlisted paths must
            include the repository folder.
          </p>
        </div>
      )}
      <div className="mb-4 mt-3 grid gap-2 md:grid-cols-4">
        <Field placeholder="Name" {...f.field("name")} />
        <Field placeholder="Slug" {...f.field("slug")} />
        <Select aria-label="Eligible server" value={f.values.primaryServerId} onChange={(event) => f.setValues((values) => ({ ...clearProjectDiscoveryValues(values), primaryServerId: event.target.value }))} disabled={servers.isLoading || me.isLoading || eligibleServers.length === 0}>
          <option value="">Server</option>
          {eligibleServers.map((s: any) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select aria-label="GitHub repository" value={f.values.githubRepository} onChange={(event) => selectRepository(event.target.value)} disabled={!selectedServer}>
          <option value="">GitHub repository</option>
          {repositoryOptions.map((repository) => <option key={repository} value={repository}>{repository}</option>)}
        </Select>
        <Field placeholder="Branch" {...f.field("branch")} />
        {locationChoices.length > 1 ? <Select aria-label="Repository path" value={f.values.repoPath} onChange={(event) => selectLocation(event.target.value)}><option value="">Choose repository path</option>{locationChoices.map((choice) => <option key={choice.repoPath} value={choice.repoPath}>{choice.repoPath}</option>)}</Select> : <Field aria-label="Repository path" placeholder="Repo path" readOnly value={f.values.repoPath} />}
        {(selectedLocation?.composePaths.length || 0) > 1 ? <Select aria-label="Compose path" value={f.values.composePath} onChange={(event) => f.setValues((values) => ({ ...values, composePath: event.target.value }))}><option value="">Choose Compose path</option>{selectedLocation?.composePaths.map((composePath) => <option key={composePath} value={composePath}>{composePath}</option>)}</Select> : <Field aria-label="Compose path" placeholder="Compose path" readOnly value={f.values.composePath} />}
        <Button disabled={!f.values.name || !f.values.slug || !f.values.primaryServerId || !f.values.githubRepository || !f.values.repoPath || !f.values.composePath} onClick={() => create.mutate()}>Create</Button>
      </div>
      {!servers.isLoading && !me.isLoading && eligibleServers.length === 0 && <p className="mb-3 text-sm text-warning">Project autofill requires an enrolled, connected server with current application discovery. Pending, offline, stale, and unavailable servers cannot be selected.</p>}
      {selectedServer && repositoryOptions.length === 0 && <p className="mb-3 text-sm text-warning">No GitHub repositories were found in this server's allowlisted roots. Refresh agent discovery after confirming the repository is already checked out.</p>}
      {f.values.githubRepository && locationChoices.length === 0 && <p className="mb-3 text-sm text-warning">The selected repository was not found in this server's allowlisted roots.</p>}
      <ErrorText error={create.error} />
      {q.isLoading ? (
        <Skeleton />
      ) : (
        <Table
          columns={["Name", "Slug", "Adapter", "Branch", "Paths", "Actions"]}
          rows={q.data?.map((p: any) => [
            p.name,
            p.slug,
            p.adapter || "docker-compose",
            p.branch || "-",
            `${p.repoPath || "-"} / ${p.composePath || "-"}`,
            <GhostButton key={`${p._id}-view`} onClick={() => onViewProject ? onViewProject(p._id) : setViewing(p)}>View</GhostButton>,
          ])}
        />
      )}
    </Card>
  );
}
type GeneratedEnrollment = {
  id: string;
  token: string;
  name: string;
  slug?: string;
  expiresAt?: string;
  maxUses?: number | null;
};
const installCommand = (token: string, slug?: string) =>
  enrollmentInstallCommand(token, "https://opsworkbench.org", slug);
function deriveWebsiteInput(input: string) {
  const raw = input.trim();
  const url = new URL(
    /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`,
  );
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Invalid URL");
  url.hash = "";
  if (url.pathname === "/") url.pathname = "";
  const domain = url.hostname.toLowerCase();
  const slug =
    domain
      .replace(/^www\./, "")
      .split(".")[0]
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "server";
  return {
    normalizedUrl: url.toString().replace(/\/$/, ""),
    displayName:
      slug === "opsworkbench"
        ? "OpsWorkbench"
        : slug
            .split("-")
            .map((v) => v.charAt(0).toUpperCase() + v.slice(1))
            .join(" "),
    slug,
  };
}
function downloadText(filename: string, value: string) {
  const url = URL.createObjectURL(
    new Blob([value], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
function downloadInstallScript(slug: string, installScript: string) {
  downloadText(`${slug}-install-agent.sh`, installScript);
}
function EnrollmentSuccess({
  generated,
  onClose,
  toast,
}: {
  generated: GeneratedEnrollment;
  onClose: () => void;
  toast: (message: string) => void;
}) {
  const [qr, setQr] = useState("");
  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast(`${label} copied`);
  };
  const showQr = async () =>
    setQr(
      await QRCode.toDataURL(installCommand(generated.token), {
        width: 320,
        margin: 2,
        errorCorrectionLevel: "M",
      }),
    );
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generated-title"
    >
      <Card>
        <div className="w-[42rem] max-w-full space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="generated-title" className="text-lg font-semibold">
                Enrollment token generated
              </h2>
              <p className="text-sm text-warning">
                This token is shown only once. Store it securely before closing.
              </p>
            </div>
            <button aria-label="Close" onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 text-sm">
            {generated.token}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => copy(generated.token, "Token")}>
              <Copy className="h-4 w-4" />
              Copy Token
            </Button>
            <GhostButton
              onClick={() =>
                copy(installCommand(generated.token), "Install command")
              }
            >
              <Copy className="h-4 w-4" />
              Copy Install Command
            </GhostButton>
            <GhostButton
              onClick={() =>
                downloadText(
                  "enrollment.env",
                  `CONTROL_CENTER_ENROLLMENT_TOKEN=${generated.token}\n`,
                )
              }
            >
              <Download className="h-4 w-4" />
              Download enrollment.env
            </GhostButton>
            <GhostButton onClick={showQr}>
              <QrCode className="h-4 w-4" />
              Generate QR Code
            </GhostButton>
          </div>
          {qr && (
            <div className="flex justify-center rounded-md bg-white p-4">
              <img
                src={qr}
                alt="QR code containing the enrollment install command"
                className="h-72 w-72"
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Close permanently</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
function EnrollmentGenerate({
  onClose,
  onGenerated,
}: {
  onClose: () => void;
  onGenerated: (value: GeneratedEnrollment) => void;
}) {
  const f = useForm({
    name: "",
    expiration: "60",
    maxUses: "1",
    description: "",
  });
  const [confirmingPassword, setConfirmingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api
        .post("/admin/enrollment/generate", {
          name: f.values.name,
          description: f.values.description || undefined,
          expiresInMinutes:
            f.values.expiration === "never"
              ? null
              : Number(f.values.expiration),
          maxUses:
            f.values.maxUses === "unlimited" ? null : Number(f.values.maxUses),
        })
        .then((response) => response.data),
    onSuccess: (value) => {
      setConfirmingPassword(false);
      setPassword("");
      onGenerated(value);
    },
    onError: (error) => {
      if (isRecentAuthRequired(error)) setConfirmingPassword(true);
    },
  });
  const confirmPassword = useMutation({
    mutationFn: () => reauthenticate(password),
    onSuccess: () => mutation.mutate(),
  });
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card>
        <div className="w-[34rem] max-w-full space-y-4">
          <div className="flex justify-between">
            <h2 className="text-lg font-semibold">Generate Enrollment Token</h2>
            <button aria-label="Close" onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <label className="block text-sm">
            Friendly Name
            <Field
              className="mt-1"
              placeholder="Production web server"
              {...f.field("name")}
            />
          </label>
          <label className="block text-sm">
            Expiration
            <Select className="mt-1" {...f.field("expiration")}>
              <option value="15">15 minutes</option>
              <option value="60">1 hour</option>
              <option value="1440">24 hours</option>
              <option value="10080">7 days</option>
              <option value="43200">30 days</option>
              <option value="never">Never</option>
            </Select>
          </label>
          <label className="block text-sm">
            Maximum Uses
            <Select className="mt-1" {...f.field("maxUses")}>
              <option value="1">1</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="unlimited">Unlimited</option>
            </Select>
          </label>
          <p className="text-sm text-muted">
            Run the install command on a server. Its agent identity will create
            a new record or safely claim the matching existing record.
          </p>
          <label className="block text-sm">
            Optional Description
            <Field
              className="mt-1"
              placeholder="Purpose or deployment group"
              {...f.field("description")}
            />
          </label>
          {confirmingPassword ? (
            <div className="rounded-md border border-border bg-background p-4">
              <h3 className="font-semibold">Confirm your password</h3>
              <p className="mt-1 text-sm text-muted">
                Recent authentication is required before creating an enrollment token.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Field
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && password) confirmPassword.mutate();
                  }}
                />
                <Button
                  disabled={!password || confirmPassword.isPending}
                  onClick={() => confirmPassword.mutate()}
                >
                  Confirm
                </Button>
                <GhostButton
                  onClick={() => {
                    setConfirmingPassword(false);
                    setPassword("");
                    mutation.reset();
                    confirmPassword.reset();
                  }}
                >
                  Cancel
                </GhostButton>
              </div>
              <ErrorText error={confirmPassword.error} />
            </div>
          ) : (
            <ErrorText error={mutation.error} />
          )}
          <div className="flex justify-end gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <Button
              disabled={!f.values.name.trim() || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Generating…" : "Generate"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
function EnrollmentsPage({ toast }: { toast: (m: string) => void }) {
  const qc = useQueryClient();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generated, setGenerated] = useState<GeneratedEnrollment | null>(null);
  const [filter, setFilter] = useState("active");
  const q = useQuery({
    queryKey: ["admin-enrollments"],
    queryFn: () =>
      api
        .get("/admin/enrollment")
        .then((response) => response.data.enrollments),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post("/admin/enrollment/revoke", { id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-enrollments"] });
      toast("Enrollment token revoked");
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/enrollment/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-enrollments"] });
      toast("Enrollment token deleted");
    },
  });
  const records = q.data || [];
  const counts = {
    active: records.filter((e: any) => e.status === "active").length,
    expired: records.filter((e: any) =>
      ["expired", "exhausted"].includes(e.status),
    ).length,
    revoked: records.filter((e: any) => e.status === "revoked").length,
  };
  const shown = records.filter((e: any) =>
    filter === "expired"
      ? ["expired", "exhausted"].includes(e.status)
      : e.status === filter,
  );
  const actions = (e: any) => (
    <div className="flex flex-wrap gap-1">
      <GhostButton
        onClick={() =>
          alert(
            `${e.name}\n${e.description || "No description"}\nUsed ${e.uses || 0}${e.maxUses ? ` of ${e.maxUses}` : " times"}`,
          )
        }
      >
        View
      </GhostButton>
      <GhostButton
        disabled
        title="Plaintext is only available immediately after generation"
      >
        Copy
      </GhostButton>
      <GhostButton
        disabled
        title="Plaintext is only available immediately after generation"
      >
        Download env
      </GhostButton>
      {e.status === "active" && (
        <GhostButton
          onClick={() => confirm("Revoke this token?") && revoke.mutate(e._id)}
        >
          Revoke
        </GhostButton>
      )}
      {e.status !== "active" && (
        <GhostButton
          onClick={() =>
            confirm("Permanently delete this token record?") &&
            remove.mutate(e._id)
          }
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </GhostButton>
      )}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Enrollment</h2>
          <p className="text-sm text-muted">
            Generate and manage secure agent enrollment credentials.
          </p>
        </div>
        <Button onClick={() => setGenerateOpen(true)}>
          <KeyRound className="h-4 w-4" />
          Generate Enrollment Token
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {(["active", "expired", "revoked"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`rounded-lg border p-4 text-left ${filter === status ? "border-primary bg-primary/10" : "border-border bg-panel"}`}
          >
            <div className="text-sm capitalize text-muted">{status} Tokens</div>
            <div className="mt-1 text-2xl font-semibold">{counts[status]}</div>
          </button>
        ))}
      </div>
      <Card>
        {q.isLoading ? (
          <Skeleton />
        ) : (
          <Table
            columns={[
              "Name",
              "Created",
              "Expires",
              "Uses Remaining",
              "Created By",
              "Status",
              "Actions",
            ]}
            rows={shown.map((e: any) => [
              e.name,
              fmt(e.createdAt),
              e.expiresAt ? fmt(e.expiresAt) : "Never",
              e.usesRemaining === null ? "Unlimited" : e.usesRemaining,
              e.createdBy,
              <Badge
                tone={
                  e.status === "active"
                    ? "success"
                    : e.status === "revoked"
                      ? "danger"
                      : "warning"
                }
              >
                {e.status}
              </Badge>,
              actions(e),
            ])}
          />
        )}
      </Card>
      <ErrorText error={revoke.error || remove.error} />
      {generateOpen && (
        <EnrollmentGenerate
          onClose={() => setGenerateOpen(false)}
          onGenerated={(value) => {
            setGenerateOpen(false);
            setGenerated(value);
            qc.invalidateQueries({ queryKey: ["admin-enrollments"] });
          }}
        />
      )}
      {generated && (
        <EnrollmentSuccess
          generated={generated}
          toast={toast}
          onClose={() => setGenerated(null)}
        />
      )}
    </div>
  );
}
function HealthPage({ toast }: { toast: (m: string) => void }) {
  const qc = useQueryClient();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data.projects),
  });
  const q = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get("/health-checks").then((r) => r.data.healthChecks),
  });
  const f = useForm({
    projectId: "",
    name: "",
    url: "https://example.com/health",
    expectedStatus: "200",
    timeoutMs: "5000",
    intervalSeconds: "300",
  });
  const create = useMutation({
    mutationFn: () =>
      api.post("/health-checks", {
        projectId: f.values.projectId,
        name: f.values.name,
        url: f.values.url,
        expectedStatus: Number(f.values.expectedStatus),
        timeoutMs: Number(f.values.timeoutMs),
        intervalSeconds: Number(f.values.intervalSeconds),
        enabled: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["health"] });
      toast("Health check created");
    },
  });
  return (
    <div className="space-y-4">
    <SystemHealthCard />
    <Card>
      <h2 className="font-semibold">Health Checks</h2>
      <div className="mb-4 mt-3 grid gap-2 md:grid-cols-4">
        <Select {...f.field("projectId")}>
          <option value="">Project</option>
          {projects.data?.map((p: any) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Field placeholder="Name" {...f.field("name")} />
        <Field placeholder="URL" {...f.field("url")} />
        <Button onClick={() => create.mutate()}>Create</Button>
      </div>
      <ErrorText error={create.error} />
      <Table
        columns={["Name", "URL", "Enabled", "Latest", "Latency"]}
        rows={q.data?.map((h: any) => [
          h.name,
          h.url,
          h.enabled ? "yes" : "no",
          h.lastResult?.success === false ? (
            <Badge tone="danger">failed</Badge>
          ) : h.lastResult?.success ? (
            <Badge tone="success">ok</Badge>
          ) : (
            "-"
          ),
          h.lastResult?.latencyMs ?? "-",
        ])}
      />
    </Card>
    </div>
  );
}
function MongoPage({ toast }: { toast: (m: string) => void }) {
  const qc = useQueryClient();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data.projects),
  });
  const q = useQuery({
    queryKey: ["mongo"],
    queryFn: () => api.get("/mongo-checks").then((r) => r.data.mongoChecks),
  });
  const f = useForm({
    projectId: "",
    name: "",
    databaseNameHint: "",
    secretReference: "MONGO_URI",
  });
  const create = useMutation({
    mutationFn: () => api.post("/mongo-checks", { ...f.values, enabled: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mongo"] });
      toast("Mongo check created");
    },
  });
  return (
    <Card>
      <h2 className="font-semibold">Mongo Checks</h2>
      <div className="mb-4 mt-3 grid gap-2 md:grid-cols-4">
        <Select {...f.field("projectId")}>
          <option value="">Project</option>
          {projects.data?.map((p: any) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Field placeholder="Name" {...f.field("name")} />
        <Field placeholder="Database name" {...f.field("databaseNameHint")} />
        <Field placeholder="Agent secret ref" {...f.field("secretReference")} />
        <Button onClick={() => create.mutate()}>Create</Button>
      </div>
      <ErrorText error={create.error} />
      <Table
        columns={["Name", "Database", "Enabled", "Latest", "Latency"]}
        rows={q.data?.map((m: any) => [
          m.name,
          m.databaseNameHint || "-",
          m.enabled ? "yes" : "no",
          m.lastResult?.success === false ? (
            <Badge tone="danger">failed</Badge>
          ) : m.lastResult?.success ? (
            <Badge tone="success">ok</Badge>
          ) : (
            "-"
          ),
          m.lastResult?.latencyMs ?? "-",
        ])}
      />
    </Card>
  );
}
function TasksPage({ toast }: { toast: (m: string) => void }) {
  const qc = useQueryClient();
  const [state, setState] = useState("");
  const [serverId, setServerId] = useState("");
  const [type, setType] = useState("collect.system");
  const [selected, setSelected] = useState<string | null>(null);
  const servers = useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get("/servers").then((r) => r.data.servers),
  });
  const q = useQuery({
    queryKey: ["tasks", state, serverId],
    queryFn: () =>
      api
        .get("/tasks", {
          params: {
            state: state || undefined,
            serverId: serverId || undefined,
          },
        })
        .then((r) => r.data),
  });
  const detail = useQuery({
    queryKey: ["task", selected],
    enabled: Boolean(selected),
    queryFn: () => api.get(`/tasks/${selected}`).then((r) => r.data),
  });
  const create = useMutation({
    mutationFn: () =>
      api.post("/tasks", {
        serverId,
        type,
        idempotencyKey: `${type}:${serverId}:${Date.now()}`,
        payload: { projects: [], httpHealthChecks: [], mongoChecks: [] },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("Task queued");
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task"] });
      toast("Task cancelled");
    },
  });
  const retry = () => detail.data?.task && create.mutate();
  const rows = q.data?.tasks?.map((t: any) => [
    <button
      className="text-left text-primary"
      onClick={() => setSelected(t._id)}
    >
      {t.type}
    </button>,
    <Badge tone={statusTone(t.state)}>{t.state}</Badge>,
    t.agentId,
    fmt(t.availableAt),
    fmt(t.expiresAt),
    fmt(t.completedAt),
    ["queued", "claimed", "running"].includes(t.state) ? (
      <GhostButton onClick={() => cancel.mutate(t._id)}>Cancel</GhostButton>
    ) : (
      <GhostButton
        onClick={() => {
          setServerId(t.serverId);
          setType(t.type);
          retry();
        }}
      >
        Retry
      </GhostButton>
    ),
  ]);
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <Card>
        <Toolbar>
          <h2 className="mr-auto font-semibold">Tasks</h2>
          <Select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            <option>queued</option>
            <option>claimed</option>
            <option>running</option>
            <option>succeeded</option>
            <option>failed</option>
            <option>expired</option>
            <option>cancelled</option>
          </Select>
          <Select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
          >
            <option value="">Server</option>
            {servers.data?.map((s: any) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option>collect.system</option>
            <option>inspect.docker</option>
            <option>inspect.compose</option>
            <option>inspect.git</option>
            <option>check.http</option>
            <option>check.mongo</option>
            <option>collect.telemetry</option>
          </Select>
          <Button disabled={!serverId} onClick={() => create.mutate()}>
            Queue
          </Button>
        </Toolbar>
        <ErrorText error={create.error || cancel.error} />
        {q.isLoading ? (
          <Skeleton />
        ) : (
          <Table
            columns={[
              "Type",
              "State",
              "Agent",
              "Available",
              "Expires",
              "Completed",
              "Action",
            ]}
            rows={rows}
          />
        )}
      </Card>
      <Card>
        <h2 className="font-semibold">Task Detail</h2>
        {!selected ? (
          <p className="mt-3 text-sm text-muted">
            Select a task to view its timeline and sanitized result.
          </p>
        ) : detail.isLoading ? (
          <Skeleton />
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <span className="text-muted">State</span>
                <div>
                  <Badge tone={statusTone(detail.data?.task?.state)}>
                    {detail.data?.task?.state}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-muted">Type</span>
                <div>{detail.data?.task?.type}</div>
              </div>
              <div>
                <span className="text-muted">Claimed</span>
                <div>{fmt(detail.data?.task?.claimedAt)}</div>
              </div>
              <div>
                <span className="text-muted">Started</span>
                <div>{fmt(detail.data?.task?.startedAt)}</div>
              </div>
              <div>
                <span className="text-muted">Completed</span>
                <div>{fmt(detail.data?.task?.completedAt)}</div>
              </div>
              <div>
                <span className="text-muted">Updated</span>
                <div>{fmt(detail.data?.task?.updatedAt)}</div>
              </div>
            </div>
            <pre className="max-h-96 overflow-auto rounded-md border border-border bg-background p-3 text-xs">
              {JSON.stringify(
                detail.data?.result?.result || detail.data?.task?.result || {},
                null,
                2,
              )}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}
function AuditPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/me").then((r) => r.data),
  });
  const canManage = ["Owner", "Administrator"].includes(me.data?.user?.role);
  const q = useQuery({
    queryKey: ["audit", search],
    queryFn: () =>
      api
        .get("/org/audit", { params: { action: search || undefined } })
        .then((r) => r.data),
  });
  const clear = useMutation({
    mutationFn: () =>
      api.delete("/org/audit", { data: { confirmation: "CLEAR" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit"] }),
  });
  const downloadCompressed = async () => {
    const response = await api.get("/org/audit/export", {
      params: { format: "gzip", limit: 1000 },
      responseType: "blob",
    });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = `opsworkbench-audit-${new Date().toISOString().slice(0, 10)}.jsonl.gz`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const clearLogs = () => {
    if (
      confirm(
        "Clear all audit logs? This cannot be undone. A record of this cleanup will be retained.",
      )
    )
      clear.mutate();
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <Header title="Audit Log" search={search} setSearch={setSearch} />
        </div>
        <GhostButton onClick={downloadCompressed}>
          <Download className="h-4 w-4" />
          Download compressed
        </GhostButton>
        {canManage && (
          <GhostButton onClick={clearLogs} disabled={clear.isPending}>
            <Trash2 className="h-4 w-4" />
            {clear.isPending ? "Clearing…" : "Clear logs"}
          </GhostButton>
        )}
      </div>
      <ErrorText error={clear.error} />
      <Table
        columns={["When", "Actor", "Action", "Target", "Result", "Correlation"]}
        rows={q.data?.events?.map((e: any) => [
          fmt(e.createdAt),
          e.actorType,
          e.action,
          e.targetType || "-",
          <Badge tone={statusTone(e.result)}>{e.result}</Badge>,
          e.requestId,
        ])}
      />
    </Card>
  );
}
function Header({
  title,
  search,
  setSearch,
}: {
  title: string;
  search: string;
  setSearch: (v: string) => void;
}) {
  return (
    <Toolbar>
      <h2 className="mr-auto font-semibold">{title}</h2>
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted" />
        <Field
          placeholder="Search/filter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
    </Toolbar>
  );
}
const pagePaths: Record<Page, string> = { overview: "/admin", org: "/organization", users: "/users", servers: "/servers", upgrades: "/agent-upgrades", projects: "/projects", configuration: "/configuration", enrollments: "/enrollment", health: "/health", mongo: "/mongo", tasks: "/tasks", audit: "/audit", marketing: "/marketing" };
function currentRoute() {
  const match = window.location.pathname.match(/^\/projects\/([^/]+)(?:\/(overview|deployments|rollbacks|builder|seo))?\/?$/i);
  if (match) return { page: "projects" as Page, projectId: match[1], projectView: (match[2] || "overview") as "overview" | "deployments" | "rollbacks" | "builder" | "seo" };
  if (/^\/marketing(?:\/(?:campaigns|channels|conversions|content|attribution|reports|settings))?\/?$/i.test(window.location.pathname)) return { page: "marketing" as Page, projectId: undefined, projectView: undefined };
  const page = (Object.entries(pagePaths).find(([, path]) => path !== "/" && window.location.pathname === path)?.[0] || "overview") as Page;
  return { page, projectId: undefined, projectView: undefined };
}
function AppShell({ onLogout, logoutPending, logoutError, marketingOnly = false }: { onLogout: () => void; logoutPending: boolean; logoutError: unknown; marketingOnly?: boolean }) {
  const toast = useToast();
  const initialRoute = currentRoute();
  const [page, setPage] = useState<Page>(initialRoute.page);
  const [projectId, setProjectId] = useState<string | undefined>(initialRoute.projectId);
  const [projectView, setProjectView] = useState(initialRoute.projectView);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const mobileNavigation = useRef<HTMLElement>(null);
  const mobileNavigationTrigger = useRef<HTMLButtonElement>(null);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/me").then((response) => response.data),
  });
  const isAdmin = ["Owner", "Administrator"].includes(me.data?.user?.role);
  const fullNav: Array<[Page, string, any]> = [
    ["overview", "Overview", LayoutDashboard],
    ["org", "Organization", Settings],
    ["users", "Users", Users],
    ["servers", "Servers", Server],
    ["upgrades", "Agent Upgrades", Download],
    ["projects", "Projects", Boxes],
    ["configuration", "Configuration", KeyRound],
    ["health", "Health", HeartPulse],
    ["mongo", "Mongo", Database],
    ["tasks", "Tasks", ListChecks],
    ["audit", "Audit", ClipboardList],
    ["marketing", "Marketing Analytics", BarChart3],
  ];
  const nav = marketingOnly ? fullNav.filter(([key]) => key === "marketing") : fullNav;
  const pageTitle =
    page === "enrollments"
      ? "Administration / Enrollment"
      : nav.find(([key]) => key === page)?.[1] || "Not Found";
  const closeMobileNavigation = (restoreFocus = true) => {
    setMobileNavigationOpen(false);
    if (restoreFocus) window.setTimeout(() => mobileNavigationTrigger.current?.focus(), 0);
  };
  const navigate = (destination: Page | string, replace = false) => {
    const path = destination.startsWith("/") ? destination : pagePaths[destination as Page];
    if (replace) window.history.replaceState({}, "", path); else if (window.location.pathname !== path) window.history.pushState({}, "", path);
    const route = currentRoute();
    setPage(route.page);
    setProjectId(route.projectId);
    setProjectView(route.projectView);
    closeMobileNavigation(false);
  };
  useEffect(() => { const onPopState = () => { const route = currentRoute(); setPage(route.page); setProjectId(route.projectId); setProjectView(route.projectView); }; window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState); }, []);
  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const navigation = mobileNavigation.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navigation?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileNavigation();
        return;
      }
      if (event.key !== "Tab" || !navigation) return;
      const focusable = Array.from(navigation.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const media = window.matchMedia?.("(min-width: 768px)");
    const onDesktop = (event: MediaQueryListEvent) => { if (event.matches) closeMobileNavigation(false); };
    document.addEventListener("keydown", onKeyDown);
    media?.addEventListener("change", onDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      media?.removeEventListener("change", onDesktop);
    };
  }, [mobileNavigationOpen]);
  return (
    <div className="min-h-screen md:pl-64">
      <div className="flex items-center justify-between border-b border-border bg-panel p-3 md:hidden">
        <div className="flex items-center gap-2 font-semibold"><Activity className="h-5 w-5 text-primary" /> OpsWorkbench</div>
        <button
          ref={mobileNavigationTrigger}
          type="button"
          aria-label={mobileNavigationOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileNavigationOpen}
          aria-controls="primary-navigation"
          className="relative z-[60] inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => mobileNavigationOpen ? closeMobileNavigation() : setMobileNavigationOpen(true)}
        >
          {mobileNavigationOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {mobileNavigationOpen && <button type="button" aria-label="Dismiss navigation" className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => closeMobileNavigation()} />}
      <aside
        ref={mobileNavigation}
        id="primary-navigation"
        aria-label="Primary navigation"
        className={`${mobileNavigationOpen ? "flex" : "hidden"} fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-panel p-3 shadow-xl md:flex md:w-64 md:max-w-none md:shadow-none`}
      >
        <div className="mb-4 flex items-center gap-2 px-2 font-semibold">
          <Activity className="h-5 w-5 text-primary" /> OpsWorkbench
        </div>
        {nav.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => navigate(key)}
            aria-current={page === key ? "page" : undefined}
            className={`mb-1 flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-h-0 ${page === key ? "bg-background text-text" : "text-muted hover:bg-background"}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
        {isAdmin && !marketingOnly && (
          <>
            <div className="mb-1 mt-5 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
              <Shield className="h-3.5 w-3.5" />
              Administration
            </div>
            <button
              onClick={() => navigate("enrollments")}
              aria-current={page === "enrollments" ? "page" : undefined}
              className={`mb-1 flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-h-0 ${page === "enrollments" ? "bg-background text-text" : "text-muted hover:bg-background"}`}
            >
              <KeyRound className="h-4 w-4" />
              Enrollment
            </button>
          </>
        )}
        <button
          type="button"
          disabled={logoutPending}
          onClick={onLogout}
          className="mt-4 flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-h-0"
        >
          <LogOut className="h-4 w-4" />
          {logoutPending ? "Signing out..." : "Sign out"}
        </button>
        {Boolean(logoutError) && <p role="alert" className="mt-2 px-3 text-sm text-danger">{apiError(logoutError)}</p>}
      </aside>
      <main className="p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-muted">OpsWorkbench / {pageTitle}</div>
            <h1 className="text-xl font-semibold">{pageTitle}</h1>
          </div>
          <div className="text-xs text-muted">
            Last updated {new Date().toLocaleTimeString()}
          </div>
        </div>
        {toast.message && (
          <div className="mb-4 rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
            {toast.message}
          </div>
        )}
        <ErrorBoundary>
          {page === "overview" && <Overview />}
          {page === "org" && <OrgSettings toast={toast.show} />}
          {page === "users" && <UsersPage toast={toast.show} />}
          {page === "servers" && <ServersPage toast={toast.show} />}
          {page === "upgrades" && <AgentUpgradesPage toast={toast.show} />}
          {page === "projects" && projectId && projectView === "overview" && <ProjectOverviewPage projectId={projectId} canViewAudit={isAdmin} navigate={navigate} />}
          {page === "projects" && projectId && projectView === "deployments" && <ProjectHistoryPage projectId={projectId} kind="deployments" navigate={navigate} />}
          {page === "projects" && projectId && projectView === "rollbacks" && <ProjectHistoryPage projectId={projectId} kind="rollbacks" navigate={navigate} />}
          {page === "projects" && projectId && projectView === "builder" && <WebsiteBuilderPage projectId={projectId} navigate={navigate} />}
          {page === "projects" && projectId && projectView === "seo" && <SeoOptimizerPage projectId={projectId} navigate={navigate} />}
          {page === "projects" && !projectId && <ProjectsPage toast={toast.show} onViewProject={(id) => navigate(`/projects/${id}/overview`)} />}
          {page === "configuration" && <ConfigurationPage toast={toast.show} navigate={navigate} />}
          {page === "enrollments" && isAdmin && (
            <EnrollmentsPage toast={toast.show} />
          )}
          {page === "health" && <HealthPage toast={toast.show} />}
          {page === "mongo" && <MongoPage toast={toast.show} />}
          {page === "tasks" && <TasksPage toast={toast.show} />}
          {page === "audit" && <AuditPage />}
          {page === "marketing" && <MarketingAnalyticsPage />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { hasError: boolean }
> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? (
      <Card>
        <h2 className="font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted">Refresh and try again.</p>
      </Card>
    ) : (
      this.props.children
    );
  }
}
export function Root() {
  const path = window.location.pathname;
  const publicLanding = path === "/";
  const [authed, setAuthed] = useState(
    Boolean(localStorage.getItem("cc.csrf")),
  );
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [authScreen, setAuthScreen] = useState<"login" | "forgot">("login");
  React.useEffect(() => {
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (publicLanding) {
      robots?.remove();
      if (canonical) canonical.href = "https://opsworkbench.org/";
    } else {
      if (!robots) { robots = document.createElement("meta"); robots.name = "robots"; document.head.appendChild(robots); }
      robots.content = "noindex, nofollow, noarchive";
      canonical?.remove();
      document.title = path === "/admin" ? "Super User | OpsWorkbench" : "Sign In | OpsWorkbench";
    }
  }, [path, publicLanding]);
  React.useEffect(() => {
    const expireSession = () => {
      queryClient.clear();
      setAuthed(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession);
  }, []);
  const status = useQuery({
    queryKey: ["bootstrap-status", bootstrapComplete],
    queryFn: bootstrapStatus,
    retry: false,
    enabled: !publicLanding,
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      setAuthed(false);
      window.history.replaceState({}, "", "/login?returnTo=%2Fadmin");
    },
  });
  if (publicLanding) return <PublicLandingPage />;
  if (status.isLoading)
    return (
      <Centered title="OpsWorkbench">
        <p className="text-sm text-muted">Loading</p>
      </Centered>
    );
  if (!authed && !bootstrapComplete && status.data?.available)
    return <Bootstrap onComplete={() => setBootstrapComplete(true)} />;
  if (!authed && window.location.pathname === "/reset-password") {
    const token = new URLSearchParams(window.location.search).get("token") || "";
    return <ResetPassword token={token} onComplete={() => { window.history.replaceState({}, "", "/login?returnTo=%2Fadmin"); setAuthScreen("login"); }} />;
  }
  if (!authed && window.location.pathname === "/email-login") {
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") || "";
    if (window.location.hash) window.history.replaceState({}, "", "/email-login");
    return <EmailLogin token={token} onComplete={() => { window.history.replaceState({}, "", "/admin"); setAuthed(true); }} />;
  }
  if (authed && window.location.pathname === "/login") {
    window.history.replaceState({}, "", "/admin");
    document.title = "Super User | OpsWorkbench";
  }
  return authed ? (
    /^\/marketing(?:\/|$)/.test(window.location.pathname)
      ? <AppShell marketingOnly onLogout={() => logoutMutation.mutate()} logoutPending={logoutMutation.isPending} logoutError={logoutMutation.error} />
      : <SuperUserGate><AppShell onLogout={() => logoutMutation.mutate()} logoutPending={logoutMutation.isPending} logoutError={logoutMutation.error} /></SuperUserGate>
  ) : authScreen === "forgot" ? (
    <ForgotPassword onBack={() => setAuthScreen("login")} />
  ) : (
    <Login onLogin={() => { window.history.replaceState({}, "", safeAdminReturnPath()); setAuthed(true); }} onForgotPassword={() => setAuthScreen("forgot")} />
  );
}

function safeAdminReturnPath() {
  const candidate = new URLSearchParams(window.location.search).get("returnTo") || window.location.pathname;
  return candidate === "/admin" || /^\/marketing(?:\/(?:campaigns|channels|conversions|content|attribution|reports|settings))?$/.test(candidate || "") ? candidate! : "/admin";
}

function SuperUserGate({ children }: React.PropsWithChildren) {
  const access = useQuery({
    queryKey: ["admin-access"],
    queryFn: () => api.get("/admin/access").then((response) => response.data),
    retry: false,
  });
  if (access.isLoading) return <Centered title="OpsWorkbench"><p className="text-sm text-muted">Verifying Super User access…</p></Centered>;
  if (access.isError || access.data?.authorized !== true) return <Centered title="Access denied"><p role="alert" className="text-sm text-danger">This area requires the platform Owner role.</p><a className="text-sm text-primary hover:underline" href="/">Return to OpsWorkbench</a></Centered>;
  return children;
}

type SetupResult = {
  serverId: string;
  token: string;
  installCommand: string;
  installScript: string;
  expiresAt: string;
  server: { name: string; slug: string; primaryUrl: string };
};
function ServerDetail({
  server,
  onClose,
  toast,
}: {
  server: any;
  onClose: () => void;
  toast: (message: string) => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery<any>({
    queryKey: ["server-detail", server._id],
    queryFn: () => api.get(`/servers/${server._id}`).then((r) => r.data),
    refetchInterval: 10000,
  });
  const connectivity = useQuery<any>({ queryKey: ["server-connectivity", server._id], queryFn: () => api.get(`/servers/${server._id}/connectivity`).then((r) => r.data), refetchInterval: 10000 });
  const importProject = useMutation({
    mutationFn: (candidate: any) =>
      api.post(`/servers/${server._id}/discovery/import`, candidate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["server-detail", server._id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast("Application imported as a managed project");
    },
  });
  const replaceConnectivitySecret = useMutation({ mutationFn: (value: Record<string, string>) => api.patch(`/servers/${server._id}/connectivity/cloudflare`, value), onSuccess: () => { connectivity.refetch(); toast("Cloudflare credential replaced"); } });
  const state = detail.data?.server?.currentState;
  const metrics = state?.metrics;
  const found = state?.discovery;
  const viewState = discoveryUiState({
    loading: detail.isLoading,
    errorStatus: (detail.error as any)?.response?.status,
    agentStatus: detail.data?.server?.agentStatus || server.agentStatus,
    discovery: found,
  });
  const candidates = (found?.repositories || []).map((repo: any) => {
    const compose = (found?.composeProjects || []).find((item: any) =>
      item.configPath.startsWith(`${repo.path}/`),
    );
    return {
      name:
        compose?.name ||
        repo.path.split("/").filter(Boolean).pop() ||
        "Application",
      repoPath: repo.path,
      composePath: compose?.configPath,
      branch: repo.branch,
      remote: repo.remote,
      serviceNames: compose?.services || [],
    };
  });
  if (detail.isError)
    return (
      <Card>
        <div className="flex justify-between">
          <h2 className="text-lg font-semibold">{server.name}</h2>
          <GhostButton onClick={onClose}>Close</GhostButton>
        </div>
        <div className="mt-4 rounded-md border border-danger/40 p-4">
          <h3 className="font-semibold">Applications could not be refreshed</h3>
          <p className="mt-1 text-sm text-muted">
            {viewState === "permission_denied"
              ? "You do not have permission to view discovery data."
              : "The latest safe discovery report is unavailable."}
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => detail.refetch()}>Retry</Button>
            <GhostButton
              onClick={() =>
                alert(
                  "Confirm the agent is online, upgraded, and its allowlisted roots include the application folder.",
                )
              }
            >
              Setup Help
            </GhostButton>
          </div>
        </div>
      </Card>
    );
  if (!detail.isLoading && detail.data)
    return (
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{server.name}</h2>
            <p className="text-sm text-muted">
              Live server and application details
            </p>
          </div>
          <GhostButton onClick={onClose}>Close</GhostButton>
        </div>
        <div className="mt-4 space-y-4">
          {connectivity.data?.configuration?.enabled && <div className="rounded-md border border-border p-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Cloudflare</h3><Badge tone={connectivity.data?.status?.state === "connected" ? "success" : "danger"}>{connectivity.data?.status?.state === "connected" ? "Connected" : "Disconnected"}</Badge></div><dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted">Version</dt><dd>{connectivity.data?.status?.service?.version || "Unknown"}</dd></div><div><dt className="text-muted">Service</dt><dd>{connectivity.data?.status?.service?.active ? "Active" : "Inactive"}</dd></div><div><dt className="text-muted">Uptime</dt><dd>{connectivity.data?.status?.service?.uptimeSeconds ?? "Unknown"}</dd></div><div><dt className="text-muted">Last reconnect</dt><dd>{fmt(connectivity.data?.status?.service?.lastReconnectAt)}</dd></div><div><dt className="text-muted">Tunnel identifier</dt><dd>{connectivity.data?.status?.tunnel?.identifier || "Unavailable"}</dd></div></dl><div className="mt-3 flex flex-wrap gap-2"><GhostButton onClick={() => { const value = window.prompt("Enter replacement Cloudflare Tunnel Token"); if (value) replaceConnectivitySecret.mutate({ tunnelToken: value }); }}>Replace Tunnel Token</GhostButton><GhostButton onClick={() => { const value = window.prompt("Enter replacement Cloudflare Access Client ID"); if (value) replaceConnectivitySecret.mutate({ accessClientId: value }); }}>Replace Client ID</GhostButton><GhostButton onClick={() => { const value = window.prompt("Enter replacement Cloudflare Access Client Secret"); if (value) replaceConnectivitySecret.mutate({ accessClientSecret: value }); }}>Replace Client Secret</GhostButton></div></div>}
          <DiscoveryStatusPanel
            state={viewState}
            collectedAt={found?.collectedAt}
            onRetry={() => detail.refetch()}
            onHelp={() =>
              alert(
                "Discovery scans only configured allowlisted roots. Upgrade and restart the agent if no report appears.",
              )
            }
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              label="CPU %"
              value={metrics && Math.round(metrics.cpu.loadPercent)}
            />
            <Stat
              label="Memory %"
              value={
                metrics &&
                Math.round(
                  (metrics.memory.usedBytes / metrics.memory.totalBytes) * 100,
                )
              }
            />
            <Stat label="Load (1m)" value={metrics?.cpu?.loadAverage?.[0]} />
            <Stat
              label="Disk %"
              value={
                metrics?.disk?.[0] &&
                Math.round(
                  (metrics.disk[0].usedBytes / metrics.disk[0].totalBytes) *
                    100,
                )
              }
            />
            <Stat label="Containers" value={state?.docker?.length || 0} />
          </div>
          <h3 className="font-semibold">Applications Detected</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {state?.docker?.length ? (
              <div className="rounded-md border border-border p-3">
                <div className="font-medium">Docker</div>
                {state.docker.map((item: any) => (
                  <div key={item.name} className="ml-4 text-sm">
                    {item.name}{" "}
                    <Badge
                      tone={item.state === "running" ? "success" : "warning"}
                    >
                      {item.state}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : null}
            {candidates.map((candidate: any) => {
              const managed = detail.data?.projects?.some(
                (project: any) => project.repoPath === candidate.repoPath,
              );
              return (
                <div
                  key={candidate.repoPath}
                  className="rounded-md border border-border p-3"
                >
                  <div className="font-medium">Git</div>
                  <div className="text-sm">
                    {candidate.repoPath}
                    <br />
                    Branch: {candidate.branch || "unknown"}
                  </div>
                  {candidate.composePath && (
                    <div className="text-sm">
                      Docker Compose: {candidate.name}
                    </div>
                  )}
                  <Button
                    className="mt-3"
                    disabled={managed || importProject.isPending}
                    onClick={() => importProject.mutate(candidate)}
                  >
                    {managed ? "Managed Project" : "Import as Managed Project"}
                  </Button>
                </div>
              );
            })}
          </div>
          {!candidates.length && !state?.docker?.length && (
            <p className="text-sm text-muted">
              No application inventory is available. Valid last-known partial
              data remains visible when supplied by the agent.
            </p>
          )}
          <ErrorText error={importProject.error} />
          <AiAssistantPanel scope={{ type: "server", id: server._id }} />
        </div>
      </Card>
    );
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{server.name}</h2>
          <p className="text-sm text-muted">
            Live server and application details
          </p>
        </div>
        <GhostButton onClick={onClose}>Close</GhostButton>
      </div>
      {detail.isLoading ? (
        <Skeleton />
      ) : (
        <div className="mt-4 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              label="CPU %"
              value={metrics && Math.round(metrics.cpu.loadPercent)}
            />
            <Stat
              label="Memory %"
              value={
                metrics &&
                Math.round(
                  (metrics.memory.usedBytes / metrics.memory.totalBytes) * 100,
                )
              }
            />
            <Stat label="Load (1m)" value={metrics?.cpu?.loadAverage?.[0]} />
            <Stat
              label="Disk %"
              value={
                metrics?.disk?.[0] &&
                Math.round(
                  (metrics.disk[0].usedBytes / metrics.disk[0].totalBytes) *
                    100,
                )
              }
            />
            <Stat label="Containers" value={state?.docker?.length || 0} />
          </div>
          <div>
            <h3 className="font-semibold">Applications Detected</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border p-3">
                <div className="font-medium">
                  {found?.dockerInstalled ? "✓" : "–"} Docker
                </div>
                {state?.docker?.map((item: any) => (
                  <div key={item.name} className="ml-4 text-sm">
                    • {item.name}{" "}
                    <Badge
                      tone={item.state === "running" ? "success" : "warning"}
                    >
                      {item.state}
                    </Badge>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="font-medium">
                  {found?.nginxInstalled ? "✓" : "–"} Nginx
                </div>
                <div className="font-medium">
                  {detail.data?.server?.publicSiteStatus === "reachable"
                    ? "✓"
                    : "–"}{" "}
                  HTTPS
                </div>
              </div>
              {candidates.map((candidate: any) => {
                const managed = detail.data?.projects?.some(
                  (project: any) => project.repoPath === candidate.repoPath,
                );
                return (
                  <div
                    key={candidate.repoPath}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="font-medium">✓ Git</div>
                    <div className="ml-4 text-sm">
                      • {candidate.repoPath}
                      <br />
                      Branch: {candidate.branch || "unknown"}
                    </div>
                    {candidate.composePath && (
                      <div className="mt-2 text-sm">
                        ✓ Docker Compose: {candidate.name}
                      </div>
                    )}
                    <Button
                      className="mt-3"
                      disabled={managed || importProject.isPending}
                      onClick={() => importProject.mutate(candidate)}
                    >
                      {managed
                        ? "Managed Project"
                        : "Import as Managed Project"}
                    </Button>
                  </div>
                );
              })}
            </div>
            {!candidates.length && (
              <p className="mt-2 text-sm text-muted">
                Waiting for the agent’s next discovery report.
              </p>
            )}
            <ErrorText error={importProject.error} />
          </div>
        </div>
      )}
    </Card>
  );
}
function UrlServersPage({ toast }: { toast: (m: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [discovery, setDiscovery] = useState<any>(null);
  const [viewing, setViewing] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [deleteMode, setDeleteMode] = useState("remove");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const f = useForm({ url: "", displayName: "", slug: "", environment: "staging", sshHost: "", sshUser: "root", tunnelToken: "", accessClientId: "", accessClientSecret: "" });
  const [cloudflareEnabled, setCloudflareEnabled] = useState(false);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [accessEnabled, setAccessEnabled] = useState(false);
  const edit = useForm({
    name: "",
    primaryUrl: "",
    slug: "",
    notes: "",
    tags: "",
  });
  const servers = useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get("/servers").then((r) => r.data.servers),
    refetchInterval: 5000,
  });
  const derive = () => {
    try {
      const value = deriveWebsiteInput(f.values.url);
      f.setValues({
        ...f.values,
        url: value.normalizedUrl,
        displayName: f.values.displayName || value.displayName,
        slug: f.values.slug || value.slug,
      });
    } catch {
      /* API reports invalid URLs */
    }
  };
  const inspect = useMutation({
    mutationFn: () =>
      api
        .post("/servers/discover", { url: f.values.url })
        .then((r) => r.data.discovery),
    onSuccess: (value) => {
      setDiscovery(value);
      f.setValues({
        ...f.values,
        url: value.normalizedUrl,
        displayName: f.values.displayName || value.displayName,
        slug: f.values.slug || value.slug,
      });
    },
  });
  const onboard = useMutation({
    mutationFn: () =>
      api
        .post("/servers/onboard", {
          url: f.values.url,
          displayName: f.values.displayName || undefined,
          slug: f.values.slug || undefined,
          environment: f.values.environment,
          sshHost: f.values.sshHost || undefined,
          sshUser: f.values.sshUser || undefined,
          detectedPublicIps: discovery?.addresses || [],
          expiresInMinutes: 60,
          cloudflare: {
            enabled: cloudflareEnabled,
            tunnel: { enabled: tunnelEnabled, token: tunnelEnabled ? f.values.tunnelToken : undefined },
            access: { enabled: accessEnabled, clientId: accessEnabled ? f.values.accessClientId : undefined, clientSecret: accessEnabled ? f.values.accessClientSecret : undefined },
          },
        })
        .then((r) => r.data),
    onSuccess: (value) => {
      f.setValues({ ...f.values, tunnelToken: "", accessClientId: "", accessClientSecret: "" });
      setSetup(value);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["servers"] });
      toast("Pending server created");
    },
  });
  const regenerate = useMutation({
    mutationFn: (server: any) =>
      api
        .post(`/servers/${server._id}/enrollment`)
        .then((r) => ({
          ...r.data,
          server: {
            name: server.name,
            slug: server.slug,
            primaryUrl: server.primaryUrl,
          },
        })),
    onSuccess: (value) => setSetup(value as SetupResult),
  });
  const check = useMutation({
    mutationFn: (server: any) =>
      api.post(`/servers/${server._id}/check-status`).then((r) => r.data),
    onSuccess: (value) => {
      qc.setQueryData(["servers"], (old: any) =>
        (old || []).map((server: any) =>
          server._id === value.server_id ? value.server : server,
        ),
      );
      toast(
        value.agent_status === "online"
          ? "Agent connected successfully"
          : value.public_site_status === "reachable" ||
              value.public_site_status === "redirecting"
            ? "Status updated"
            : value.agent_status === "never_connected"
              ? "Agent has not connected"
              : "Unable to reach website",
      );
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api
        .patch(`/servers/${editing._id}`, {
          name: edit.values.name,
          primaryUrl: edit.values.primaryUrl,
          slug: edit.values.slug,
          notes: edit.values.notes,
          tags: edit.values.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          expectedUpdatedAt: editing.updatedAt,
        })
        .then((r) => r.data.server),
    onSuccess: async (server) => {
      setEditing(null);
      await check.mutateAsync(server);
      qc.invalidateQueries({ queryKey: ["servers"] });
      toast("Server updated");
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      api.delete(`/servers/${deleting._id}`, {
        data: { mode: deleteMode, confirmation: deleteConfirmation },
      }),
    onSuccess: () => {
      setDeleting(null);
      setDeleteConfirmation("");
      setDeleteMode("remove");
      qc.invalidateQueries({ queryKey: ["servers"] });
      toast("Server removed from OpsWorkbench");
    },
  });
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast("Install command copied");
  };
  const beginEdit = (server: any) => {
    setEditing(server);
    edit.setValues({
      name: server.name || "",
      primaryUrl: server.primaryUrl || "",
      slug: server.slug || "",
      notes: server.notes || "",
      tags: (server.tags || []).join(", "),
    });
  };
  const beginDelete = (server: any) => {
    setDeleting(server);
    setDeleteConfirmation("");
    setDeleteMode("remove");
  };
  if (setup) {
    const connected =
      servers.data?.find((s: any) => s._id === setup.serverId)
        ?.enrollmentStatus === "connected";
    return (
      <Card>
        <h2 className="text-lg font-semibold">Server setup</h2>
        <div className="mt-3 text-sm">
          <p>URL: {setup.server.primaryUrl}</p>
          <p>Slug: {setup.server.slug}</p>
          <p>
            Status:{" "}
            <Badge tone={connected ? "success" : "warning"}>
              {connected
                ? "Server connected successfully"
                : "Waiting for agent"}
            </Badge>
          </p>
        </div>
        {!connected && (
          <>
            <p className="mt-4 text-sm text-warning">
              This one-time command disappears when this screen closes.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background p-3 text-xs">
              {setup.installCommand}
            </pre>
            <div className="mt-3 flex gap-2">
              <Button
                onClick={() =>
                  downloadInstallScript(
                    setup.server.slug,
                    setup.installScript,
                  )
                }
              >
                <Download className="h-4 w-4" />
                Download install script
              </Button>
              <Button onClick={() => copy(setup.installCommand)}>
                <Copy className="h-4 w-4" />
                Copy command
              </Button>
              <GhostButton onClick={() => setSetup(null)}>
                Close permanently
              </GhostButton>
            </div>
          </>
        )}
        {connected && (
          <Button className="mt-4" onClick={() => setSetup(null)}>
            View Server
          </Button>
        )}
      </Card>
    );
  }
  if (viewing)
    return (
      <ServerDetail
        server={viewing}
        onClose={() => setViewing(null)}
        toast={toast}
      />
    );
  const rows = (servers.data || []).map((s: any) => [
    s.name,
    <div key={`${s._id}-site`}>
      <div>{s.primaryUrl || "-"}</div>
      <div className="text-xs text-muted">
        <Badge
          tone={
            s.publicSiteStatus === "reachable"
              ? "success"
              : s.publicSiteStatus === "unreachable" ||
                  s.publicSiteStatus === "tls_error" ||
                  s.publicSiteStatus === "dns_error"
                ? "danger"
                : "warning"
          }
        >
          {s.publicSiteStatus || "unknown"}
        </Badge>
        {s.publicSiteHttpStatus ? ` HTTP ${s.publicSiteHttpStatus}` : ""}
        <br />
        Checked {fmt(s.publicSiteCheckedAt)}
      </div>
    </div>,
    s.hostname || "Awaiting agent",
    <Badge
      tone={
        s.agentStatus === "online"
          ? "success"
          : s.agentStatus === "revoked"
            ? "danger"
            : "warning"
      }
    >
      {s.agentStatus || "never_connected"}
    </Badge>,
    <Badge
      tone={
        s.enrollmentStatus === "connected"
          ? "success"
          : s.enrollmentStatus === "revoked"
            ? "danger"
            : "warning"
      }
    >
      {s.enrollmentStatus || "pending"}
    </Badge>,
    fmt(s.lastHeartbeatAt),
    <div key={s._id} className="flex flex-wrap gap-1">
      {s.enrollmentStatus !== "pending" && (
        <GhostButton onClick={() => setViewing(s)}>View</GhostButton>
      )}
      {s.enrollmentStatus === "pending" && (
        <Button onClick={() => regenerate.mutate(s)}>Install Agent</Button>
      )}
      <Button
        disabled={check.isPending && check.variables?._id === s._id}
        onClick={() => check.mutate(s)}
      >
        <RefreshCw className="h-4 w-4" />
        {check.isPending && check.variables?._id === s._id
          ? "Checking..."
          : "Check status"}
      </Button>
      <GhostButton onClick={() => beginEdit(s)}>
        <Pencil className="h-4 w-4" />
        Edit
      </GhostButton>
      <GhostButton
        onClick={() =>
          alert(
            "Website reachability and agent connectivity are checked separately. Editing the URL or slug never changes machine identity.",
          )
        }
      >
        <CircleHelp className="h-4 w-4" />
        Help
      </GhostButton>
      <GhostButton onClick={() => beginDelete(s)}>
        <Trash2 className="h-4 w-4" />
        Delete
      </GhostButton>
    </div>,
  ]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Servers</h2>
          <p className="text-sm text-muted">
            Website reachability and agent connectivity are reported separately.
          </p>
        </div>
        <div className="flex gap-2">
          <GhostButton
            disabled={servers.isFetching}
            onClick={() => servers.refetch()}
          >
            <RefreshCw className="h-4 w-4" />
            {servers.isFetching ? "Refreshing..." : "Refresh all"}
          </GhostButton>
          <Button onClick={() => setOpen(true)}>Add Server</Button>
        </div>
      </div>
      {open && (
        <Card>
          <div className="space-y-3">
            <label className="block text-sm">
              Website URL
              <Field
                className="mt-1"
                placeholder="https://example.com"
                {...f.field("url")}
                onBlur={derive}
              />
            </label>
            <label className="block text-sm">
              Display name (optional)
              <Field className="mt-1" {...f.field("displayName")} />
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block text-sm">Environment<Select className="mt-1" {...f.field("environment")}><option value="staging">Staging</option><option value="production">Production</option><option value="development">Development</option></Select></label>
              <label className="block text-sm">SSH host (optional)<Field className="mt-1" {...f.field("sshHost")} /></label>
              <label className="block text-sm">SSH user (optional)<Field className="mt-1" {...f.field("sshUser")} /></label>
            </div>
            <fieldset className="rounded-md border border-border p-3">
              <legend className="px-1 font-semibold">Connectivity provider</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={cloudflareEnabled} onChange={(event) => { setCloudflareEnabled(event.target.checked); if (!event.target.checked) { setTunnelEnabled(false); setAccessEnabled(false); } }} /> Enable Cloudflare</label>
              {cloudflareEnabled && <div className="mt-2 space-y-3">
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={tunnelEnabled} onChange={(event) => setTunnelEnabled(event.target.checked)} /> Enable Cloudflare Tunnel</label>
                {tunnelEnabled && <label className="block text-sm">Cloudflare Tunnel Token<Field type="password" autoComplete="off" className="mt-1" {...f.field("tunnelToken")} /></label>}
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={accessEnabled} onChange={(event) => setAccessEnabled(event.target.checked)} /> Enable Cloudflare Access</label>
                {accessEnabled && <div className="grid gap-3 md:grid-cols-2"><label className="block text-sm">Cloudflare Client ID<Field type="password" autoComplete="off" className="mt-1" {...f.field("accessClientId")} /></label><label className="block text-sm">Cloudflare Client Secret<Field type="password" autoComplete="new-password" className="mt-1" {...f.field("accessClientSecret")} /></label></div>}
                <p className="text-xs text-muted">Credentials are encrypted at rest, delivered once during enrollment, and never shown again. Use Edit server to replace a credential.</p>
              </div>}
            </fieldset>
            <button
              className="text-sm text-primary"
              onClick={() => setAdvanced((v) => !v)}
            >
              {advanced ? "Hide" : "Show"} advanced options
            </button>
            {advanced && (
              <label className="block text-sm">
                Slug
                <Field className="mt-1" {...f.field("slug")} />
              </label>
            )}
            {discovery && (
              <div className="rounded-md border border-border bg-background p-3 text-sm">
                <div>Domain: {discovery.domain}</div>
                <div>
                  Public IPs: {discovery.addresses?.join(", ") || "None"}
                </div>
                <div>
                  HTTPS:{" "}
                  {discovery.httpsAvailable ? "Available" : "Unavailable"}
                </div>
                <div>HTTP status: {discovery.httpStatus || "Unknown"}</div>
                {discovery.pageTitle && (
                  <div>Page title: {discovery.pageTitle}</div>
                )}
                <p className="mt-2 text-muted">
                  These addresses may belong to Cloudflare, a CDN, or a proxy;
                  they are not machine identity.
                </p>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
              <GhostButton
                disabled={!f.values.url || inspect.isPending}
                onClick={() => inspect.mutate()}
              >
                {inspect.isPending ? "Inspecting..." : "Inspect public URL"}
              </GhostButton>
              <Button
                disabled={!f.values.url || onboard.isPending}
                onClick={() => onboard.mutate()}
              >
                {onboard.isPending
                  ? "Creating..."
                  : "Create and generate command"}
              </Button>
            </div>
            <ErrorText error={inspect.error || onboard.error} />
          </div>
        </Card>
      )}
      {editing && (
        <Card>
          <h3 className="font-semibold">Edit server</h3>
          <p className="mt-1 text-sm text-muted">
            Machine-reported identity and agent credentials cannot be edited
            here.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Display name
              <Field className="mt-1" {...edit.field("name")} />
            </label>
            <label className="text-sm">
              Primary URL
              <Field className="mt-1" {...edit.field("primaryUrl")} />
            </label>
            <label className="text-sm">
              Slug
              <Field className="mt-1" {...edit.field("slug")} />
            </label>
            <label className="text-sm">
              Tags
              <Field
                className="mt-1"
                placeholder="production, linux"
                {...edit.field("tags")}
              />
            </label>
            <label className="text-sm md:col-span-2">
              Notes
              <Field className="mt-1" {...edit.field("notes")} />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving..." : "Save and check status"}
            </Button>
          </div>
          <ErrorText error={save.error} />
        </Card>
      )}
      {deleting && (
        <Card>
          <h3 className="font-semibold text-danger">
            {deleting.enrollmentStatus === "pending" && !deleting.enrolledAt
              ? "Delete pending server"
              : "Delete enrolled server"}
          </h3>
          <p className="mt-2 text-sm">
            {deleting.enrollmentStatus === "pending" && !deleting.enrolledAt
              ? "Delete this pending server setup? Any unused enrollment token linked to it will be revoked."
              : "Agent credentials will be revoked and this does not uninstall the agent from the machine. Projects are preserved and detached."}
          </p>
          {!(
            deleting.enrollmentStatus === "pending" && !deleting.enrolledAt
          ) && (
            <div className="mt-3 space-y-3">
              <label className="block text-sm">
                Removal mode
                <Select
                  className="mt-1"
                  value={deleteMode}
                  onChange={(event) => setDeleteMode(event.target.value)}
                >
                  <option value="remove">Remove from OpsWorkbench</option>
                  <option value="purge">
                    Remove and purge operational data
                  </option>
                </Select>
              </label>
              <label className="block text-sm">
                Type <strong>{deleting.slug || deleting.name}</strong> to
                confirm
                <Field
                  className="mt-1"
                  value={deleteConfirmation}
                  onChange={(event) =>
                    setDeleteConfirmation(event.target.value)
                  }
                />
              </label>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <GhostButton onClick={() => setDeleting(null)}>Cancel</GhostButton>
            <Button
              disabled={
                remove.isPending ||
                (!(
                  deleting.enrollmentStatus === "pending" &&
                  !deleting.enrolledAt
                ) &&
                  deleteConfirmation !== deleting.name &&
                  deleteConfirmation !== deleting.slug)
              }
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Deleting..." : "Delete server"}
            </Button>
          </div>
          <ErrorText error={remove.error} />
        </Card>
      )}
      <Card>
        {servers.isLoading ? (
          <Skeleton />
        ) : (
          <Table
            columns={[
              "Display name",
              "Website",
              "Hostname",
              "Agent",
              "Enrollment",
              "Last seen",
              "Actions",
            ]}
            rows={rows}
          />
        )}
      </Card>
      <ErrorText error={regenerate.error || check.error} />
    </div>
  );
}

// The legacy component remains temporarily for rollback compatibility.
// @ts-expect-error Function declarations are writable at runtime.
ServersPage = UrlServersPage;
const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
