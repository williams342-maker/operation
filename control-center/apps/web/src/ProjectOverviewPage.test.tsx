import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectOverview } from "@control-center/shared";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: { get: apiGet }, apiError: () => "Project not found" }));
import { ProjectOverviewPage } from "./ProjectOverviewPage";

const fixture: ProjectOverview = {
  schemaVersion: "project-overview-v1", generatedAt: "2026-07-21T20:00:00.000Z",
  project: { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market", slug: "crafters-market", archived: false, repository: "owner/repository", configuredBranch: "main" },
  environment: { name: "Beta", kind: "staging", protected: true, state: "configured" },
  server: { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Beta server", enrollmentStatus: "connected", agentStatus: "online", lastHeartbeatAt: "2026-07-21T19:59:00.000Z", freshness: "fresh", capabilities: ["docker", "git"], limitations: [] },
  revision: { configuredBranch: "main", discoveredBranch: "main", observedBranch: "release", discoveredCommit: "abcdef123456", observedCommit: "abc1234", dirty: false, evidenceAt: "2026-07-21T19:59:00.000Z", confidence: "conflicting", conflicts: ["branch-evidence-conflict"] },
  services: [{ name: "web", state: "running", health: "healthy", source: "compose", evidenceAt: "2026-07-21T19:59:00.000Z", freshness: "fresh" }],
  health: [{ id: "cccccccccccccccccccccccc", name: "Public health", success: true, statusCode: 200, checkedAt: "2026-07-21T19:59:00.000Z", freshness: "fresh" }],
  recent: { tasks: [{ id: "dddddddddddddddddddddddd", type: "collect.system", state: "succeeded", target: "Beta server", summary: "Task completed successfully", completedAt: "2026-07-21T19:58:00.000Z" }], audit: [{ id: "eeeeeeeeeeeeeeeeeeeeeeee", action: "task.complete", actor: "agent", target: "agent_task", result: "success", timestamp: "2026-07-21T19:58:00.000Z" }], deployments: [], rollbacks: [] },
  availability: { releases: "unavailable", deployments: "unavailable", rollbacks: "unavailable", logs: "unavailable" }, limitations: []
};
const burnInFixture = {
  policy: { profile: "Staging-BurnIn-v1", observation: { minimumHours: 24 } },
  enabledHealthChecks: 1,
  observation: { state: "observing", observationStartedAt: "2026-07-24T20:09:02.695Z", minimumCompletesAt: "2026-07-25T20:09:02.695Z", completionPercent: 5, lastResetReasons: [], sampleCount: 12, metrics: { availabilityPercent: 100, httpErrorRatePercent: 0, p95LatencyMs: 66, maximumAgentHeartbeatGapSeconds: 31.752, maximumDiskPercent: 74.46, unexpectedRestarts: 0, criticalAlerts: 0 } }
};

function renderPage(data: ProjectOverview = fixture, canViewAudit = true) {
  apiGet.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith("/burn-in") ? burnInFixture : data }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const navigate = vi.fn();
  render(<QueryClientProvider client={client}><ProjectOverviewPage projectId={data.project.id} canViewAudit={canViewAudit} navigate={navigate} /></QueryClientProvider>);
  return navigate;
}

afterEach(() => { cleanup(); apiGet.mockReset(); });

describe("Project Overview workspace", () => {
  it("renders identity, evidence distinctions, conflicts, services, health, tasks and audit", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Crafters Market" })).toBeInTheDocument();
    expect(screen.getByText("owner/repository")).toBeInTheDocument();
    expect(screen.getByText("release")).toBeInTheDocument();
    expect(screen.getByText(/branch-evidence-conflict/)).toBeInTheDocument();
    expect(screen.getByText(/Observed and discovered Git state is not/)).toBeInTheDocument();
    expect(screen.getByText("Task completed successfully")).toBeInTheDocument();
    expect(screen.getByText("task.complete")).toBeInTheDocument();
    expect(screen.getByText(/Public health/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Staging burn-in" })).toBeInTheDocument();
    expect(screen.getByText("100.000%")).toBeInTheDocument();
    expect(screen.getByText("66 ms")).toBeInTheDocument();
    expect(screen.getByText(/production publication still requires the owner Ed25519 signature/i)).toBeInTheDocument();
  });

  it("links to the implemented Environment workspace and keeps unsupported capabilities visibly unavailable", async () => {
    const navigate = renderPage();
    await screen.findByTestId("project-overview");
    const environment = screen.getByRole("button", { name: "Environment" });
    expect(environment).toBeEnabled();
    await userEvent.click(environment);
    expect(navigate).toHaveBeenCalledWith("/configuration?projectId=aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(screen.queryByRole("button", { name: /Environment · Planned/ })).not.toBeInTheDocument();
  });

  it("makes unsupported capabilities visibly unavailable without active pages", async () => {
    renderPage();
    await screen.findByTestId("project-overview");
    for (const title of ["Deployments", "Releases", "Rollbacks", "Logs"]) expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button", { name: "Website Builder" })).toBeEnabled();
  });

  it("handles missing and stale evidence honestly", async () => {
    renderPage({ ...fixture, server: { enrollmentStatus: "pending", agentStatus: "never_connected", freshness: "unavailable", capabilities: [], limitations: [] }, revision: { configuredBranch: "main", confidence: "configured", conflicts: [] }, services: [], health: [], recent: { tasks: [], audit: [], deployments: [], rollbacks: [] } });
    expect(await screen.findByText("No current service or health evidence.")).toBeInTheDocument();
    expect(screen.getByText("No recent tasks")).toBeInTheDocument();
    expect(screen.getByText("No recent audit activity")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  });

  it("filters audit navigation and state when unauthorized", async () => {
    renderPage({ ...fixture, recent: { ...fixture.recent, audit: null } }, false);
    expect(await screen.findByText("Not authorized")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Audit" })).not.toBeInTheDocument();
  });

  it("contains no credential-bearing URL or synthetic secret in the DOM", async () => {
    renderPage();
    const dom = (await screen.findByTestId("project-overview")).textContent || "";
    expect(dom).not.toMatch(/password|bearer|mongodb:\/\/|ghp_|private key|user:secret@/i);
  });

  it("navigates to existing task and audit workspaces", async () => {
    const navigate = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Tasks" }));
    await userEvent.click(screen.getByRole("button", { name: "Audit" }));
    expect(navigate).toHaveBeenNthCalledWith(1, "/tasks");
    expect(navigate).toHaveBeenNthCalledWith(2, "/audit");
  });
});
