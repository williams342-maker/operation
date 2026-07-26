import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: { get: apiGet, post: apiPost }, apiError: (error: unknown) => error instanceof Error ? error.message : "Request failed" }));
import { WebsiteBuilderPage } from "./WebsiteBuilderPage";

const state = {
  project: { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Crafters Market", slug: "crafters-market" }, draft: null, history: [],
  ai: { enabled: false, provider: null as string | null, model: null as string | null, automaticRequests: false },
  publication: { enabled: false, reason: "Drafts only" }
};
const generated = {
  siteName: "Crafters Market", tagline: "Meet your next favorite maker", description: "Shop original goods from local artists.", primaryCta: "Explore",
  palette: { primary: "#06b6d4", accent: "#22c55e", background: "#07131f", text: "#f8fafc" },
  sections: [{ id: "hero", type: "hero", heading: "Made nearby", body: "Original work from local makers.", buttonLabel: "Explore" }, { id: "about", type: "about", heading: "Support creativity", body: "Every purchase supports an artist." }]
};

function renderBuilder(response = state) {
  apiGet.mockResolvedValue({ data: response });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><WebsiteBuilderPage projectId={state.project.id} navigate={vi.fn()} /></QueryClientProvider>);
}
afterEach(() => { cleanup(); apiGet.mockReset(); apiPost.mockReset(); });

describe("Website Builder", () => {
  it("edits, previews, and saves a manual draft without publishing", async () => {
    apiPost.mockResolvedValue({ data: { draft: { revision: 1 } } });
    renderBuilder();
    expect(await screen.findByRole("heading", { name: "Website Builder" })).toBeInTheDocument();
    expect(screen.getByText(/never deploys, publishes, changes DNS/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate website draft" })).toBeDisabled();
    const siteName = screen.getByLabelText("Site name");
    await userEvent.clear(siteName); await userEvent.type(siteName, "Maker House");
    expect(within(screen.getByLabelText("Website preview")).getByText("Maker House")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/projects/${state.project.id}/website-builder/drafts`, expect.objectContaining({ baseRevision: 0, source: "manual", content: expect.objectContaining({ siteName: "Maker House" }) })));
  });

  it("makes AI generation explicit and keeps its result unsaved", async () => {
    apiPost.mockResolvedValue({ data: { content: generated, metadata: { provider: "mock", model: "deterministic-v1", saved: false, noDeploymentPerformed: true } } });
    renderBuilder({ ...state, ai: { enabled: true, provider: "mock", model: "deterministic-v1", automaticRequests: false } });
    const prompt = await screen.findByLabelText("Website brief");
    await userEvent.type(prompt, "Build a warm marketplace for local makers");
    await userEvent.click(screen.getByRole("button", { name: "Generate website draft" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/projects/${state.project.id}/website-builder/generate`, expect.objectContaining({ prompt: "Build a warm marketplace for local makers" })));
    expect(await within(screen.getByLabelText("Website preview")).findByText("Made nearby")).toBeInTheDocument();
    expect(screen.getByText(/Review and save when ready/)).toBeInTheDocument();
  });
});
