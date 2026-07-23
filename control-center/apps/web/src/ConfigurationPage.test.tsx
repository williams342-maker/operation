import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: { get: apiGet, post: vi.fn() }, apiError: () => "Configuration unavailable" }));
import { ConfigurationPage } from "./ConfigurationPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const navigate = vi.fn();
  render(<QueryClientProvider client={client}><ConfigurationPage toast={() => undefined} navigate={navigate} /></QueryClientProvider>);
  return navigate;
}

afterEach(() => { cleanup(); apiGet.mockReset(); });

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
    expect(screen.getByText(/selected project and environment only/i)).toBeInTheDocument();
    expect(await screen.findByText("API_BASE_URL")).toBeInTheDocument();
    expect(await screen.findByText("CLOUDFLARE_ACCESS_CLIENT_SECRET")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/actual-secret|ciphertext|mongodb:\/\/|bearer token/i);

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
});
