import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: { get: apiGet, post: apiPost }, apiError: () => "Unavailable" }));
import { ProjectHistoryPage } from "./ProjectHistoryPage";
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => { cleanup(); apiGet.mockReset(); apiPost.mockReset(); });
describe("Project history workspace", () => {
  it("renders truthful empty deployment history and routes without mutation", async () => {
    apiGet.mockResolvedValue({ data: { project: { id: "a".repeat(24), name: "Project", archived: false }, records: [], limit: 20, hasMore: false } }); const navigate = vi.fn();
    render(<QueryClientProvider client={client()}><ProjectHistoryPage projectId={"a".repeat(24)} kind="deployments" navigate={navigate} /></QueryClientProvider>);
    expect(await screen.findByText("No authoritative deployments have been recorded.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rollbacks" })); expect(navigate).toHaveBeenCalledWith(`/projects/${"a".repeat(24)}/rollbacks`);
  });
  it("links to the implemented Environment workspace from project history", async () => {
    apiGet.mockResolvedValue({ data: { project: { id: "a".repeat(24), name: "Project", archived: false }, records: [], limit: 20, hasMore: false } }); const navigate = vi.fn();
    render(<QueryClientProvider client={client()}><ProjectHistoryPage projectId={"a".repeat(24)} kind="deployments" navigate={navigate} /></QueryClientProvider>);
    await screen.findByText("No authoritative deployments have been recorded.");
    const environment = screen.getByRole("button", { name: "Environment" });
    expect(environment).toBeEnabled();
    await userEvent.click(environment);
    expect(navigate).toHaveBeenCalledWith(`/configuration?projectId=${"a".repeat(24)}`);
    expect(screen.queryByRole("button", { name: /Environment · Planned/ })).not.toBeInTheDocument();
  });
  it("renders safe deployment evidence responsively", async () => {
    apiGet.mockResolvedValue({ data: { project: { id: "a".repeat(24), name: "Project", archived: false }, records: [{ id: "b".repeat(24), projectId: "a".repeat(24), server: { id: "c".repeat(24), name: "Beta" }, environment: "staging", requestedRevision: "d".repeat(40), deployedRevision: "e".repeat(40), branch: "main", taskId: "f".repeat(24), status: "succeeded", validation: { health: "passed", readiness: "passed" }, rollbackAvailable: true, evidenceConfidence: "verified", createdAt: new Date().toISOString() }], limit: 20, hasMore: false } });
    render(<QueryClientProvider client={client()}><ProjectHistoryPage projectId={"a".repeat(24)} kind="deployments" navigate={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByText("succeeded")).toBeInTheDocument(); expect(screen.getByText("passed / passed")).toBeInTheDocument(); expect(document.body.textContent).not.toMatch(/password|token|mongodb:\/\//i);
  });
  it("shows non-mutating Deployment Manager plan review controls", async () => {
    apiGet.mockResolvedValue({ data: { project: { id: "a".repeat(24), name: "Project", archived: false }, records: [], limit: 20, hasMore: false } });
    render(<QueryClientProvider client={client()}><ProjectHistoryPage projectId={"a".repeat(24)} kind="deployments" navigate={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "Deployment Manager plan review" })).toBeInTheDocument();
    expect(screen.getByText("Planning only")).toBeInTheDocument();
    expect(screen.getByLabelText("Git revision")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run preflight" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Queue deployment" })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/password|token|mongodb:\/\//i);
  });
  it("previews an immutable deployment plan locally without queueing work", async () => {
    apiGet.mockResolvedValue({ data: { project: { id: "a".repeat(24), name: "Project", archived: false }, records: [{ id: "b".repeat(24), projectId: "a".repeat(24), server: { id: "c".repeat(24), name: "Beta" }, environment: "staging", requestedRevision: "d".repeat(40), deployedRevision: "e".repeat(40), branch: "main", taskId: "f".repeat(24), status: "succeeded", validation: { health: "passed", readiness: "passed" }, rollbackAvailable: true, evidenceConfidence: "verified", releaseId: "review-safe", createdAt: new Date().toISOString() }], limit: 20, hasMore: false } });
    render(<QueryClientProvider client={client()}><ProjectHistoryPage projectId={"a".repeat(24)} kind="deployments" navigate={vi.fn()} /></QueryClientProvider>);
    await userEvent.type(await screen.findByLabelText("Git revision"), "238b3a1");
    await userEvent.click(screen.getByRole("button", { name: "Preview immutable plan" }));
    expect(screen.getByLabelText("Immutable deployment plan preview")).toHaveTextContent("Not queued");
    expect(screen.getByLabelText("Immutable deployment plan preview")).toHaveTextContent("Separate administrator required");
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/password|token|mongodb:\/\//i);
  });
  it("creates a planned deployment record without queueing execution", async () => {
    const initial = { project: { id: "a".repeat(24), name: "Project", archived: false }, records: [], limit: 20, hasMore: false };
    const created = { project: initial.project, records: [{ id: "b".repeat(24), projectId: "a".repeat(24), server: { id: "c".repeat(24), name: "Beta" }, environment: "staging", requestedRevision: "238b3a1", branch: "main", taskId: "d".repeat(24), status: "planned", validation: { health: "not_run", readiness: "not_run" }, rollbackAvailable: false, evidenceConfidence: "reported", createdAt: new Date().toISOString() }], limit: 20, hasMore: false };
    apiGet.mockResolvedValueOnce({ data: initial }).mockResolvedValueOnce({ data: created });
    apiPost.mockResolvedValue({ data: { deployment: created.records[0] } });
    render(<QueryClientProvider client={client()}><ProjectHistoryPage projectId={"a".repeat(24)} kind="deployments" navigate={vi.fn()} /></QueryClientProvider>);
    await userEvent.type(await screen.findByLabelText("Git revision"), "238b3a1");
    await userEvent.click(screen.getByRole("button", { name: "Preview immutable plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Create plan record" }));
    expect(apiPost).toHaveBeenCalledWith(`/projects/${"a".repeat(24)}/deployments`, { requestedRevision: "238b3a1", environment: "staging" });
    expect(await screen.findByText("Immutable deployment plan created and pending approval.")).toBeInTheDocument();
    expect(await screen.findByText("planned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue deployment" })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/password|token|mongodb:\/\//i);
  });
  it("approves a planned deployment record without exposing execution controls", async () => {
    const planned = { id: "b".repeat(24), projectId: "a".repeat(24), server: { id: "c".repeat(24), name: "Beta" }, environment: "staging", requestedRevision: "238b3a1", branch: "main", taskId: "d".repeat(24), status: "planned", validation: { health: "not_run", readiness: "not_run" }, rollbackAvailable: false, evidenceConfidence: "reported", createdAt: new Date().toISOString() };
    const approved = { ...planned, status: "approved", approval: { approverId: "e".repeat(24), approvedAt: new Date().toISOString() } };
    const project = { id: "a".repeat(24), name: "Project", archived: false };
    apiGet.mockResolvedValueOnce({ data: { project, records: [planned], limit: 20, hasMore: false } }).mockResolvedValueOnce({ data: { project, records: [approved], limit: 20, hasMore: false } });
    apiPost.mockResolvedValue({ data: { deployment: approved } });
    render(<QueryClientProvider client={client()}><ProjectHistoryPage projectId={project.id} kind="deployments" navigate={vi.fn()} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Approve as different administrator" }));
    expect(apiPost).toHaveBeenCalledWith(`/projects/${project.id}/deployments/${planned.id}/approve`);
    expect(await screen.findByText("Deployment plan approved. Execution remains unavailable.")).toBeInTheDocument();
    expect(await screen.findByText("approved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve as different administrator" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue deployment" })).toBeDisabled();
  });
});
