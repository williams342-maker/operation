import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn()); const apiPost = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: { get: apiGet, post: apiPost }, apiError: (error: unknown) => error instanceof Error ? error.message : "Request failed" }));
import { SeoOptimizerPage } from "./SeoOptimizerPage";

const projectId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const state = { project: { id: projectId, name: "OpsWorkbench", slug: "opsworkbench" }, target: { available: true, url: "https://opsworkbench.org/health", source: "health-check:Public health" }, audit: null, history: [], capabilities: { readOnlyScan: true, multiPageCrawl: true, maximumPages: 25, automaticChanges: false, keywordResearch: false, coreWebVitals: false }, boundary: "Audits never modify, publish, or deploy." };
function renderPage(response: unknown = state) { apiGet.mockResolvedValue({ data: response }); const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); render(<QueryClientProvider client={client}><SeoOptimizerPage projectId={projectId} navigate={vi.fn()} /></QueryClientProvider>); }
afterEach(() => { cleanup(); apiGet.mockReset(); apiPost.mockReset(); });

describe("SEO Optimizer", () => {
  it("runs only an explicit read-only audit with bounded target phrases", async () => {
    apiPost.mockResolvedValue({ data: { audit: { revision: 1, score: 88 } } }); renderPage();
    expect(await screen.findByRole("heading", { name: "SEO Optimizer" })).toBeInTheDocument();
    expect(screen.getByText(/never modify, publish, or deploy/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Target phrases/), "deployment platform, server monitoring");
    await userEvent.selectOptions(screen.getByLabelText("Maximum pages"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Run read-only audit" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/projects/${projectId}/seo/audits`, { keywords: ["deployment platform", "server monitoring"], maxPages: 15 }));
  });

  it("renders bounded crawl inventory without claiming browser performance data", async () => {
    const audit = { id: "audit-1", revision: 2, targetUrl: "https://opsworkbench.org/", finalUrl: "https://opsworkbench.org/", keywords: [], score: 82, categoryScores: { technical: 90, metadata: 70, content: 85, indexing: 80, performance: 85 }, evidence: { pagesAudited: 2 }, findings: [], pages: [{ url: "https://opsworkbench.org/", finalUrl: "https://opsworkbench.org/", status: 200, responseTimeMs: 120, title: "OpsWorkbench", h1Count: 1, findingCount: 0 }, { url: "https://opsworkbench.org/pricing", finalUrl: "https://opsworkbench.org/pricing", status: 404, responseTimeMs: 80, h1Count: 0, findingCount: 2 }], crawl: { pagesAudited: 2, pagesDiscovered: 4, limit: 10, timedOut: false, durationMs: 300 }, createdAt: new Date().toISOString() };
    renderPage({ ...state, audit, history: [{ id: "audit-1", revision: 2, score: 82, createdAt: audit.createdAt }] });
    expect(await screen.findByRole("heading", { name: "Audited pages" })).toBeInTheDocument();
    expect(screen.getByText(/2 of 4 discovered/)).toBeInTheDocument();
    expect(screen.getByText("https://opsworkbench.org/pricing")).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("truthfully labels unavailable research and performance capabilities", async () => {
    renderPage(); await screen.findByRole("heading", { name: "SEO Optimizer" });
    expect(screen.getByText(/Not configured; no fabricated volume data/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP timing only; not Core Web Vitals/)).toBeInTheDocument();
  });
});
