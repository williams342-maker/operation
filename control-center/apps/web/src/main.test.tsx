import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
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
  changePassword: mocks.changePassword,
  bootstrapOwner: vi.fn(),
  bootstrapStatus: mocks.bootstrapStatus,
  isRecentAuthRequired: vi.fn(() => false),
  login: mocks.login,
  logout: mocks.logout,
  reauthenticate: vi.fn(),
  replaceOwner: mocks.replaceOwner,
  PASSWORD_CHANGE_REQUIRED_EVENT: "cc:password-change-required",
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

describe("Mandatory one-time password change", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockImplementation(authenticatedApi);
    mocks.changePassword.mockReset();
    mocks.login.mockReset();
  });
  afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

  it("blocks the admin shell on refresh before requesting protected resources", async () => {
    localStorage.setItem("cc.csrf", "csrf");
    mocks.apiGet.mockImplementation((path: string) => path === "/me" ? Promise.resolve({ data: { mustChangePassword: true, user: { role: "Owner" } } }) : authenticatedApi(path));
    mocks.apiGet.mockClear();
    renderRoot();
    expect(await screen.findByRole("heading", { name: "Change your one-time password" })).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(mocks.apiGet.mock.calls.every(([path]) => path === "/me")).toBe(true);
  });

  it("blocks alternate Foundry navigation on refresh", async () => {
    localStorage.setItem("cc.csrf", "csrf");
    window.history.replaceState({}, "", "/foundry/projects");
    mocks.apiGet.mockResolvedValue({ data: { mustChangePassword: true, user: { role: "Developer" } } });
    renderRoot();
    expect(await screen.findByRole("heading", { name: "Change your one-time password" })).toBeInTheDocument();
    expect(screen.queryByText("My Projects")).not.toBeInTheDocument();
  });

  it("honors the login flag and only leaves after a successful password change", async () => {
    mocks.login.mockResolvedValue({ mustChangePassword: true });
    renderRoot();
    await userEvent.type(await screen.findByPlaceholderText("Email"), "invited@example.test");
    await userEvent.type(screen.getByPlaceholderText("Password"), "issued-password-long");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Change your one-time password" });
    await userEvent.type(screen.getByPlaceholderText("One-time password"), "issued-password-long");
    await userEvent.type(screen.getByPlaceholderText("New password"), "chosen-password-long");
    await userEvent.type(screen.getByPlaceholderText("Confirm new password"), "chosen-password-long");
    mocks.changePassword.mockRejectedValueOnce(new Error("This one-time password has expired. Ask an administrator to re-issue it."));
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText(/This one-time password has expired/)).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    mocks.changePassword.mockResolvedValueOnce({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Change your one-time password" })).not.toBeInTheDocument());
    expect(mocks.changePassword).toHaveBeenLastCalledWith("issued-password-long", "chosen-password-long");
  });

  it("a protected API gate event immediately replaces normal navigation", async () => {
    localStorage.setItem("cc.csrf", "csrf");
    renderRoot();
    await screen.findByRole("button", { name: /sign out/i });
    window.dispatchEvent(new Event("cc:password-change-required"));
    expect(await screen.findByRole("heading", { name: "Change your one-time password" })).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });
});

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
    mocks.apiPost.mockReset();
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
    for (const destination of ["Overview", "AI Website Builder", "SEO Optimizer", "AI Workforce", "Organization", "Users", "Servers", "Agent Upgrades", "Projects", "Configuration", "Health", "Mongo", "Tasks", "Audit", "Enrollment", "Sign out"]) {
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
    // "Open Foundry" is the first focusable item in the drawer, so it receives
    // initial focus and is the wrap target of the Tab trap.
    const firstItem = screen.getByRole("button", { name: /Open Foundry/i });
    await waitFor(() => expect(firstItem).toHaveFocus());
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: /sign out/i })).toHaveFocus();
    await userEvent.tab();
    expect(firstItem).toHaveFocus();
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

  it("creates a workflow and saves one guided discovery answer at a time", async () => {
    mocks.apiPost
      .mockResolvedValueOnce({ data: { workflow: { id: "workflow-1", version: 1, currentQuestionIndex: 0, stage: "discovery" }, question: { id: "business_name", prompt: "What is the name of your business or organization?", help: "Use the public name visitors should see." } } })
      .mockResolvedValueOnce({ data: { workflow: { id: "workflow-1", version: 1, currentQuestionIndex: 1, stage: "discovery" }, question: { id: "business_purpose", prompt: "What does your business do?", help: "Describe your work." } } });
    renderRoot();
    await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: /^AI Website Builder$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /New business website/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start guided discovery" }));
    expect(await screen.findByRole("heading", { name: "What is the name of your business or organization?" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "Acme Makers");
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenNthCalledWith(1, "/website-builder/workflows", { websiteType: "business" }, { headers: { "Idempotency-Key": expect.any(String) } }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenNthCalledWith(2, "/website-builder/workflows/workflow-1/answers", { questionId: "business_name", value: "Acme Makers" }, { headers: { "If-Match": "1" } }));
    expect(await screen.findByRole("heading", { name: "What does your business do?" })).toBeInTheDocument();
    expect(screen.getByText("Manual discovery; paid providers are Upcoming.")).toBeInTheDocument();
  });

  it("runs a read-only SEO audit and renders deterministic findings", async () => {
    mocks.apiGet.mockImplementation((path: string) => path === "/seo-audits" ? Promise.resolve({ data: { audits: [] } }) : authenticatedApi(path));
    mocks.apiPost.mockResolvedValue({ data: { audit: { _id: "audit-1", score: 88 } } });
    renderRoot();
    await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: /^SEO Optimizer$/ }));
    expect(await screen.findByRole("heading", { name: "Audit a public page" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Website URL"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Run SEO audit" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/seo-audits", { url: "https://example.com" }));
    expect(await screen.findByText("SEO audit complete: 88/100")).toBeInTheDocument();
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

describe("Users: Add user", () => {
  const users = [{ _id: "u1", name: "Existing Owner", email: "owner@example.test", role: "Owner", createdAt: "2026-09-01T00:00:00Z" }];
  const usersApi = (role: string) => (path: string) => {
    if (path === "/me") return Promise.resolve({ data: { user: { role, id: "u1" } } });
    if (path === "/org/users") return Promise.resolve({ data: { users, total: users.length } });
    return authenticatedApi(path);
  };
  const openUsers = async () => {
    renderRoot();
    await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: /^Users$/ }));
  };
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc.csrf", "csrf-token");
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockReset();
    mocks.apiGet.mockImplementation(usersApi("Owner"));
    mocks.apiPost.mockReset();
  });
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it("validates required fields and email format before calling the API", async () => {
    await openUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add user" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add user" }));
    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter an email address.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Name"), "QA Smoke Test (automated)");
    await userEvent.type(within(dialog).getByLabelText("Email"), "not-an-email");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add user" }));
    expect(within(dialog).getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("creates a Viewer by default, shows the one-time password once with a copy control, and refreshes the list", async () => {
    let resolvePost: (value: unknown) => void = () => {};
    mocks.apiPost.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await openUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add user" });
    expect(within(dialog).getByLabelText("Role")).toHaveValue("Viewer");
    await userEvent.type(within(dialog).getByLabelText("Name"), " QA Smoke Test (automated) ");
    await userEvent.type(within(dialog).getByLabelText("Email"), "qa-smoke@example.test");
    // Two submits in the same tick, before React can re-render the button as disabled.
    const form = within(dialog).getByRole("button", { name: "Add user" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await within(dialog).findByRole("button", { name: "Adding…" })).toBeDisabled();
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalled());
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    // Closing mid-request would lose the only copy of the password, so it is refused.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Add user" })).toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledWith("/org/users", { name: "QA Smoke Test (automated)", email: "qa-smoke@example.test", role: "Viewer" });
    const listCallsBefore = mocks.apiGet.mock.calls.filter(([path]) => path === "/org/users").length;
    resolvePost({ data: { id: "new", oneTimePassword: "otp-value-shown-once" } });
    const done = await screen.findByRole("dialog", { name: "User added" });
    expect(within(done).getByLabelText("One-time password")).toHaveValue("otp-value-shown-once");
    await waitFor(() => expect(mocks.apiGet.mock.calls.filter(([path]) => path === "/org/users").length).toBeGreaterThan(listCallsBefore));
    await userEvent.click(within(done).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("otp-value-shown-once");
    expect(await within(done).findByText("Copied to clipboard.")).toBeInTheDocument();
    await userEvent.click(within(done).getByRole("button", { name: "Done" }));
    expect(screen.queryByDisplayValue("otp-value-shown-once")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("otp-value-shown-once");
    expect(JSON.stringify(localStorage)).not.toContain("otp-value-shown-once");
    expect(window.location.href).not.toContain("otp-value-shown-once");
  });

  it("binds the returned password to the submitted recipient while a request is pending", async () => {
    let resolvePost: (value: unknown) => void = () => {};
    mocks.apiPost.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));
    await openUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add user" });
    const name = within(dialog).getByLabelText("Name");
    const email = within(dialog).getByLabelText("Email");
    const role = within(dialog).getByLabelText("Role");
    await userEvent.type(name, "First recipient");
    await userEvent.type(email, "first@example.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add user" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/org/users", { name: "First recipient", email: "first@example.test", role: "Viewer" }));
    // Dispatch changes directly to exercise snapshot safety independently of the disabled controls.
    fireEvent.change(name, { target: { value: "Later recipient" } });
    fireEvent.change(email, { target: { value: "later@example.test" } });
    fireEvent.change(role, { target: { value: "Administrator" } });
    resolvePost({ data: { id: "new", oneTimePassword: "synthetic-recipient-bound-password" } });
    const done = await screen.findByRole("dialog", { name: "User added" });
    expect(within(done).getByText("first@example.test")).toBeInTheDocument();
    expect(within(done).queryByText("later@example.test")).not.toBeInTheDocument();
    expect(within(done).getByLabelText("One-time password")).toHaveValue("synthetic-recipient-bound-password");
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(name).toBeDisabled();
    expect(email).toBeDisabled();
    expect(role).toBeDisabled();
    await userEvent.click(within(done).getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    const reopened = screen.getByRole("dialog", { name: "Add user" });
    expect(within(reopened).getByLabelText("Name")).toHaveValue("");
    expect(within(reopened).getByLabelText("Email")).toHaveValue("");
    expect(within(reopened).getByLabelText("Role")).toHaveValue("Viewer");
    expect(screen.queryByDisplayValue("synthetic-recipient-bound-password")).not.toBeInTheDocument();
  });

  it("shows duplicate-email and server errors without issuing a password", async () => {
    mocks.apiPost.mockRejectedValueOnce(new Error("A user with this email already exists")).mockRejectedValueOnce(new Error("Internal server error"));
    await openUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add user" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Existing");
    await userEvent.type(within(dialog).getByLabelText("Email"), "owner@example.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add user" }));
    expect(await within(dialog).findByText("A user with this email already exists")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add user" }));
    expect(await within(dialog).findByText("Internal server error")).toBeInTheDocument();
    expect(screen.queryByLabelText("One-time password")).not.toBeInTheDocument();
  });

  it("offers the Owner role only to Owners", async () => {
    mocks.apiGet.mockImplementation(usersApi("Administrator"));
    await openUsers();
    await userEvent.click(await screen.findByRole("button", { name: "Add user" }));
    const roles = within(screen.getByRole("dialog", { name: "Add user" })).getAllByRole("option").map((option) => option.textContent);
    expect(roles).toEqual(["Viewer", "Developer", "Administrator"]);
  });

  it("does not offer Add user to Viewers or Developers", async () => {
    for (const role of ["Viewer", "Developer"]) {
      mocks.apiGet.mockImplementation(usersApi(role));
      await openUsers();
      await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/me"));
      expect(await screen.findByText("owner@example.test")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add user" })).not.toBeInTheDocument();
      cleanup();
    }
    // Control: the same render path does show the button once the role allows it.
    mocks.apiGet.mockImplementation(usersApi("Administrator"));
    await openUsers();
    expect(await screen.findByRole("button", { name: "Add user" })).toBeInTheDocument();
  });

});

