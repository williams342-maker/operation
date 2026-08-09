import { type FoundryWorkflow, stageIndex } from "./foundryApi";

export type TimelineStatus = "pending" | "active" | "completed" | "failed";
export type TimelineStep = { id: string; label: string; status: TimelineStatus };
export type WorkspacePhase = "building" | "reviewing" | "approved" | "guided-legacy";

// Steps complete only when the backend has CONFIRMED the corresponding state
// (stage reached / field present) — nothing here is fabricated. There is no token
// streaming, no fake agents, and no artificial delay: a step is "active" only
// while its real stage transition is genuinely in flight.
const STEPS: Array<{ id: string; label: string; completeAt: number }> = [
  { id: "received", label: "Request received", completeAt: 1 },
  { id: "brief", label: "Brief created", completeAt: 1 },
  { id: "structure", label: "Page structure prepared", completeAt: 2 },
  { id: "content", label: "Content generated", completeAt: 4 },
  { id: "build", label: "Preview build started", completeAt: 5 },
  { id: "preview", label: "Preview ready", completeAt: 6 },
];

export function buildTimeline(
  workflow: FoundryWorkflow | null,
  options: { advancing?: boolean; failed?: boolean } = {},
): TimelineStep[] {
  const index = workflow ? stageIndex(workflow.stage) : -1;
  // The lowest step not yet confirmed complete is the current target.
  const targetIndex = STEPS.findIndex((step) => index < step.completeAt);
  return STEPS.map((step, i) => {
    if (index >= step.completeAt) return { id: step.id, label: step.label, status: "completed" as const };
    if (i === targetIndex) {
      if (options.failed) return { id: step.id, label: step.label, status: "failed" as const };
      if (options.advancing) return { id: step.id, label: step.label, status: "active" as const };
    }
    return { id: step.id, label: step.label, status: "pending" as const };
  });
}

export function workspacePhase(workflow: FoundryWorkflow | null): WorkspacePhase {
  if (!workflow) return "building";
  const index = stageIndex(workflow.stage);
  if (workflow.stage === "discovery") return "guided-legacy";
  if (index >= 7) return "approved";
  if (index >= 6) return "reviewing";
  return "building";
}
