import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  bootstrapStatus: vi.fn(),
  apiGet: vi.fn()
}));

vi.mock("./api", () => ({
  api: { get: mocks.apiGet, post: vi.fn(), patch: vi.fn() },
  apiError: (error: unknown) => error instanceof Error ? error.message : "Unexpected logout failure",
  bootstrapOwner: vi.fn(),
  bootstrapStatus: mocks.bootstrapStatus,
  isRecentAuthRequired: vi.fn(() => false),
  login: vi.fn(),
  logout: mocks.logout,
  reauthenticate: vi.fn(),
  SESSION_EXPIRED_EVENT: "cc:session-expired"
}));

import { Root } from "./main";

function renderRoot() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Root /></QueryClientProvider>);
}

function authenticatedApi(path: string) {
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

describe("Sign Out", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc.csrf", "csrf-token");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockResolvedValue({ data: { serverCount: 0, onlineServers: 0, projectCount: 0, recentAudit: [] } });
    mocks.logout.mockReset();
  });

  afterEach(() => cleanup());

  it("calls logout, clears authenticated navigation, and shows the login screen", async () => {
    mocks.logout.mockImplementation(async () => { localStorage.removeItem("cc.csrf"); });
    renderRoot();

    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    expect(mocks.logout).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OpsWorkbench" })).toBeInTheDocument();
    expect(localStorage.getItem("cc.csrf")).toBeNull();
  });

  it("redirects to login when the API normalizes an expired-session 401", async () => {
    mocks.logout.mockImplementation(async () => { localStorage.removeItem("cc.csrf"); });
    renderRoot();

    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
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

describe("Responsive navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc.csrf", "csrf-token");
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
    window.history.replaceState({}, "", "/");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockImplementation((path: string) => path === "/projects/aaaaaaaaaaaaaaaaaaaaaaaa/overview" ? Promise.resolve({ data: projectOverview }) : authenticatedApi(path));
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
