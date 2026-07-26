import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  bootstrapStatus: vi.fn(),
  authCapabilities: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  login: vi.fn(),
  requestPasswordReset: vi.fn(),
  completePasswordReset: vi.fn(),
  completeEmailLogin: vi.fn(),
  changePassword: vi.fn(),
  requestEmailLogin: vi.fn()
}));

vi.mock("./api", () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost, patch: mocks.apiPatch },
  apiError: (error: unknown) => error instanceof Error ? error.message : "Unexpected logout failure",
  bootstrapOwner: vi.fn(),
  bootstrapStatus: mocks.bootstrapStatus,
  authCapabilities: mocks.authCapabilities,
  changePassword: mocks.changePassword,
  completePasswordReset: mocks.completePasswordReset,
  completeEmailLogin: mocks.completeEmailLogin,
  isRecentAuthRequired: vi.fn(() => false),
  login: mocks.login,
  logout: mocks.logout,
  reauthenticate: vi.fn(),
  requestPasswordReset: mocks.requestPasswordReset,
  requestEmailLogin: mocks.requestEmailLogin,
  SESSION_EXPIRED_EVENT: "cc:session-expired"
}));

import { Root } from "./main";

function renderRoot() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Root /></QueryClientProvider>);
}

function authenticatedApi(path: string) {
  if (path === "/admin/access") return Promise.resolve({ data: { authorized: true, role: "Owner" } });
  if (path === "/me") return Promise.resolve({ data: { user: { role: "Owner" } } });
  if (path === "/servers") return Promise.resolve({ data: { servers: [] } });
  if (path === "/projects") return Promise.resolve({ data: { projects: [] } });
  return Promise.resolve({ data: { serverCount: 0, onlineServers: 0, projectCount: 0, recentAudit: [] } });
}

