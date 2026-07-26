import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn()); const apiPost = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: { get: apiGet, post: apiPost }, apiError: (error: unknown) => error instanceof Error ? error.message : "Request failed" }));
import { SeoOptimizerPage } from "./SeoOptimizerPage";

const projectId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const state = { project: { id: projectId, name: "OpsWorkbench", slug: "opsworkbench" }, target: { available: true, url: "https://opsworkbench.org/health", source: "health-check:Public health" }, audit: null, history: [], capabilities: { readOnlyScan: true, automaticChanges: false, keywordResearch: false, coreWebVitals: false }, boundary: "Audits never modify, publish, or deploy." };
function renderPage(response = state) { apiGet.mockResolvedValue({ data: response }); const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); render(<QueryClientProvider client={client}><SeoOptimizerPage projectId={projectId} navigate={vi.fn()} /></QueryClientProvider>); }
afterEach(() => { cleanup(); apiGet.mockReset(); apiPost.mockReset(); });

describe("SEO Optimizer", () => {
  it("runs only an explicit read-only audit with bounded target phrases", async () => {
    apiPost.mockResolvedValue({ data: { audit: { revision: 1, score: 88 } } }); renderPage();
    expect(await screen.findByRole("heading", { name: "SEO Optimizer" })).toBeInTheDocument();
    expect(screen.getByText(/never modify, publish, or deploy/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Target phrases/), "deployment platform, server monitoring");
    await userEvent.click(screen.getByRole("button", { name: "Run read-only audit" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/projects/${projectId}/seo/audits`, { keywords: ["deployment platform", "server monitoring"] }));
  });

  it("truthfully labels unavailable research and performance capabilities", async () => {
    renderPage(); await screen.findByRole("heading", { name: "SEO Optimizer" });
    expect(screen.getByText(/Not configured; no fabricated volume data/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP timing only; not Core Web Vitals/)).toBeInTheDocument();
  });
});
