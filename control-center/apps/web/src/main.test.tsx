import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  login: vi.fn(),
  replaceOwner: vi.fn(),
  bootstrapStatus: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn()
}));

vi.mock("./api", () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost, patch: vi.fn() },
  apiError: (error: unknown) => error instanceof Error ? error.message : "Unexpected logout failure",
  bootstrapOwner: vi.fn(),
  bootstrapStatus: mocks.bootstrapStatus,
  isRecentAuthRequired: vi.fn(() => false),
  login: mocks.login,
  logout: mocks.logout,
  reauthenticate: vi.fn(),
  replaceOwner: mocks.replaceOwner,
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

describe("One-time Owner Registration", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.bootstrapStatus.mockResolvedValue({ available: false, replacementAvailable: true });
    mocks.replaceOwner.mockReset();
    mocks.replaceOwner.mockResolvedValue({});
    mocks.apiGet.mockResolvedValue({ data: { serverCount: 0, onlineServers: 0, projectCount: 0, recentAudit: [] } });
  });

  afterEach(() => cleanup());

  it("collects the replacement Owner credentials", async () => {
    renderRoot();
    expect(await screen.findByRole("heading", { name: "One-time Owner Registration" })).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("New Owner name"), "Replacement Owner");
    await userEvent.type(screen.getByPlaceholderText("New Owner email"), "replacement@example.test");
    await userEvent.type(screen.getByPlaceholderText("Create password"), "replacement-password");
    await userEvent.type(screen.getByPlaceholderText("Confirm password"), "replacement-password");
    await userEvent.click(screen.getByRole("button", { name: "Replace Owner" }));
    await waitFor(() => expect(mocks.replaceOwner).toHaveBeenCalledWith({ ownerName: "Replacement Owner", ownerEmail: "replacement@example.test", password: "replacement-password" }));
  });

  it("rejects mismatched passwords without calling the API", async () => {
    renderRoot();
    await screen.findByRole("heading", { name: "One-time Owner Registration" });
    await userEvent.type(screen.getByPlaceholderText("Create password"), "replacement-password");
    await userEvent.type(screen.getByPlaceholderText("Confirm password"), "different-password");
    await userEvent.click(screen.getByRole("button", { name: "Replace Owner" }));
    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(mocks.replaceOwner).not.toHaveBeenCalled();
  });
});

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

describe("Single-organization login", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.login.mockReset();
    mocks.login.mockResolvedValue({});
  });

  afterEach(() => cleanup());

  it("signs in without asking for or submitting an organization slug", async () => {
    renderRoot();
    expect(await screen.findByRole("heading", { name: "OpsWorkbench" })).toBeInTheDocument();
    const email = await screen.findByPlaceholderText("Email");
    expect(screen.queryByPlaceholderText("Organization slug")).not.toBeInTheDocument();
    await userEvent.type(email, "owner@example.test");
    await userEvent.type(screen.getByPlaceholderText("Password"), "owner-password-long");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith("owner@example.test", "owner-password-long"));
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
    for (const destination of ["Overview", "AI Website Builder", "Organization", "Users", "Servers", "Agent Upgrades", "Projects", "Configuration", "Health", "Mongo", "Tasks", "Audit", "Enrollment", "Sign out"]) {
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

  it("opens the guided AI Website Builder without starting generation", async () => {
    renderRoot();
    await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: /^AI Website Builder$/ }));
    expect(await screen.findByRole("heading", { name: "What would you like to create?", level: 2 })).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Start guided discovery" });
    expect(start).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /New business website/ }));
    expect(start).toBeEnabled();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("collects Cloudflare Access credentials inside server onboarding without exposing the secret", async () => {
    renderRoot();
    const trigger = await screen.findByRole("button", { name: "Open navigation" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: /^Servers$/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Add Server" }));
    expect(await screen.findByLabelText("Cloudflare Access client ID")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("Cloudflare Access client secret")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Create and generate bootstrap" })).toBeDisabled();
    expect(screen.queryByText(/CF-Access-Client-Secret:/)).not.toBeInTheDocument();
  });
});
