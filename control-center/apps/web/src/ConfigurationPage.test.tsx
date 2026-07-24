import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const apiPatch = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({
  api: { get: apiGet, post: apiPost, patch: apiPatch },
  apiError: (error: { response?: { data?: { code?: string; error?: string } }; message?: string }) => error?.response?.data?.code === "RECENT_AUTH_REQUIRED"
    ? "Please sign out and sign back in, then retry this protected action within 10 minutes."
    : error?.response?.data?.error || error?.message || "Configuration unavailable"
}));
import { ConfigurationPage } from "./ConfigurationPage";

function renderPage(path = "/configuration") {
  window.history.replaceState({}, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const navigate = vi.fn();
  render(<QueryClientProvider client={client}><ConfigurationPage toast={() => undefined} navigate={navigate} /></QueryClientProvider>);
  return navigate;
}

afterEach(() => { cleanup(); apiGet.mockReset(); apiPost.mockReset(); apiPatch.mockReset(); window.history.replaceState({}, "", "/"); });

describe("Configuration workspace foundation", () => {
  it("renders project context, workspace navigation, and project-scoped variables without secrets", async () => {
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta", slug: "crafters-market-beta" }, { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Other Tenant" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Beta", kind: "staging", protected: false }] } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [{ _id: "dddddddddddddddddddddddd", name: "API_BASE_URL", description: "Public API URL", type: "url", secret: false, required: true, provider: "application", usage: "runtime", status: "configured", sources: ["manual"], sourcePaths: [".env"], services: ["web"], activeVersion: 1, risk: "low", removalPermitted: false, browserDisplayPermitted: true, restartRequirement: "reload" }, { _id: "eeeeeeeeeeeeeeeeeeeeeeee", name: "CLOUDFLARE_ACCESS_CLIENT_SECRET", description: "Cloudflare Access credential", type: "secret", secret: true, required: false, provider: "cloudflare", usage: "runtime", status: "pending", sources: ["manual"], sourcePaths: [], services: ["agent"], activeVersion: 1, risk: "high", removalPermitted: true, browserDisplayPermitted: false, restartRequirement: "restart" }], versions: [{ definitionId: "dddddddddddddddddddddddd", environmentId: "cccccccccccccccccccccccc", version: 1, masked: "Configured", state: "active", validationState: "valid", createdAt: "2026-07-23T12:00:00.000Z" }, { definitionId: "eeeeeeeeeeeeeeeeeeeeeeee", environmentId: "cccccccccccccccccccccccc", version: 1, masked: "Configured", state: "pending", validationState: "not_run", createdAt: "2026-07-23T12:30:00.000Z" }] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });

    const navigate = renderPage();
    expect(await screen.findByText("Crafters Market Beta")).toBeInTheDocument();
    expect(screen.getByText("crafters-market-beta")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Project environment workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Environment" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/selected project and environment only/i)).toBeInTheDocument();
    expect(await screen.findByText("API_BASE_URL")).toBeInTheDocument();
    expect(await screen.findByText("CLOUDFLARE_ACCESS_CLIENT_SECRET")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/actual-secret|mongodb:\/\/|bearer token/i);

    await userEvent.click(screen.getByRole("button", { name: "Overview" }));
    await userEvent.click(screen.getByRole("button", { name: "Deployments" }));
    await userEvent.click(screen.getByRole("button", { name: "Rollbacks" }));
    expect(navigate).toHaveBeenNthCalledWith(1, "/projects/aaaaaaaaaaaaaaaaaaaaaaaa/overview");
    expect(navigate).toHaveBeenNthCalledWith(2, "/projects/aaaaaaaaaaaaaaaaaaaaaaaa/deployments");
    expect(navigate).toHaveBeenNthCalledWith(3, "/projects/aaaaaaaaaaaaaaaaaaaaaaaa/rollbacks");
  });

  it("uses honest empty states when no project or environment exists", async () => {
    apiGet.mockImplementation((path: string) => path === "/projects" ? Promise.resolve({ data: { projects: [] } }) : path === "/configuration/environments" ? Promise.resolve({ data: { environments: [] } }) : Promise.resolve({ data: { definitions: [], versions: [] } }));
    renderPage();

    expect(await screen.findByText(/No project is selected/i)).toBeInTheDocument();
    expect(screen.getByText("Select project")).toBeInTheDocument();
    expect(screen.getByText("Select an application")).toBeInTheDocument();
  });

  it("honors projectId from Project workspace links and creates environments only for that project", async () => {
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }, { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Other Tenant" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [] } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "bbbbbbbbbbbbbbbbbbbbbbbb") return Promise.resolve({ data: { definitions: [], versions: [] } });
      return Promise.resolve({ data: { definitions: [{ _id: "leak", name: "WRONG_PROJECT_VALUE", type: "text", secret: false, required: false, usage: "runtime", status: "configured", sources: [], services: [] }], versions: [] } });
    });
    apiPost.mockResolvedValue({ data: { id: "cccccccccccccccccccccccc" } });
    renderPage("/configuration?projectId=bbbbbbbbbbbbbbbbbbbbbbbb");

    const project = await screen.findByLabelText("Configuration project");
    await waitFor(() => expect(project).toHaveDisplayValue("Other Tenant"));
    await waitFor(() => expect(project).toHaveValue("bbbbbbbbbbbbbbbbbbbbbbbb"));
    expect(screen.getByRole("button", { name: "Create environment" })).toBeInTheDocument();
    expect(screen.queryByText("WRONG_PROJECT_VALUE")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Environment name"), "Preview");
    await userEvent.selectOptions(screen.getByLabelText("Environment kind"), "preview");
    await userEvent.click(screen.getByRole("button", { name: "Create environment" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/configuration/environments", { projectId: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Preview", kind: "preview", protected: false }));
  });

  it("edits only the selected non-production environment metadata", async () => {
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Beta", kind: "staging", protected: false }] } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [], versions: [] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    apiPatch.mockResolvedValue({ data: { id: "cccccccccccccccccccccccc", name: "Preview", kind: "preview", protected: false } });
    renderPage("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");

    expect(await screen.findByText("Beta (staging)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit selected environment" }));
    await userEvent.clear(screen.getByLabelText("Edit environment name"));
    await userEvent.type(screen.getByLabelText("Edit environment name"), "Preview");
    await userEvent.selectOptions(screen.getByLabelText("Edit environment kind"), "preview");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("/configuration/environments/cccccccccccccccccccccccc", { name: "Preview", kind: "preview", protected: false }));
  });

  it("creates environment-scoped variables and saves pending values with truthful operations", async () => {
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Preview", kind: "preview", protected: false }] } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [{ _id: "dddddddddddddddddddddddd", name: "PUBLIC_API_URL", description: "Public API URL", type: "url", secret: false, required: false, usage: "runtime", status: "missing", sources: ["manual"], services: [], risk: "low", removalPermitted: true, browserDisplayPermitted: true, restartRequirement: "reload" }], versions: [] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    apiPost.mockResolvedValue({ data: { id: "new" } });
    renderPage("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");

    expect(await screen.findByText("Preview (preview)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add Variable" }));
    await userEvent.type(screen.getByLabelText("Variable name"), "NEW_PUBLIC_URL");
    await userEvent.selectOptions(screen.getByLabelText("Variable type"), "url");
    await userEvent.selectOptions(screen.getByLabelText("Restart behavior"), "reload");
    await userEvent.click(screen.getByLabelText("Required for this environment"));
    await userEvent.click(screen.getAllByRole("button", { name: "Add Variable" }).at(-1)!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/configuration/definitions", expect.objectContaining({ projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "NEW_PUBLIC_URL", type: "url", secret: false, required: true, applicableEnvironments: ["preview"], validation: { type: "url" }, restartRequirement: "reload", browserDisplayPermitted: true })));

    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByLabelText("Configuration operation")).toHaveDisplayValue("Add first value");
    await userEvent.type(screen.getByLabelText("Configuration value"), "https://api.example.test");
    await userEvent.type(screen.getByLabelText("Change reason"), "initial setup");
    await userEvent.click(screen.getByRole("button", { name: "Save as Pending Deployment" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/configuration/definitions/dddddddddddddddddddddddd/versions", { environmentId: "cccccccccccccccccccccccc", operation: "add", value: "https://api.example.test", changeReason: "initial setup" }));
  }, 10000);

  it("does not silently fall back when an explicit projectId is unavailable", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Available Project" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Staging", kind: "staging", protected: false }] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    renderPage("/configuration?projectId=ffffffffffffffffffffffff");

    expect(await screen.findByRole("alert")).toHaveTextContent("requested project is unavailable");
    const project = screen.getByLabelText("Configuration project");
    expect(project).toHaveValue("");
    expect(project).toHaveDisplayValue("Select application");
    expect(screen.queryByText("Available Project")).toBeInTheDocument();
  });

  it("connects Import .env preview names to the safe Add Variable workflow without uploading values", async () => {
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Preview", kind: "preview", protected: false }] } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [], versions: [] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    apiPost.mockResolvedValue({ data: { id: "new" } });
    renderPage("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");

    expect(await screen.findByText("Preview (preview)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import .env" }));
    await userEvent.type(screen.getByLabelText("Environment text"), "NEW_PUBLIC_URL=https://example.test");
    await userEvent.click(screen.getByRole("button", { name: "Preview names" }));
    await screen.findByText("NEW_PUBLIC_URL");
    await userEvent.click(screen.getByRole("button", { name: "Add definition" }));

    expect(screen.getByRole("heading", { name: "Add Variable" })).toBeInTheDocument();
    expect(screen.getByLabelText("Variable name")).toHaveValue("NEW_PUBLIC_URL");
    expect(screen.getByLabelText("Variable type")).toHaveValue("url");
    expect(document.body.textContent).not.toContain("https://example.test");

    await userEvent.click(screen.getAllByRole("button", { name: "Add Variable" }).at(-1)!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/configuration/definitions", expect.not.objectContaining({ value: "https://example.test" })));
    expect(apiPost).toHaveBeenCalledWith("/configuration/definitions", expect.objectContaining({ name: "NEW_PUBLIC_URL", applicableEnvironments: ["preview"], validation: { type: "url" } }));
  }, 10000);

  it("connects guided onboarding to import and read-only website validation", async () => {
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Preview", kind: "preview", protected: false }] } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [], versions: [] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    renderPage("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");

    expect(await screen.findByText("Preview (preview)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guided Onboarding" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Open Import .env" }));
    expect(screen.getByRole("heading", { name: "Import .env safely" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close and clear" }));
    await userEvent.click(screen.getByRole("button", { name: "Validate Website" }));
    expect(await screen.findByRole("heading", { name: "Website validation" })).toBeInTheDocument();
    expect(screen.getByText(/No deployment, promotion, server action, or secret display occurred/i)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("creates a value-free immutable deployment plan from pending versions and the enabled target profile", async () => {
    const digest = "a".repeat(64);
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string; environmentId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Beta", kind: "staging", protected: false }] } });
      if (path === "/configuration/deployment-targets" && options?.params?.environmentId === "cccccccccccccccccccccccc") return Promise.resolve({ data: { targets: [{ _id: "ffffffffffffffffffffffff", serverId: "111111111111111111111111", revision: 4, composeProject: "crafters", statelessServices: ["web"], protectedServices: ["mongo"], healthChecks: [{ id: "web", url: "https://craftersmarketbeta.shop/healthz", timeoutMs: 1000 }], currentConfigurationDigest: digest }] } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [{ _id: "dddddddddddddddddddddddd", name: "PUBLIC_SITE_URL", description: "Public site URL", type: "url", secret: false, required: true, usage: "runtime", status: "pending", sources: ["manual"], services: ["web"], activeVersion: 2, risk: "low", removalPermitted: false, browserDisplayPermitted: true, restartRequirement: "reload" }, { _id: "eeeeeeeeeeeeeeeeeeeeeeee", name: "MAILGUN_API_KEY", description: "Mailgun API key", type: "secret", secret: true, required: false, usage: "runtime", status: "pending", sources: ["manual"], services: ["api"], activeVersion: 2, risk: "high", removalPermitted: true, browserDisplayPermitted: false, restartRequirement: "restart" }], versions: [{ _id: "121212121212121212121212", definitionId: "dddddddddddddddddddddddd", environmentId: "cccccccccccccccccccccccc", version: 2, masked: "Configured", state: "pending", validationState: "unverified", createdAt: "2026-07-23T12:00:00.000Z" }, { _id: "343434343434343434343434", definitionId: "eeeeeeeeeeeeeeeeeeeeeeee", environmentId: "cccccccccccccccccccccccc", version: 2, masked: "Configured", state: "pending", validationState: "unverified", createdAt: "2026-07-23T12:01:00.000Z" }] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    apiPost.mockImplementation((path: string, _body: unknown) => {
      if (path === "/configuration/deployment-plans") return Promise.resolve({ data: { id: "999999999999999999999999", revision: 7, state: "pending_approval", changeDigest: "b".repeat(64), approvalExpiresAt: "2026-07-23T12:15:00.000Z", proposedDiff: [{ name: "MAILGUN_API_KEY", operation: "rotate", classification: "secret", proposedValue: "[redacted]" }, { name: "PUBLIC_SITE_URL", operation: "update", classification: "non-secret", proposedValue: "[pending value]" }] } });
      return Promise.resolve({ data: { id: "unexpected" } });
    });
    renderPage("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");

    expect(await screen.findByText("2 settings prepared for Beta.")).toBeInTheDocument();
    const createPlan = await screen.findByRole("button", { name: "Create immutable plan" });
    await waitFor(() => expect(createPlan).toBeEnabled());
    await userEvent.click(createPlan);

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/configuration/deployment-plans", { projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", environmentId: "cccccccccccccccccccccccc", targetProfileId: "ffffffffffffffffffffffff", versionIds: ["121212121212121212121212", "343434343434343434343434"], expectedConfigurationDigest: digest }));
    expect(await screen.findByRole("heading", { name: "Immutable deployment plan" })).toBeInTheDocument();
    expect(screen.getByText("999999999999999999999999")).toBeInTheDocument();
    expect(screen.getAllByText("pending approval").length).toBeGreaterThan(0);
    expect(screen.getByText("[redacted]")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/actual-secret|mongodb:\/\/|bearer token/i);
  });

  it("shows recent-auth requirements next to immutable plan creation", async () => {
    const digest = "a".repeat(64);
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string; environmentId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Beta", kind: "staging", protected: false }] } });
      if (path === "/configuration/deployment-targets" && options?.params?.environmentId === "cccccccccccccccccccccccc") return Promise.resolve({ data: { targets: [{ _id: "ffffffffffffffffffffffff", serverId: "111111111111111111111111", revision: 4, composeProject: "crafters", statelessServices: ["web"], protectedServices: ["mongo"], healthChecks: [{ id: "web", url: "https://craftersmarketbeta.shop/healthz", timeoutMs: 1000 }], currentConfigurationDigest: digest }] } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [{ _id: "dddddddddddddddddddddddd", name: "PUBLIC_SITE_URL", description: "Public site URL", type: "url", secret: false, required: true, usage: "runtime", status: "pending", sources: ["manual"], services: ["web"], activeVersion: 2, risk: "low", removalPermitted: false, browserDisplayPermitted: true, restartRequirement: "reload" }], versions: [{ _id: "121212121212121212121212", definitionId: "dddddddddddddddddddddddd", environmentId: "cccccccccccccccccccccccc", version: 2, masked: "Configured", state: "pending", validationState: "unverified", createdAt: "2026-07-23T12:00:00.000Z" }] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    apiPost.mockRejectedValue({ response: { status: 403, data: { code: "RECENT_AUTH_REQUIRED", error: "Recent authentication required" } } });
    renderPage("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");

    expect(await screen.findByText("1 setting prepared for Beta.")).toBeInTheDocument();
    const createPlan = await screen.findByRole("button", { name: "Create immutable plan" });
    await waitFor(() => expect(createPlan).toBeEnabled());
    await userEvent.click(createPlan);

    expect(await screen.findByRole("alert")).toHaveTextContent("Please sign out and sign back in");
    expect(screen.getByRole("alert")).toHaveTextContent("within 10 minutes");
  });

  it("rehydrates an existing pending immutable deployment plan after page navigation", async () => {
    const digest = "a".repeat(64);
    const changeDigest = "c".repeat(64);
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string; environmentId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Beta", kind: "staging", protected: false }] } });
      if (path === "/configuration/deployment-targets" && options?.params?.environmentId === "cccccccccccccccccccccccc") return Promise.resolve({ data: { targets: [{ _id: "ffffffffffffffffffffffff", serverId: "111111111111111111111111", revision: 4, composeProject: "crafters", statelessServices: ["web"], protectedServices: ["mongo"], healthChecks: [{ id: "web", url: "https://craftersmarketbeta.shop/healthz", timeoutMs: 1000 }], currentConfigurationDigest: digest }] } });
      if (path === "/configuration/deployment-plans" && options?.params?.environmentId === "cccccccccccccccccccccccc") return Promise.resolve({ data: { plan: { id: "999999999999999999999999", revision: 7, state: "pending_approval", changeDigest, approvalExpiresAt: "2026-07-23T12:15:00.000Z", proposedDiff: [{ name: "MAILGUN_API_KEY", operation: "rotate", classification: "secret", proposedValue: "[redacted]" }, { name: "PUBLIC_SITE_URL", operation: "update", classification: "non-secret", proposedValue: "[pending value]" }] } } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [{ _id: "dddddddddddddddddddddddd", name: "PUBLIC_SITE_URL", description: "Public site URL", type: "url", secret: false, required: true, usage: "runtime", status: "pending", sources: ["manual"], services: ["web"], activeVersion: 2, risk: "low", removalPermitted: false, browserDisplayPermitted: true, restartRequirement: "reload" }, { _id: "eeeeeeeeeeeeeeeeeeeeeeee", name: "MAILGUN_API_KEY", description: "Mailgun API key", type: "secret", secret: true, required: false, usage: "runtime", status: "pending", sources: ["manual"], services: ["api"], activeVersion: 2, risk: "high", removalPermitted: true, browserDisplayPermitted: false, restartRequirement: "restart" }], versions: [{ _id: "121212121212121212121212", definitionId: "dddddddddddddddddddddddd", environmentId: "cccccccccccccccccccccccc", version: 2, masked: "Configured", state: "pending", validationState: "unverified", createdAt: "2026-07-23T12:00:00.000Z" }, { _id: "343434343434343434343434", definitionId: "eeeeeeeeeeeeeeeeeeeeeeee", environmentId: "cccccccccccccccccccccccc", version: 2, masked: "Configured", state: "pending", validationState: "unverified", createdAt: "2026-07-23T12:01:00.000Z" }] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    renderPage("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");

    expect(await screen.findByRole("heading", { name: "Immutable deployment plan" })).toBeInTheDocument();
    expect(screen.getByText("999999999999999999999999")).toBeInTheDocument();
    expect(screen.getByText(changeDigest)).toBeInTheDocument();
    expect(screen.getAllByText("pending approval").length).toBeGreaterThan(0);
    expect(await screen.findByRole("button", { name: "Create immutable plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve as different administrator" })).toBeEnabled();
    expect(screen.getByText("[redacted]")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/actual-secret|mongodb:\/\/|bearer token/i);
  });

  it("approves an existing pending immutable deployment plan with the exact change digest", async () => {
    const digest = "a".repeat(64);
    const changeDigest = "d".repeat(64);
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string; environmentId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Beta", kind: "staging", protected: false }] } });
      if (path === "/configuration/deployment-targets" && options?.params?.environmentId === "cccccccccccccccccccccccc") return Promise.resolve({ data: { targets: [{ _id: "ffffffffffffffffffffffff", serverId: "111111111111111111111111", revision: 4, composeProject: "crafters", statelessServices: ["web"], protectedServices: ["mongo"], healthChecks: [{ id: "web", url: "https://craftersmarketbeta.shop/healthz", timeoutMs: 1000 }], currentConfigurationDigest: digest }] } });
      if (path === "/configuration/deployment-plans" && options?.params?.environmentId === "cccccccccccccccccccccccc") return Promise.resolve({ data: { plan: { id: "999999999999999999999999", revision: 7, state: "pending_approval", changeDigest, approvalExpiresAt: "2026-07-23T12:15:00.000Z", proposedDiff: [{ name: "MAILGUN_API_KEY", operation: "rotate", classification: "secret", proposedValue: "[redacted]" }] } } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [{ _id: "eeeeeeeeeeeeeeeeeeeeeeee", name: "MAILGUN_API_KEY", description: "Mailgun API key", type: "secret", secret: true, required: false, usage: "runtime", status: "pending", sources: ["manual"], services: ["api"], activeVersion: 2, risk: "high", removalPermitted: true, browserDisplayPermitted: false, restartRequirement: "restart" }], versions: [{ _id: "343434343434343434343434", definitionId: "eeeeeeeeeeeeeeeeeeeeeeee", environmentId: "cccccccccccccccccccccccc", version: 2, masked: "Configured", state: "pending", validationState: "unverified", createdAt: "2026-07-23T12:01:00.000Z" }] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    apiPost.mockImplementation((path: string, body: unknown) => {
      if (path === "/configuration/deployment-plans/999999999999999999999999/approve") return Promise.resolve({ data: { state: "queued", taskId: "777777777777777777777777", body } });
      return Promise.resolve({ data: { id: "unexpected" } });
    });
    renderPage("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");

    const approve = await screen.findByRole("button", { name: "Approve as different administrator" });
    await waitFor(() => expect(approve).toBeEnabled());
    await userEvent.click(approve);

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/configuration/deployment-plans/999999999999999999999999/approve", { changeDigest }));
    await waitFor(() => expect(screen.getAllByText("queued").length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toMatch(/actual-secret|mongodb:\/\/|bearer token/i);
  });

  it("shows approval errors instead of silently ignoring the approval button", async () => {
    const digest = "a".repeat(64);
    const changeDigest = "e".repeat(64);
    apiGet.mockImplementation((path: string, options?: { params?: { projectId?: string; environmentId?: string } }) => {
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market Beta" }] } });
      if (path === "/configuration/environments") return Promise.resolve({ data: { environments: [{ _id: "cccccccccccccccccccccccc", projectId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Beta", kind: "staging", protected: false }] } });
      if (path === "/configuration/deployment-targets" && options?.params?.environmentId === "cccccccccccccccccccccccc") return Promise.resolve({ data: { targets: [{ _id: "ffffffffffffffffffffffff", serverId: "111111111111111111111111", revision: 4, composeProject: "crafters", statelessServices: ["web"], protectedServices: ["mongo"], healthChecks: [{ id: "web", url: "https://craftersmarketbeta.shop/healthz", timeoutMs: 1000 }], currentConfigurationDigest: digest }] } });
      if (path === "/configuration/deployment-plans" && options?.params?.environmentId === "cccccccccccccccccccccccc") return Promise.resolve({ data: { plan: { id: "999999999999999999999999", revision: 7, state: "pending_approval", changeDigest, approvalExpiresAt: "2026-07-23T12:15:00.000Z", proposedDiff: [{ name: "MAILGUN_API_KEY", operation: "rotate", classification: "secret", proposedValue: "[redacted]" }] } } });
      if (path === "/configuration/definitions" && options?.params?.projectId === "aaaaaaaaaaaaaaaaaaaaaaaa") return Promise.resolve({ data: { definitions: [{ _id: "eeeeeeeeeeeeeeeeeeeeeeee", name: "MAILGUN_API_KEY", description: "Mailgun API key", type: "secret", secret: true, required: false, usage: "runtime", status: "pending", sources: ["manual"], services: ["api"], activeVersion: 2, risk: "high", removalPermitted: true, browserDisplayPermitted: false, restartRequirement: "restart" }], versions: [{ _id: "343434343434343434343434", definitionId: "eeeeeeeeeeeeeeeeeeeeeeee", environmentId: "cccccccccccccccccccccccc", version: 2, masked: "Configured", state: "pending", validationState: "unverified", createdAt: "2026-07-23T12:01:00.000Z" }] } });
      return Promise.resolve({ data: { definitions: [], versions: [] } });
    });
    apiPost.mockRejectedValue({ response: { status: 409, data: { error: "Deployment approval window expired" } } });
    renderPage("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");

    const approve = await screen.findByRole("button", { name: "Approve as different administrator" });
    await waitFor(() => expect(approve).toBeEnabled());
    await userEvent.click(approve);

    expect(await screen.findByRole("alert")).toHaveTextContent("Deployment approval window expired");
    expect(apiPost).toHaveBeenCalledWith("/configuration/deployment-plans/999999999999999999999999/approve", { changeDigest });
  });
});
