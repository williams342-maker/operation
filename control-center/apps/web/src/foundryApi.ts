import { draftRequestKey } from "./foundryDraft";
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
  timelineEvents?: Array<{ type: string; message: string; createdAt: string }>;
  suggestionDecisions?: Array<{ id: string; decision: string; version: number }>;
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
  return STAGE_INDEX[stage] ?? -1;
}

// The next SAFE, REVERSIBLE auto-advance action for a stage, or null when Foundry
// must stop and wait (preview ready → human review; staging approval; or a legacy
// discovery-stage workflow that belongs to the guided builder). It never returns
// an action that publishes, deploys, or touches an external/irreversible boundary.
export function nextAutoAction(workflow: FoundryWorkflow): { path: string; body?: unknown } | null {
  return workflow.prompt && ["brief_review", "architecture_review", "brand_review", "content_review", "implementation_approval"].includes(workflow.stage) ? { path: "prepare-preview" } : null;
}

export async function createWorkflowFromPrompt(prompt: string): Promise<WorkflowResponse> {
  return (await api.post("/website-builder/workflows/from-prompt", { prompt }, { headers: { "Idempotency-Key": draftRequestKey(prompt) } })).data;
}

export async function getWorkflow(id: string): Promise<WorkflowResponse> {
  return (await api.get(`/website-builder/workflows/${id}`)).data;
}

export async function advanceWorkflow(id: string, path: string, body?: unknown, version?: number): Promise<WorkflowResponse> {
  return (await api.post(`/website-builder/workflows/${id}/${path}`, body, { headers: { "If-Match": String(version) } })).data;
}

export async function regenerateSection(id: string, sectionId: string, version?: number): Promise<WorkflowResponse> {
  return (await api.post(`/website-builder/workflows/${id}/sections/${sectionId}/regenerate`, {}, { headers: { "If-Match": String(version) } })).data;
}

export type BriefPatch = { businessName?: string; description?: string; websiteType?: string; primaryAction?: string; requiredPages?: string[] };
export async function updateWorkflowBrief(id: string, patch: BriefPatch, version?: number): Promise<WorkflowResponse> {
  return (await api.patch(`/website-builder/workflows/${id}/brief`, patch, { headers: { "If-Match": String(version) } })).data;
}

export async function listWorkflows(): Promise<FoundryWorkflow[]> {
  return (await api.get("/website-builder/workflows")).data?.workflows ?? [];
}

export async function decideSuggestion(id: string, suggestionId: string, decision: "accepted" | "rejected", version: number): Promise<WorkflowResponse> {
  return (await api.post("/website-builder/workflows/" + id + "/suggestions", { suggestionId, decision }, { headers: { "If-Match": String(version) } })).data;
}