const projectOverview = {
  schemaVersion: "project-overview-v1", generatedAt: new Date().toISOString(),
  project: { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Direct Project", slug: "direct-project", archived: false },
  environment: { state: "not-configured" },
  server: { enrollmentStatus: "pending", agentStatus: "never_connected", freshness: "unavailable", capabilities: [], limitations: [] },
  revision: { confidence: "unavailable", conflicts: [] }, services: [], health: [], recent: { tasks: [], audit: [], deployments: [], rollbacks: [] },
  availability: { releases: "unavailable", deployments: "unavailable", rollbacks: "unavailable", logs: "unavailable" }, limitations: []
};
const projectBurnIn = {
  policy: { profile: "Staging-BurnIn-v1", observation: { minimumHours: 24 } },
  enabledHealthChecks: 1,
  observation: { state: "observing", observationStartedAt: new Date().toISOString(), minimumCompletesAt: new Date(Date.now() + 86_400_000).toISOString(), completionPercent: 0, lastResetReasons: [], sampleCount: 1, metrics: { availabilityPercent: 100, httpErrorRatePercent: 0, p95LatencyMs: 50, maximumAgentHeartbeatGapSeconds: 0, maximumDiskPercent: 70, unexpectedRestarts: 0, criticalAlerts: 0 } }
};

describe("Login experience", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/login?returnTo=%2Fadmin");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.authCapabilities.mockResolvedValue({ emailLogin: { configured: true }, passwordLogin: true });
    mocks.login.mockReset();
    mocks.requestPasswordReset.mockReset();
    mocks.completePasswordReset.mockReset();
    mocks.completeEmailLogin.mockReset();
    mocks.requestEmailLogin.mockReset();
  });

  afterEach(() => cleanup());

  it("requests a secure email login without asking for a password or organization slug", async () => {
    mocks.requestEmailLogin.mockResolvedValue({ ok: true });
    renderRoot();

    expect(await screen.findByRole("button", { name: /email secure sign-in link/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/organization slug/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("type", "email");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("autocomplete", "username");
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "owner@example.test{Enter}");
    await waitFor(() => expect(mocks.requestEmailLogin).toHaveBeenCalledWith("owner@example.test"));
    expect(await screen.findByRole("status")).toHaveTextContent(/secure sign-in link has been sent/i);
  });

  it("retains password login as an explicit recovery path", async () => {
    mocks.login.mockImplementation(async () => {
      localStorage.setItem("cc.csrf", "csrf-token");
      return { csrfToken: "csrf-token" };
    });
    renderRoot();

    await userEvent.click(await screen.findByRole("button", { name: /use password instead/i }));
    expect(screen.getByRole("button", { name: /sign in with password/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome back" }).closest("section")).toHaveClass("auth-card");
    expect(screen.queryByPlaceholderText(/organization slug/i)).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "owner@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "owner-password{Enter}");

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith("owner@example.test", "owner-password"));
    expect(mocks.login.mock.calls[0]).toHaveLength(2);
  });

  it("fails closed to password recovery when secure email delivery is unavailable", async () => {
    mocks.authCapabilities.mockResolvedValue({ emailLogin: { configured: false }, passwordLogin: true });
    renderRoot();
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with password/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use secure email link/i })).not.toBeInTheDocument();
    expect(screen.getByText(/secure email delivery is not configured/i)).toBeInTheDocument();
  });

  it("exchanges a fragment-only email token and removes it from browser history", async () => {
    mocks.completeEmailLogin.mockImplementation(async () => { localStorage.setItem("cc.csrf", "csrf-token"); return { csrfToken: "csrf-token" }; });
    window.history.replaceState({}, "", "/email-login#token=opaque-email-token");
    renderRoot();
    await waitFor(() => expect(mocks.completeEmailLogin).toHaveBeenCalledWith("opaque-email-token"));
    expect(window.location.hash).toBe("");
    expect(document.body.textContent).not.toContain("opaque-email-token");
  });

  it("requests password reset with a generic response", async () => {
    mocks.requestPasswordReset.mockResolvedValue({ ok: true, message: "If an active account exists, password reset instructions have been sent." });
    renderRoot();

    await userEvent.click(await screen.findByRole("button", { name: /use password instead/i }));
    await userEvent.click(await screen.findByRole("button", { name: /forgot password/i }));
    await userEvent.type(screen.getByLabelText("Email"), "owner@example.test");
    await userEvent.click(screen.getByRole("button", { name: /send reset instructions/i }));

    await waitFor(() => expect(mocks.requestPasswordReset).toHaveBeenCalledWith("owner@example.test"));
    expect(await screen.findByRole("status")).toHaveTextContent(/if an active account exists/i);
  });

  it("submits a reset-link password change without exposing the token in UI text", async () => {
    mocks.completePasswordReset.mockResolvedValue({ ok: true });
    window.history.replaceState({}, "", "/reset-password?token=opaque-reset-token");
    renderRoot();

    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.queryByText("opaque-reset-token")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("New password"), "replacement-password");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "replacement-password{Enter}");

    await waitFor(() => expect(mocks.completePasswordReset).toHaveBeenCalledWith("opaque-reset-token", "replacement-password"));
  });
});

