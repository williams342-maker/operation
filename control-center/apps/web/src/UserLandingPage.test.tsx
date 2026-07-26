import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("./api", () => ({
  api: { get: mocks.apiGet },
  apiError: (error: unknown) => error instanceof Error ? error.message : "Dashboard request failed",
}));

import { UserLandingPage } from "./UserLandingPage";

function renderDashboard(navigate = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><UserLandingPage navigate={navigate} /></QueryClientProvider>);
  return navigate;
}

describe("UserLandingPage", () => {
  afterEach(() => { cleanup(); mocks.apiGet.mockReset(); });

  it("shows personalized, truthful workspace data and routes to a project", async () => {
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === "/me") return Promise.resolve({ data: { user: { name: "Michael Williams", email: "michael@example.test" } } });
      if (path === "/overview") return Promise.resolve({ data: { serverCount: 1, onlineServers: 1, projectCount: 1, recentAudit: [] } });
      if (path === "/servers") return Promise.resolve({ data: { servers: [{ _id: "server-1", name: "Staging", status: "online", currentState: { metrics: { cpu: { loadPercent: 24 }, memory: { usedBytes: 41, totalBytes: 100 }, disk: [{ usedBytes: 38, totalBytes: 100 }] } } }] } });
      if (path === "/projects") return Promise.resolve({ data: { projects: [{ _id: "project-1", name: "Crafters Market", slug: "crafters-market" }] } });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    const navigate = renderDashboard();

    expect(await screen.findByRole("heading", { name: /michael!/i })).toBeInTheDocument();
    expect(screen.getByText("No recent deployment data")).toBeInTheDocument();
    expect(screen.getByText("All monitored systems operational")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /crafters market/i }));
    expect(navigate).toHaveBeenCalledWith("/projects/project-1/overview");
  });

  it("derives alert states from current server telemetry", async () => {
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === "/me") return Promise.resolve({ data: { user: { email: "viewer@example.test" } } });
      if (path === "/overview") return Promise.resolve({ data: { serverCount: 1, onlineServers: 0, projectCount: 0, recentAudit: [] } });
      if (path === "/servers") return Promise.resolve({ data: { servers: [{ _id: "server-1", name: "Staging", status: "offline", currentState: { metrics: { disk: [{ usedBytes: 91, totalBytes: 100 }] } } }] } });
      if (path === "/projects") return Promise.resolve({ data: { projects: [] } });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    renderDashboard();

    expect(await screen.findByText("Staging is offline")).toBeInTheDocument();
    expect(screen.getByText("Disk space warning")).toBeInTheDocument();
    expect(screen.getByText("Review", { selector: ".user-health-pill" })).toBeInTheDocument();
  });
});