describe("Users: Reset password", () => {
  const viewerUpdatedAt = "2026-09-02T00:00:00.000Z";
  let users: Array<Record<string, string>>;
  const usersApi = (path: string) => {
    if (path === "/me") return Promise.resolve({ data: { user: { role: "Owner", id: "u1" } } });
    // Fresh objects per fetch, like a real response.
    if (path === "/org/users") return Promise.resolve({ data: { users: users.map((user) => ({ ...user })), total: users.length } });
    return authenticatedApi(path);
  };
  const openUsers = async () => {
    renderRoot();
    await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: /^Users$/ }));
  };
  const rowFor = async (email: string) => (await within(await screen.findByRole("table")).findByText(email)).closest("tr") as HTMLElement;
  const resetButtonFor = async (email: string) => within(await rowFor(email)).getByRole("button", { name: "Reset password" });
  const usersFetches = () => mocks.apiGet.mock.calls.filter(([path]) => path === "/org/users").length;
  // The owner switches tabs and comes back: TanStack Query refetches stale queries on visibilitychange.
  const returnToTab = async () => { await act(async () => { window.dispatchEvent(new Event("visibilitychange")); }); };
  const pendingPost = () => {
    let resolvePost: (value: unknown) => void = () => {};
    mocks.apiPost.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));
    return (oneTimePassword: string) => act(async () => { resolvePost({ data: { oneTimePassword } }); });
  };
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("cc.csrf", "csrf-token");
    users = [
      { _id: "u2", name: "Viewer", email: "viewer@example.test", role: "Viewer", createdAt: "2026-09-02T00:00:00Z", updatedAt: viewerUpdatedAt },
      { _id: "u1", name: "Existing Owner", email: "owner@example.test", role: "Owner", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00.000Z" },
    ];
    mocks.bootstrapStatus.mockResolvedValue({ available: false });
    mocks.apiGet.mockReset();
    mocks.apiGet.mockImplementation(usersApi);
    mocks.apiPost.mockReset();
    vi.stubGlobal("confirm", vi.fn(() => true));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a reset password in a dialog instead of a toast, conditional on the version the list showed", async () => {
    mocks.apiPost.mockResolvedValue({ data: { oneTimePassword: "reset-otp-value" } });
    await openUsers();
    await userEvent.click(await resetButtonFor("viewer@example.test"));
    const dialog = await screen.findByRole("dialog", { name: "Password reset" });
    expect(within(dialog).getByLabelText("One-time password")).toHaveValue("reset-otp-value");
    expect(within(dialog).getByText("viewer@example.test")).toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledWith("/org/users/u2/reset-password", { expectedUpdatedAt: viewerUpdatedAt });
    expect(document.body.textContent).not.toContain("reset-otp-value");
    const fetchesBeforeClose = usersFetches();
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Password reset" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("reset-otp-value")).not.toBeInTheDocument();
    await waitFor(() => expect(usersFetches()).toBeGreaterThan(fetchesBeforeClose));
    expect(document.body.textContent).not.toContain("reset-otp-value");
    expect(JSON.stringify(localStorage)).not.toContain("reset-otp-value");
    expect(JSON.stringify(sessionStorage)).not.toContain("reset-otp-value");
    expect(Object.values({ ...localStorage, ...sessionStorage }).join("")).not.toContain("reset-otp-value");
    expect(window.location.href).not.toContain("reset-otp-value");
  });

  it("keeps the dialog when a tab-return refetch inserts a newer user above the row", async () => {
    mocks.apiPost.mockResolvedValue({ data: { oneTimePassword: "reset-otp-value" } });
    await openUsers();
    const originalRow = await rowFor("viewer@example.test");
    await userEvent.click(await resetButtonFor("viewer@example.test"));
    await screen.findByRole("dialog", { name: "Password reset" });
    users.unshift({ _id: "u3", name: "Newer", email: "newer@example.test", role: "Viewer", createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00.000Z" });
    await returnToTab();
    await screen.findByText("newer@example.test");
    expect(await rowFor("viewer@example.test")).toBe(originalRow);
    const dialog = screen.getByRole("dialog", { name: "Password reset" });
    expect(within(dialog).getByLabelText("One-time password")).toHaveValue("reset-otp-value");
    expect(within(dialog).getByText("viewer@example.test")).toBeInTheDocument();
  });

  it("sends exactly one reset for a double click, and none from other rows while it is pending", async () => {
    const resolve = pendingPost();
    await openUsers();
    const button = await resetButtonFor("viewer@example.test");
    // Two clicks in the same tick, before React can re-render the button as disabled.
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(button).toBeDisabled());
    expect(await resetButtonFor("owner@example.test")).toBeDisabled();
    fireEvent.click(button);
    fireEvent.click(await resetButtonFor("owner@example.test"));
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    await resolve("single-reset-password");
    expect(within(screen.getByRole("dialog", { name: "Password reset" })).getByLabelText("One-time password")).toHaveValue("single-reset-password");
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
  });

  it("binds the password to the user it was requested for even if the list changes before the response", async () => {
    const resolve = pendingPost();
    await openUsers();
    await userEvent.click(await resetButtonFor("viewer@example.test"));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/org/users/u2/reset-password", { expectedUpdatedAt: viewerUpdatedAt }));
    // A refetch while the request is in flight replaces the row the reset started from.
    users = [
      { _id: "u3", name: "Other", email: "other@example.test", role: "Viewer", createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00.000Z" },
      users[1],
    ];
    await returnToTab();
    await screen.findByText("other@example.test");
    expect(screen.queryByText("viewer@example.test")).not.toBeInTheDocument();
    await resolve("recipient-bound-password");
    const dialog = screen.getByRole("dialog", { name: "Password reset" });
    expect(within(dialog).getByText("viewer@example.test")).toBeInTheDocument();
    expect(within(dialog).queryByText("other@example.test")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("One-time password")).toHaveValue("recipient-bound-password");
  });

  it("clears the credential on close and never shows it again for the next reset", async () => {
    mocks.apiPost.mockResolvedValueOnce({ data: { oneTimePassword: "first-reset-password" } });
    await openUsers();
    await userEvent.click(await resetButtonFor("viewer@example.test"));
    const first = await screen.findByRole("dialog", { name: "Password reset" });
    expect(within(first).getByLabelText("One-time password")).toHaveValue("first-reset-password");
    // The reset changed the user, so the refreshed list carries a new version for the next request.
    users[0] = { ...users[0], updatedAt: "2026-10-01T00:00:00.000Z" };
    const fetchesBeforeClose = usersFetches();
    await userEvent.click(within(first).getByRole("button", { name: "Done" }));
    expect(screen.queryByDisplayValue("first-reset-password")).not.toBeInTheDocument();
    await waitFor(() => expect(usersFetches()).toBeGreaterThan(fetchesBeforeClose));
    await act(async () => {});
    const resolve = pendingPost();
    await userEvent.click(await resetButtonFor("viewer@example.test"));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));
    expect(mocks.apiPost).toHaveBeenLastCalledWith("/org/users/u2/reset-password", { expectedUpdatedAt: "2026-10-01T00:00:00.000Z" });
    expect(screen.queryByRole("dialog", { name: "Password reset" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("first-reset-password")).not.toBeInTheDocument();
    await resolve("second-reset-password");
    const second = screen.getByRole("dialog", { name: "Password reset" });
    expect(within(second).getByLabelText("One-time password")).toHaveValue("second-reset-password");
    expect(screen.queryByDisplayValue("first-reset-password")).not.toBeInTheDocument();
  });

  it("shows conflict and reauthentication errors without a password dialog, and allows a retry", async () => {
    mocks.apiPost
      .mockRejectedValueOnce(new Error("User changed. Refresh and try again."))
      .mockRejectedValueOnce(new Error("Recent reauthentication required"));
    await openUsers();
    await userEvent.click(await resetButtonFor("viewer@example.test"));
    expect(await within(await rowFor("viewer@example.test")).findByText("User changed. Refresh and try again.")).toBeInTheDocument();
    expect(within(await rowFor("owner@example.test")).queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Password reset" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("One-time password")).not.toBeInTheDocument();
    await waitFor(async () => expect(await resetButtonFor("viewer@example.test")).toBeEnabled());
    await userEvent.click(await resetButtonFor("viewer@example.test"));
    expect(await within(await rowFor("viewer@example.test")).findByText("Recent reauthentication required")).toBeInTheDocument();
    expect(screen.queryByLabelText("One-time password")).not.toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledTimes(2);
  });

  it("keeps other resets disabled until Escape clears the credential, then binds a new reset to its recipient", async () => {
    mocks.apiPost.mockResolvedValueOnce({ data: { oneTimePassword: "viewer-only-password" } });
    await openUsers();
    await userEvent.click(await resetButtonFor("viewer@example.test"));
    const dialog = await screen.findByRole("dialog", { name: "Password reset" });
    const ownerButton = await resetButtonFor("owner@example.test");
    expect(ownerButton).toBeDisabled();
    fireEvent.click(ownerButton);
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByDisplayValue("viewer-only-password")).not.toBeInTheDocument();
    const resolve = pendingPost();
    await userEvent.click(await resetButtonFor("owner@example.test"));
    expect(screen.queryByRole("dialog", { name: "Password reset" })).not.toBeInTheDocument();
    await resolve("owner-only-password");
    const second = screen.getByRole("dialog", { name: "Password reset" });
    expect(within(second).getByText("owner@example.test")).toBeInTheDocument();
    expect(within(second).queryByText("viewer@example.test")).not.toBeInTheDocument();
    expect(within(second).getByLabelText("One-time password")).toHaveValue("owner-only-password");
    expect(screen.queryByDisplayValue("viewer-only-password")).not.toBeInTheDocument();
  });

  it("does not revive a credential from a stale response after leaving and reopening Users", async () => {
    const resolve = pendingPost();
    await openUsers();
    await userEvent.click(await resetButtonFor("viewer@example.test"));
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: /^Overview$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: /^Users$/ }));
    await resetButtonFor("viewer@example.test");
    await resolve("stale-response-password");
    expect(screen.queryByRole("dialog", { name: "Password reset" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("stale-response-password")).not.toBeInTheDocument();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("stale-response-password");
  });
});