describe("Public landing and Super User routing", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.bootstrapStatus.mockReset();
    mocks.apiGet.mockReset();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

  it("renders public product content at root without calling authenticated APIs", async () => {
    renderRoot();
    expect(await screen.findByRole("heading", { name: /deploy with confidence/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How It Works" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /prompt to a polished/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /find what holds your website back/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View SEO Optimizer Project" })).toHaveAttribute("href", "https://github.com/williams342-maker/SEO-Optimizer");
    expect(screen.getByRole("link", { name: "Super User sign in" })).toHaveAttribute("href", "/login?returnTo=%2Fadmin");
    expect(mocks.bootstrapStatus).not.toHaveBeenCalled();
    expect(mocks.apiGet).not.toHaveBeenCalled();
  });

  it("opens and closes the accessible mobile menu with Escape", async () => {
    renderRoot();
    const trigger = await screen.findByRole("button", { name: "Open menu" });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Site menu" })).toHaveAttribute("aria-modal", "true");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(trigger).toHaveFocus();
  });

  it("denies authenticated non-owners at the protected admin route", async () => {
    localStorage.setItem("cc.csrf", "csrf-token");
    window.history.replaceState({}, "", "/admin");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockRejectedValueOnce(new Error("Insufficient permission"));
    renderRoot();
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("redirects an authenticated login visit to the protected admin route with the correct title", async () => {
    localStorage.setItem("cc.csrf", "csrf-token");
    window.history.replaceState({}, "", "/login?returnTo=%2Fadmin");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockImplementation(authenticatedApi);
    renderRoot();
    expect(await screen.findByRole("heading", { name: "Overview", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin");
    expect(document.title).toBe("Super User | OpsWorkbench");
  });

  it("allows a marketing viewer into the scoped marketing shell without exposing Super User navigation", async () => {
    localStorage.setItem("cc.csrf", "csrf-token"); window.history.replaceState({}, "", "/marketing");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === "/me") return Promise.resolve({ data: { user: { role: "Viewer" } } });
      if (path.startsWith("/marketing/overview")) return Promise.resolve({ data: { range: {}, currency: "USD", totals: { spend: null, impressions: null, reach: null, clicks: null, landingPageViews: null, leads: null, applications: null, signups: null, purchases: null, conversions: null, revenue: null, videoViews: null, videoCompletions: null }, derived: { ctr: null, landingPageViewRate: null, leadConversionRate: null, conversionRate: null, purchaseConversionRate: null, cpc: null, costPerLead: null, costPerConversion: null, costPerPurchase: null, roas: null, averageOrderValue: null }, comparison: null, hasData: false } });
      if (path.startsWith("/marketing/timeseries")) return Promise.resolve({ data: { points: [] } });
      if (path.startsWith("/marketing/funnel")) return Promise.resolve({ data: { stages: [] } });
      if (path.startsWith("/marketing/channels")) return Promise.resolve({ data: { channels: [] } });
      if (path.startsWith("/marketing/campaigns")) return Promise.resolve({ data: { campaigns: [] } });
      return Promise.resolve({ data: {} });
    });
    renderRoot();
    expect(await screen.findByRole("heading", { name: "Marketing Analytics", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Servers" })).not.toBeInTheDocument();
    expect(mocks.apiGet).not.toHaveBeenCalledWith("/admin/access");
  });
});

describe("Sign Out", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc.csrf", "csrf-token");
    window.history.replaceState({}, "", "/admin");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockImplementation(authenticatedApi);
    mocks.logout.mockReset();
  });

  afterEach(() => cleanup());

  it("calls logout, clears authenticated navigation, and shows the login screen", async () => {
    mocks.logout.mockImplementation(async () => { localStorage.removeItem("cc.csrf"); });
    renderRoot();

    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    expect(mocks.logout).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /email secure sign-in link/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(localStorage.getItem("cc.csrf")).toBeNull();
  });

  it("redirects to login when the API normalizes an expired-session 401", async () => {
    mocks.logout.mockImplementation(async () => { localStorage.removeItem("cc.csrf"); });
    renderRoot();

    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("button", { name: /email secure sign-in link/i })).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });

  it("keeps the authenticated shell and displays unexpected failures", async () => {
    mocks.logout.mockRejectedValue(new Error("Logout service unavailable"));
    renderRoot();

    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Logout service unavailable");
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(localStorage.getItem("cc.csrf")).toBe("csrf-token");
  });
});

describe("User management", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc.csrf", "csrf-token");
    window.history.replaceState({}, "", "/users");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiPost.mockReset();
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === "/me") return Promise.resolve({ data: { user: { id: "owner-id", email: "owner@example.test", name: "Owner User", role: "Owner" } } });
      if (path === "/org/users") return Promise.resolve({ data: { users: [], total: 0, page: 1, pageSize: 25 } });
      return authenticatedApi(path);
    });
  });

  afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

  it("identifies the signed-in user on password change and creates users with an admin-supplied temporary password", async () => {
    mocks.apiPost.mockResolvedValue({ data: { id: "new-user-id", mustChangePassword: true } });
    renderRoot();

    expect(await screen.findByText(/Signed in as Owner User \(owner@example\.test\)\./)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("New user email"), "new-user@example.test");
    await userEvent.type(screen.getByLabelText("New user name"), "New User");
    await userEvent.selectOptions(screen.getByLabelText("New user role"), "Developer");
    await userEvent.type(screen.getByLabelText("Temporary password"), "temporary-password-long");
    await userEvent.type(screen.getByLabelText("Confirm temporary password"), "temporary-password-long");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/org/users", {
      email: "new-user@example.test",
      name: "New User",
      role: "Developer",
      password: "temporary-password-long"
    }));
    expect(mocks.apiPost.mock.calls[0][1]).not.toHaveProperty("confirmPassword");
    expect(document.body.textContent).not.toContain("One-time password");
    expect(await screen.findByText(/User created\. Share the temporary password through a secure channel\./)).toBeInTheDocument();
  });
});

