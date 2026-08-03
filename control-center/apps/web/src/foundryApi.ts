import { api } from "./api";

// Thin client boundary over the existing website-builder endpoints. The frontend
// never re-derives briefs/plans — it only submits the prompt once and advances
// through the server's reversible stage endpoints, rendering what they return.

export type FoundryWorkflow = {
  id: string;
  websiteType: string;
  stage: string;
  version: number;
  prompt?: string;
  brief?: any;
  architecture?: any;
  brandDirections?: Array<{ id: string; name: string; rationale: string; colors: string[]; headingStyle: string; density: string }>;
  selectedBrandId?: string;
  sections?: Array<{ id: string; type: string; heading: string; body: string; cta?: string; version: number }>;
  implementationPlan?: any;
  artifact?: { version: number; filename: string; mimeType: string; html: string; sha256: string; bytes: number; generatedAt: string };
  validation?: { passed?: boolean; checks?: number; warnings?: string[] };
  approvals?: Array<{ artifactType: string; artifactVersion: number; decidedAt: string }>;
  estimatedCredits: number;
  actualCredits: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowResponse = { workflow: FoundryWorkflow; question?: any };

// Ordered stages, used to compare progress. user_review is an alias of the same
// point as preview_ready in the backend.
export const STAGE_INDEX: Record<string, number> = {
  discovery: 0, brief_review: 1, architecture_review: 2, brand_review: 3,
  content_review: 4, implementation_approval: 5, preview_ready: 6, user_review: 6,
  staging_approval: 7, paused: -1,
};

export function stageIndex(stage: string): number {
  return STAGE_INDEX[stage] ?? 0;
}

// The next SAFE, REVERSIBLE auto-advance action for a stage, or null when Foundry
// must stop and wait (preview ready → human review; staging approval; or a legacy
// discovery-stage workflow that belongs to the guided builder). It never returns
// an action that publishes, deploys, or touches an external/irreversible boundary.
export function nextAutoAction(workflow: FoundryWorkflow): { path: string; body?: unknown } | null {
  switch (workflow.stage) {
    case "brief_review": return { path: "approve-brief" };
    case "architecture_review": return { path: "approve-architecture" };
    case "brand_review": return { path: "select-brand", body: { directionId: workflow.brandDirections?.[0]?.id ?? "clear-trust" } };
    case "content_review": return { path: "approve-content" };
    case "implementation_approval": return { path: "approve-implementation" };
    default: return null; // preview_ready, staging_approval, discovery, paused
  }
}

export async function createWorkflowFromPrompt(prompt: string): Promise<WorkflowResponse> {
  return (await api.post("/website-builder/workflows/from-prompt", { prompt })).data;
}

export async function getWorkflow(id: string): Promise<WorkflowResponse> {
  return (await api.get(`/website-builder/workflows/${id}`)).data;
}

export async function advanceWorkflow(id: string, path: string, body?: unknown): Promise<WorkflowResponse> {
  return (await api.post(`/website-builder/workflows/${id}/${path}`, body)).data;
}

export async function regenerateSection(id: string, sectionId: string): Promise<WorkflowResponse> {
  return (await api.post(`/website-builder/workflows/${id}/sections/${sectionId}/regenerate`)).data;
}

export async function listWorkflows(): Promise<FoundryWorkflow[]> {
  return (await api.get("/website-builder/workflows")).data?.workflows ?? [];
}
