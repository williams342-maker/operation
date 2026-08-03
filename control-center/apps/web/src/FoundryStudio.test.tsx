import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), advance: vi.fn(), regen: vi.fn(), list: vi.fn() }));

vi.mock("./api", () => ({ apiError: (error: any) => error?.message ?? "error", api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./foundryApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./foundryApi")>();
  return { ...actual, createWorkflowFromPrompt: mocks.create, getWorkflow: mocks.get, advanceWorkflow: mocks.advance, regenerateSection: mocks.regen, listWorkflows: mocks.list };
});

import { FoundryStudio } from "./FoundryStudio";
import type { FoundryWorkflow } from "./foundryApi";

const PROMPT = "A modern website for a family bakery";
const brief = { business: { name: "Untitled business", description: PROMPT }, audience: { primary: "People nearby" }, goals: { primaryGoal: "Get orders", primaryAction: "Contact us" }, website: { requiredPages: ["Home", "About"] }, brand: { personality: ["clear", "trustworthy"] } };
const architecture = { pages: [{ title: "Home", route: "/" }, { title: "About", route: "/about" }] };
const sections = [{ id: "hero", type: "hero", heading: "Welcome", body: "b", version: 1 }, { id: "features", type: "features", heading: "How we help", body: "b", version: 1 }];
const artifact = { version: 1, filename: "x.html", mimeType: "text/html", html: "<html><body>Preview</body></html>", sha256: "a", bytes: 10, generatedAt: "" };
const validation = { passed: true, checks: 4 };
const wf = (stage: string, extra: Partial<FoundryWorkflow> = {}): FoundryWorkflow => ({ id: "w1", websiteType: "business", stage, version: 1, estimatedCredits: 5, actualCredits: 0, createdAt: "", updatedAt: "", prompt: PROMPT, brief, ...extra });

const STAGE_FOR_PATH: Record<string, string> = {
  "approve-brief": "architecture_review", "approve-architecture": "brand_review", "select-brand": "content_review",
  "approve-content": "implementation_approval", "approve-implementation": "preview_ready", "approve-preview": "staging_approval",
};
const brandDirections = [{ id: "clear-trust", name: "Clear", rationale: "", colors: ["#000000", "#111111", "#ffffff"], headingStyle: "", density: "" }];

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.advance.mockImplementation((_id: string, path: string) => {
    const stage = STAGE_FOR_PATH[path];
    // The artifact/validation only exist once the preview is actually built, so the
    // iframe appears only at preview_ready — not during intermediate stages.
    const previewReady = stage === "preview_ready" || stage === "staging_approval";
    return Promise.resolve({ workflow: wf(stage, { architecture, sections, brandDirections, ...(previewReady ? { artifact, validation } : {}) }) });
  });
});
afterEach(() => cleanup());

describe("Foundry studio", () => {
  it("prefills the carried prompt, submits it exactly once, and moves to the project URL", async () => {
    sessionStorage.setItem("foundry.draftPrompt", PROMPT);
    mocks.create.mockResolvedValue({ workflow: wf("brief_review") });
    const navigate = vi.fn();
    render(<FoundryStudio route={{ kind: "new" }} navigate={navigate} />);

    expect(screen.getByLabelText(/describe what you want to build/i)).toHaveValue(PROMPT);
    await userEvent.click(screen.getByRole("button", { name: /start building/i }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(PROMPT);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/foundry/projects/w1"));
  });

  it("prevents duplicate workflow creation on repeated submits", async () => {
    mocks.create.mockReturnValue(new Promise(() => {})); // never resolves: stays in creating state
    render(<FoundryStudio route={{ kind: "new" }} navigate={vi.fn()} />);
    const textarea = screen.getByLabelText(/describe what you want to build/i);
    await userEvent.type(textarea, "Build me a site");
    const button = screen.getByRole("button", { name: /start building/i });
    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("auto-advances reversible stages to a ready preview, then stops at the human approval boundary", async () => {
    mocks.get.mockResolvedValue({ workflow: wf("brief_review") });
    render(<FoundryStudio route={{ kind: "project", workflowId: "w1" }} navigate={vi.fn()} />);

    // The live preview renders once the reversible stages complete.
    const frame = await screen.findByTitle("Generated website preview");
    expect(frame).toBeInTheDocument();

    // Timeline reflects the confirmed completed state.
    expect(screen.getByText("Preview ready")).toBeInTheDocument();

    // Human approval is offered; production publishing stays disabled and is never
    // auto-crossed.
    expect(screen.getByRole("button", { name: /approve preview for staging/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /publish to production/i })).toBeDisabled();
    expect(screen.getByText(/production publishing is separate and not enabled/i)).toBeInTheDocument();

    // approve-preview is a human action; it was not auto-called during advancement.
    expect(mocks.advance).not.toHaveBeenCalledWith("w1", "approve-preview", undefined);
  });

  it("shows the original prompt as user-provided and never presents an invented business name", async () => {
    mocks.get.mockResolvedValue({ workflow: wf("preview_ready", { architecture, sections, brandDirections, artifact, validation }) });
    render(<FoundryStudio route={{ kind: "project", workflowId: "w1" }} navigate={vi.fn()} />);
    await screen.findByTitle("Generated website preview");

    // The description equals the user's prompt → labelled "From you".
    expect(screen.getAllByText(/from you/i).length).toBeGreaterThan(0);
    // The default placeholder name is shown as a suggestion, never as a fact from the user.
    expect(screen.getByText("Untitled business")).toBeInTheDocument();

    // Contextual, project-specific, zero-credit suggestion is offered.
    expect(screen.getByText(/strengthen the homepage headline/i)).toBeInTheDocument();
    expect(screen.getAllByText(/estimated credits: 0/i).length).toBeGreaterThan(0);
  });
});
