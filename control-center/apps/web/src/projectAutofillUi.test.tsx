import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

vi.mock("./api", () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost, patch: vi.fn() },
  apiError: (error: unknown) => error instanceof Error ? error.message : "Unexpected request failure",
  bootstrapOwner: vi.fn(),
  bootstrapStatus: vi.fn(),
  isRecentAuthRequired: vi.fn(() => false),
  login: vi.fn(),
  logout: vi.fn(),
  reauthenticate: vi.fn(),
  SESSION_EXPIRED_EVENT: "cc:session-expired",
}));

import { ProjectsPage } from "./main";

const now = new Date().toISOString();
const discovery = (repository: string, repoPath: string) => ({
  collectedAt: now,
  dockerInstalled: true,
  nginxInstalled: true,
  repositories: [{
    path: repoPath,
    remote: `https://github.com/${repository}.git`,
    branch: "main",
  }],
  composeProjects: [{ name: "app", configPath: `${repoPath}/docker-compose.yml`, services: ["web"] }],
  applications: [{ path: repoPath, type: "node" as const, name: "app" }],
  settings: [],
  warnings: [],
  discoveryTruncated: false,
  truncationCategories: [],
});
const server = (overrides: Record<string, unknown> = {}) => ({
  _id: "eligible-a",
  orgId: "org-a",
  name: "Eligible A",
  enrollmentStatus: "connected",
  agentStatus: "online",
  lastHeartbeatAt: now,
  currentState: { discovery: discovery("acme/app-a", "/srv/app-a") },
  ...overrides,
});

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ProjectsPage toast={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("Projects server eligibility", () => {
  let servers: ReturnType<typeof server>[];
  let client: QueryClient;

  beforeEach(() => {
    servers = [
      server(),
      server({ _id: "eligible-b", name: "Eligible B", currentState: { discovery: discovery("acme/app-b", "/srv/app-b") } }),
      server({ _id: "pending", name: "Pending", enrollmentStatus: "pending", agentStatus: "never_connected" }),
      server({ _id: "offline", name: "Offline", agentStatus: "offline" }),
      server({ _id: "revoked", name: "Revoked", revokedAt: now }),
      server({ _id: "other-org", name: "Other org", orgId: "org-b" }),
    ];
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === "/me") return { data: { orgId: "org-a" } };
      if (path === "/servers") return { data: { servers } };
      if (path === "/projects") return { data: { projects: [] } };
      throw new Error(`Unexpected GET ${path}`);
    });
    mocks.apiPost.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => cleanup());

  it("offers only eligible servers and isolates discovered repositories per selection", async () => {
    const user = userEvent.setup();
    renderPage(client);
    const serverSelect = await screen.findByRole("combobox", { name: "Eligible server" });

    await waitFor(() => expect(serverSelect).not.toBeDisabled());
    expect(within(serverSelect).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Server",
      "Eligible A",
      "Eligible B",
    ]);
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();

    await user.selectOptions(serverSelect, "eligible-a");
    const repositorySelect = screen.getByRole("combobox", { name: "GitHub repository" });
    expect(within(repositorySelect).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "GitHub repository",
      "acme/app-a",
    ]);
    await user.selectOptions(repositorySelect, "acme/app-a");
    expect(screen.getByLabelText("Repository path")).toHaveValue("/srv/app-a");
    expect(screen.getByLabelText("Compose path")).toHaveValue("/srv/app-a/docker-compose.yml");
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();

    await user.selectOptions(serverSelect, "eligible-b");
    expect(screen.getByPlaceholderText("Name")).toHaveValue("");
    expect(screen.getByPlaceholderText("Slug")).toHaveValue("");
    expect(screen.getByLabelText("Repository path")).toHaveValue("");
    expect(screen.getByLabelText("Compose path")).toHaveValue("");
    expect(within(repositorySelect).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "GitHub repository",
      "acme/app-b",
    ]);
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("clears a selection when refreshed server state becomes ineligible", async () => {
    const user = userEvent.setup();
    renderPage(client);
    const serverSelect = await screen.findByRole("combobox", { name: "Eligible server" });
    await waitFor(() => expect(serverSelect).not.toBeDisabled());
    await user.selectOptions(serverSelect, "eligible-a");
    await user.selectOptions(screen.getByRole("combobox", { name: "GitHub repository" }), "acme/app-a");

    servers = servers.map((item) => item._id === "eligible-a" ? { ...item, agentStatus: "offline" } : item);
    await client.invalidateQueries({ queryKey: ["servers"] });

    await waitFor(() => expect(serverSelect).toHaveValue(""));
    expect(within(serverSelect).queryByRole("option", { name: "Eligible A" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});
