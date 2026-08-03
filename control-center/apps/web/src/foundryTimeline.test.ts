import { describe, expect, it } from "vitest";
import { buildTimeline, workspacePhase } from "./foundryTimeline";
import type { FoundryWorkflow } from "./foundryApi";

const wf = (stage: string): FoundryWorkflow => ({
  id: "1", websiteType: "business", stage, version: 1, estimatedCredits: 5, actualCredits: 0,
  createdAt: "", updatedAt: "",
});
const status = (steps: ReturnType<typeof buildTimeline>, id: string) => steps.find((s) => s.id === id)?.status;

describe("foundry timeline", () => {
  it("reflects only confirmed backend stages", () => {
    const steps = buildTimeline(wf("content_review"));
    expect(status(steps, "brief")).toBe("completed");
    expect(status(steps, "structure")).toBe("completed");
    expect(status(steps, "content")).toBe("completed");
    expect(status(steps, "build")).toBe("pending");
    expect(status(steps, "preview")).toBe("pending");
  });

  it("marks the current target active only while genuinely advancing", () => {
    expect(status(buildTimeline(wf("brief_review"), { advancing: true }), "structure")).toBe("active");
    // Not advancing => the same step is pending, never a fake in-progress state.
    expect(status(buildTimeline(wf("brief_review")), "structure")).toBe("pending");
  });

  it("marks the target failed when a step errored", () => {
    expect(status(buildTimeline(wf("architecture_review"), { failed: true }), "content")).toBe("failed");
  });

  it("shows every step completed once the preview is ready", () => {
    expect(buildTimeline(wf("preview_ready")).every((s) => s.status === "completed")).toBe(true);
  });

  it("derives the workspace phase", () => {
    expect(workspacePhase(wf("brief_review"))).toBe("building");
    expect(workspacePhase(wf("preview_ready"))).toBe("reviewing");
    expect(workspacePhase(wf("staging_approval"))).toBe("approved");
    expect(workspacePhase(wf("discovery"))).toBe("guided-legacy");
  });
});