describe("Responsive navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc.csrf", "csrf-token");
    window.history.replaceState({}, "", "/admin");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockImplementation(authenticatedApi);
    mocks.logout.mockReset();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(min-width: 768px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses one complete navigation tree for desktop and mobile", async () => {
    renderRoot();
    const trigger = await screen.findByRole("button", { name: "Open navigation" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", "primary-navigation");
    await userEvent.click(trigger);

    const navigation = screen.getByRole("complementary", { name: "Primary navigation" });
    expect(screen.getAllByRole("complementary", { name: "Primary navigation" })).toHaveLength(1);
    for (const destination of ["Overview", "Organization", "Users", "Servers", "Agent Upgrades", "Projects", "Configuration", "Health", "Mongo", "Tasks", "Audit", "Enrollment", "Sign out"]) {
      expect(navigation).toHaveTextContent(destination);
    }
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Close navigation" }).className).toContain("z-[60]");
    expect(screen.getByRole("button", { name: "Dismiss navigation" })).toBeInTheDocument();
  });

  it("manages focus, traps Tab, closes with Escape, and restores trigger focus", async () => {
    renderRoot();
    const trigger = await screen.findByRole("button", { name: "Open navigation" });
    await userEvent.click(trigger);
    const overview = screen.getByRole("button", { name: /^Overview$/ });
    await waitFor(() => expect(overview).toHaveFocus());
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: /sign out/i })).toHaveFocus();
    await userEvent.tab();
    expect(overview).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("navigates through the shared page state and closes the mobile drawer", async () => {
    renderRoot();
    const trigger = await screen.findByRole("button", { name: "Open navigation" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: /^Projects$/ }));
    expect(await screen.findByRole("heading", { name: "Projects", level: 1 })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: /^Servers$/ }));
    expect(await screen.findByRole("heading", { name: "Servers", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Servers$/ })).toHaveAttribute("aria-current", "page");
  });

  it("provides visible focus treatment and touch-sized navigation controls", async () => {
    renderRoot();
    await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    for (const control of [screen.getByRole("button", { name: /^Overview$/ }), screen.getByRole("button", { name: /sign out/i })]) {
      expect(control.className).toContain("min-h-11");
      expect(control.className).toContain("focus-visible:ring-2");
    }
  });
});

describe("Durable project routes", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc.csrf", "csrf-token");
    window.history.replaceState({}, "", "/admin");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockImplementation((path: string) => path === "/projects/aaaaaaaaaaaaaaaaaaaaaaaa/overview" ? Promise.resolve({ data: projectOverview }) : path === "/projects/aaaaaaaaaaaaaaaaaaaaaaaa/burn-in" ? Promise.resolve({ data: projectBurnIn }) : authenticatedApi(path));
  });
  afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

  it("loads the base and explicit overview project URLs directly", async () => {
    for (const path of ["/projects/aaaaaaaaaaaaaaaaaaaaaaaa", "/projects/aaaaaaaaaaaaaaaaaaaaaaaa/overview"]) {
      cleanup();
      window.history.replaceState({}, "", path);
      renderRoot();
      expect(await screen.findByRole("heading", { name: "Direct Project" })).toBeInTheDocument();
    }
  });

  it("preserves project routes across refresh-equivalent remounts", async () => {
    window.history.replaceState({}, "", "/projects/aaaaaaaaaaaaaaaaaaaaaaaa/overview");
    const first = renderRoot();
    expect(await screen.findByRole("heading", { name: "Direct Project" })).toBeInTheDocument();
    first.unmount();
    renderRoot();
    expect(await screen.findByRole("heading", { name: "Direct Project" })).toBeInTheDocument();
  });

  it("responds to browser back and forward popstate navigation", async () => {
    renderRoot();
    expect(await screen.findByRole("heading", { name: "Overview", level: 1 })).toBeInTheDocument();
    window.history.pushState({}, "", "/projects/aaaaaaaaaaaaaaaaaaaaaaaa/overview");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("heading", { name: "Direct Project" })).toBeInTheDocument();
    window.history.pushState({}, "", "/projects");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("heading", { name: "Projects", level: 1 })).toBeInTheDocument();
  });

  it("handles invalid project identifiers without falling through to Overview", async () => {
    window.history.replaceState({}, "", "/projects/not-an-object-id/overview");
    mocks.apiGet.mockImplementation((path: string) => path.includes("not-an-object-id") ? Promise.reject(new Error("Project not found")) : authenticatedApi(path));
    renderRoot();
    expect(await screen.findByRole("heading", { name: "Project unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Overview", level: 1 })).not.toBeInTheDocument();
  });
});

describe("Cloudflare server onboarding", () => {
  beforeEach(() => {
    localStorage.clear(); localStorage.setItem("cc.csrf", "csrf-token"); window.history.replaceState({}, "", "/servers");
    mocks.bootstrapStatus.mockResolvedValue({ available: false }); mocks.apiPost.mockReset(); mocks.apiPatch.mockReset();
    mocks.apiGet.mockImplementation(authenticatedApi);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

  it("keeps Cloudflare optional and submits enabled credentials only once", async () => {
    mocks.apiPost.mockResolvedValue({ data: { serverId: "aaaaaaaaaaaaaaaaaaaaaaaa", token: "synthetic", installCommand: "safe command", installScript: "#!/usr/bin/env bash\n# synthetic protected download\n", expiresAt: new Date().toISOString(), server: { name: "Example", slug: "example", primaryUrl: "https://example.test" } } });
    renderRoot();
    await userEvent.click(await screen.findByRole("button", { name: "Add Server" }));
    expect(screen.queryByLabelText("Cloudflare Tunnel Token")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Website URL"), "https://example.test");
    await userEvent.click(screen.getByLabelText("Enable Cloudflare"));
    await userEvent.click(screen.getByLabelText("Enable Cloudflare Tunnel"));
    await userEvent.type(screen.getByLabelText("Cloudflare Tunnel Token"), "synthetic-tunnel-token-value");
    await userEvent.click(screen.getByLabelText("Enable Cloudflare Access"));
    await userEvent.type(screen.getByLabelText("Cloudflare Client ID"), "synthetic-client-id");
    await userEvent.type(screen.getByLabelText("Cloudflare Client Secret"), "synthetic-client-secret-value");
    await userEvent.click(screen.getByRole("button", { name: "Create and generate command" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/servers/onboard", expect.objectContaining({ cloudflare: { enabled: true, tunnel: { enabled: true, token: "synthetic-tunnel-token-value" }, access: { enabled: true, clientId: "synthetic-client-id", clientSecret: "synthetic-client-secret-value" } } })));
    expect(await screen.findByText("safe command")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download install script" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("synthetic-tunnel-token-value")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("synthetic-client-secret-value");
  });

  it("replaces a saved secret without retrieving the previous value", async () => {
    const server = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Example", slug: "example", enrollmentStatus: "connected", agentStatus: "online", currentState: {} };
    mocks.apiGet.mockImplementation((path: string) => path === "/servers" ? Promise.resolve({ data: { servers: [server] } }) : path === `/servers/${server._id}` ? Promise.resolve({ data: { server, projects: [] } }) : path === `/servers/${server._id}/connectivity` ? Promise.resolve({ data: { configuration: { enabled: true, secrets: { tunnelToken: "configured" } }, status: { state: "connected", service: { active: true }, tunnel: {} } } }) : authenticatedApi(path));
    mocks.apiPatch.mockResolvedValue({ data: { configuration: { enabled: true, secrets: { tunnelToken: "configured" } } } });
    vi.spyOn(window, "prompt").mockReturnValue("synthetic-replacement-token");
    renderRoot(); await userEvent.click(await screen.findByRole("button", { name: "View" }));
    await userEvent.click(await screen.findByRole("button", { name: "Replace Tunnel Token" }));
    await waitFor(() => expect(mocks.apiPatch).toHaveBeenCalledWith(`/servers/${server._id}/connectivity/cloudflare`, { tunnelToken: "synthetic-replacement-token" }));
    expect(document.body.textContent).not.toContain("synthetic-replacement-token");
  });
});
