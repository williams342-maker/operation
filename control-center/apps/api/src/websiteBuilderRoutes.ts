import { createHash } from "node:crypto";
import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { audit } from "./audit.js";
import { noStore, requirePermission } from "./auth.js";
import { collections } from "./db.js";
import { assertChargeable, classifyExecution } from "@control-center/shared";
import type { WebsiteBuildWorkflowDoc } from "./models.js";
import { buildArchitecture, buildBrandDirections, buildImplementationPlan, buildSiteContent, buildStaticSiteArtifact, buildValidation, inferWebsiteType, UNTITLED_BUSINESS } from "./websiteBuilder.js";
import { resolveSiteGenerationProvider } from "./siteGenerationProvider.js";


export const websiteBuilderRouter = express.Router();

// A website build is the artifact the customer asked for, so the workflow is customer-billable. The
// stages that merely check the work -- validation, regeneration of a section the platform got wrong --
// are not, and must never move the number.
const WEBSITE_BUILD_EXECUTION_KIND = "build.website_artifact" as const;

/**
 * THE ONLY PATH THAT MAY MOVE `actualCredits`. Server-side, per §7: UI labelling is not enforcement.
 *
 * Every current caller passes 0, and that is the state this is meant to preserve. It exists so the first
 * code that wants to pass something else has to justify it against the execution's recorded class rather
 * than incrementing a field.
 *
 * A workflow created before classification existed carries no stamp. It is treated as zero-credit and so
 * refuses any real charge; no migration, and the unmigrated direction is the safe one.
 */
function assertWorkflowChargeable(workflow: WebsiteBuildWorkflowDoc, creditsDelta: number): void {
  assertChargeable(
    { executionKind: workflow.executionKind ?? WEBSITE_BUILD_EXECUTION_KIND, billingClass: workflow.billingClass ?? "zero_credit" },
    creditsDelta,
  );
}

export const discoveryQuestions = [
  { id: "business_name", prompt: "What is the name of your business or organization?", help: "Use the public name visitors should see." },
  { id: "business_purpose", prompt: "What does your business do?", help: "Describe the products, services, or purpose in your own words." },
  { id: "primary_audience", prompt: "Who is the website primarily for?", help: "Describe the people you most want to reach." },
  { id: "primary_goal", prompt: "What is the main goal of the website?", help: "For example: generate leads, sell products, book appointments, or explain your work." },
  { id: "primary_action", prompt: "What should visitors do first?", help: "Choose the single most important visitor action." },
  { id: "brand_personality", prompt: "How should the website feel?", help: "Examples include trustworthy, warm, bold, minimal, premium, or playful." },
  { id: "required_pages", prompt: "Which pages are required?", help: "List the pages you already know you need, separated by commas." },
  { id: "launch_target", prompt: "When would you like to launch?", help: "An approximate date or timeframe is enough." },
] as const;

const websiteTypeSchema = z.enum(["business", "store", "landing_page", "redesign", "connected_project", "other"]);
function workflowResponse(workflow: any) {
  const question = discoveryQuestions[workflow.currentQuestionIndex] || null;
  return { workflow: { id: workflow._id, websiteType: workflow.websiteType, prompt: workflow.prompt, stage: workflow.stage, version: workflow.version, currentQuestionIndex: workflow.currentQuestionIndex, answerCount: workflow.answers.length, brief: workflow.brief, architecture: workflow.architecture, brandDirections: workflow.brandDirections, selectedBrandId: workflow.selectedBrandId, sections: workflow.sections, implementationPlan: workflow.implementationPlan, artifact: workflow.artifact, validation: workflow.validation, approvals: workflow.approvals || [], suggestionDecisions: workflow.suggestionDecisions || [], timelineEvents: workflow.timelineEvents || [], briefHistory: workflow.briefHistory || [], regeneration: workflow.regeneration, estimatedCredits: workflow.estimatedCredits, actualCredits: workflow.actualCredits, createdAt: workflow.createdAt, updatedAt: workflow.updatedAt }, question };
}

async function loadWorkflow(req: express.Request, res: express.Response) {
  const workflowId = String(req.params.id); if (!ObjectId.isValid(workflowId)) { res.status(404).json({ error: "Workflow not found" }); return null; }
  const workflow = await collections.websiteBuildWorkflows.findOne({ _id: new ObjectId(workflowId), orgId: req.orgId! }); if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return null; } if (!["GET", "HEAD"].includes(req.method)) {
    if (req.header("if-match") !== String(workflow.version)) { res.status(409).json({ error: "Project changed or version missing. Reload before making this decision." }); return null; }
  }
  return workflow;
}

async function recordApproval(req: express.Request, workflow: any, artifactType: string, artifactVersion: number, set: Record<string, unknown>) {
  const now = new Date(); const changed = await collections.websiteBuildWorkflows.updateOne({ _id: workflow._id, orgId: req.orgId!, version: workflow.version }, { $set: { ...set, updatedAt: now }, $push: { timelineEvents: { type: "approval", message: `Human approved ${artifactType} at project revision ${workflow.version}.`, actorUserId: req.user!._id, createdAt: now }, approvals: { artifactType, artifactVersion, workflowVersion: workflow.version, artifactSha256: workflow.artifact?.sha256, decidedBy: req.user!._id, decidedAt: now } }, $inc: { version: 1 } });
  if (changed.modifiedCount !== 1) return null;
  await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.artifact.approve", targetType: "website_workflow", targetId: workflow._id, result: "success", requestId: req.requestId, metadata: { artifactType, artifactVersion } });
  return collections.websiteBuildWorkflows.findOne({ _id: workflow._id, orgId: req.orgId! });
}

websiteBuilderRouter.get("/website-builder/workflows", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const rows = await collections.websiteBuildWorkflows.find({ orgId: req.orgId! }).sort({ updatedAt: -1 }).limit(50).toArray(); res.json({ workflows: rows.map((row) => workflowResponse(row).workflow) }); } catch (error) { next(error); }
});

// A scoped deterministic ID makes retries atomic without a multi-document transaction.
async function createWorkflow(req: express.Request, res: express.Response, fromPrompt: boolean) {
  const body = (fromPrompt ? z.object({ prompt: z.string().trim().min(3).max(4000), websiteType: websiteTypeSchema.optional() }).strict() : z.object({ websiteType: websiteTypeSchema }).strict()).parse(req.body) as { prompt?: string; websiteType?: WebsiteBuildWorkflowDoc["websiteType"] };
  const requestKey = z.string().uuid().parse(req.header("idempotency-key"));
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const id = new ObjectId(digest(JSON.stringify([req.orgId!.toHexString(), req.user!._id.toHexString(), requestKey])).slice(0, 24));
  const requestHash = digest(JSON.stringify([fromPrompt, body.prompt || "", body.websiteType || ""]));
  const now = new Date();
  const websiteType = body.websiteType || inferWebsiteType(body.prompt!) as WebsiteBuildWorkflowDoc["websiteType"];
  const provider = resolveSiteGenerationProvider();
  const answers = fromPrompt ? (await provider.understand(body.prompt!, websiteType)).map(answer => ({ ...answer, answeredAt: now, answeredByUserId: req.user!._id })) : [];
  const brief = fromPrompt ? await provider.brief(answers, websiteType) : undefined;
  const doc = { _id: id, orgId: req.orgId!, createdByUserId: req.user!._id, requestHash, websiteType, ...(fromPrompt ? { prompt: body.prompt, brief } : {}), stage: fromPrompt ? "brief_review" as const : "discovery" as const, version: 1, currentQuestionIndex: fromPrompt ? discoveryQuestions.length : 0, answers, estimatedCredits: 0, actualCredits: 0, ...classifyExecution(WEBSITE_BUILD_EXECUTION_KIND), createdAt: now, updatedAt: now, timelineEvents: [{ type: "created", message: "Project saved. Template planning is available; AI providers and credits are Upcoming.", actorUserId: req.user!._id, createdAt: now }] };
  let created = false;
  try { await collections.websiteBuildWorkflows.insertOne(doc); created = true; }
  catch (error: any) { if (error?.code !== 11000) throw error; }
  const workflow = await collections.websiteBuildWorkflows.findOne({ _id: id, orgId: req.orgId!, createdByUserId: req.user!._id });
  if (!workflow || workflow.requestHash !== requestHash) return res.status(409).json({ error: "This request key belongs to a different project request." });
  // The embedded creation event is saved atomically with the project, including if audit delivery fails.
  if (created) await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.workflow.create", targetType: "website_workflow", targetId: id, result: "success", requestId: req.requestId, metadata: { provider: "deterministic", websiteType } });
  return res.status(created ? 201 : 200).json(workflowResponse(workflow));
}
websiteBuilderRouter.post("/website-builder/workflows", noStore, requirePermission("ai:use"), async (req, res, next) => { try { await createWorkflow(req, res, false); } catch (error) { next(error); } });
websiteBuilderRouter.post("/website-builder/workflows/from-prompt", noStore, requirePermission("ai:use"), async (req, res, next) => { try { await createWorkflow(req, res, true); } catch (error) { next(error); } });

// Preparing a template is not a human approval. No approval record is added here.
websiteBuilderRouter.post("/website-builder/workflows/:id/prepare-preview", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try {
    const workflow = await loadWorkflow(req, res); if (!workflow) return;
    if (!workflow.prompt || !workflow.brief || !["brief_review", "architecture_review", "brand_review", "content_review", "implementation_approval"].includes(workflow.stage)) return res.status(409).json({ error: "Project is not awaiting template preparation" });
    const architecture = workflow.architecture || buildArchitecture(workflow.brief); const brandDirections = workflow.brandDirections || buildBrandDirections(workflow.brief); const sections = workflow.sections || buildSiteContent(workflow.brief, architecture);
    const selectedBrand = workflow.selectedBrandId ? brandDirections.find(item => item.id === workflow.selectedBrandId) : brandDirections[0]; if (!selectedBrand) return res.status(409).json({ error: "Saved theme is unavailable; review the project before preparation" });
    const artifact = buildStaticSiteArtifact(workflow.brief, architecture, selectedBrand, sections as any); const now = new Date();
    const changed = await collections.websiteBuildWorkflows.updateOne({ _id: workflow._id, orgId: req.orgId!, version: workflow.version }, { $set: { architecture, brandDirections, selectedBrandId: String(selectedBrand.id), sections, artifact, validation: { ...buildValidation(sections as any), artifactSha256: artifact.sha256 }, stage: "preview_ready", updatedAt: now }, $inc: { version: 1 }, $push: { timelineEvents: { type: "preview_prepared", message: "Template preview prepared. Human approval is pending.", actorUserId: req.user!._id, createdAt: now } } });
    if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Project changed; reload and try again" });
    res.json(workflowResponse(await collections.websiteBuildWorkflows.findOne({ _id: workflow._id, orgId: req.orgId! })));
  } catch (error) { next(error); }
});

websiteBuilderRouter.get("/website-builder/workflows/:id", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflowId = String(req.params.id); if (!ObjectId.isValid(workflowId)) return res.status(404).json({ error: "Workflow not found" }); const workflow = await collections.websiteBuildWorkflows.findOne({ _id: new ObjectId(workflowId), orgId: req.orgId! }); if (!workflow) return res.status(404).json({ error: "Workflow not found" }); res.json(workflowResponse(workflow)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/answers", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try {
    const workflowId = String(req.params.id); if (!ObjectId.isValid(workflowId)) return res.status(404).json({ error: "Workflow not found" });
    const id = new ObjectId(workflowId); const workflow = await loadWorkflow(req, res); if (!workflow) return;
    if (workflow.stage !== "discovery") return res.status(409).json({ error: "Active discovery workflow not found" });
    const expected = discoveryQuestions[workflow.currentQuestionIndex]; if (!expected) return res.status(409).json({ error: "Discovery is already complete" });
    const body = z.object({ questionId: z.literal(expected.id), value: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
    const now = new Date(); const nextIndex = workflow.currentQuestionIndex + 1; const stage = nextIndex >= discoveryQuestions.length ? "brief_review" : "discovery"; const answer = { questionId: body.questionId, value: body.value, answeredAt: now, answeredByUserId: req.user!._id }; const set: Record<string, unknown> = { currentQuestionIndex: nextIndex, stage, updatedAt: now };
    if (stage === "brief_review") set.brief = await resolveSiteGenerationProvider().brief([...workflow.answers, answer], workflow.websiteType);
    const changed = await collections.websiteBuildWorkflows.updateOne({ _id: id, orgId: req.orgId!, currentQuestionIndex: workflow.currentQuestionIndex, version: workflow.version, stage: "discovery" }, { $push: { answers: answer }, $set: set, $inc: { version: 1 } });
    if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Workflow changed; reload and try again" });
    const updated = await collections.websiteBuildWorkflows.findOne({ _id: id, orgId: req.orgId! });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.discovery.answer", targetType: "website_workflow", targetId: id, result: "success", requestId: req.requestId, metadata: { questionId: body.questionId, stage } });
    res.json(workflowResponse(updated));
  } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-brief", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "brief_review" || !workflow.brief) return res.status(409).json({ error: "Brief is not awaiting approval" }); const architecture = await resolveSiteGenerationProvider().architecture(workflow.brief as any); const updated = await recordApproval(req, workflow, "brief", Number((workflow.brief as any).version) || 1, { stage: "architecture_review", architecture, estimatedCredits: 0 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-architecture", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "architecture_review" || !workflow.architecture || !workflow.brief) return res.status(409).json({ error: "Architecture is not awaiting approval" }); const brandDirections = await resolveSiteGenerationProvider().brandDirections(workflow.brief as any); const updated = await recordApproval(req, workflow, "architecture", Number((workflow.architecture as any).version) || 1, { stage: "brand_review", brandDirections, estimatedCredits: 0 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/select-brand", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "brand_review" || !workflow.brief || !workflow.architecture) return res.status(409).json({ error: "Brand direction is not awaiting selection" }); const allowed = (workflow.brandDirections || []).map((item: any) => item.id); const body = z.object({ directionId: z.enum(["clear-trust", "warm-human", "bold-modern"]) }).strict().parse(req.body); if (!allowed.includes(body.directionId)) return res.status(409).json({ error: "Brand direction is unavailable" }); const sections = await resolveSiteGenerationProvider().content(workflow.brief as any, workflow.architecture as any); const updated = await recordApproval(req, workflow, "brand", 1, { stage: "content_review", selectedBrandId: body.directionId, sections, estimatedCredits: 0 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.patch("/website-builder/workflows/:id/sections/:sectionId", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (!["content_review", "preview_ready", "user_review"].includes(workflow.stage) || !workflow.sections) return res.status(409).json({ error: "Content is not editable" }); const sectionId = String(req.params.sectionId); const index = workflow.sections.findIndex((item) => item.id === sectionId); if (index < 0) return res.status(404).json({ error: "Section not found" }); const body = z.object({ heading: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(2000), cta: z.string().trim().max(80).optional() }).strict().parse(req.body); const sections = workflow.sections.map((item, itemIndex) => itemIndex === index ? { ...item, ...body, version: item.version + 1 } : item); const now = new Date(); const set: Record<string, unknown> = { sections, updatedAt: now, stage: workflow.artifact ? "preview_ready" : workflow.stage }; if (workflow.stage !== "content_review" && workflow.brief && workflow.architecture) { const brand = (workflow.brandDirections || []).find((item: any) => item.id === workflow.selectedBrandId); if (!brand) return res.status(409).json({ error: "Approved brand direction is unavailable" }); const artifact = buildStaticSiteArtifact(workflow.brief, workflow.architecture, brand, sections as any); artifact.version = workflow.version + 1; set.artifact = artifact; set.validation = { ...buildValidation(sections as any), artifactSha256: artifact.sha256, artifactBytes: artifact.bytes }; } const changed = await collections.websiteBuildWorkflows.updateOne({ _id: workflow._id, orgId: req.orgId!, version: workflow.version }, { $set: set, $inc: { version: 1 } }); if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Workflow changed; reload and try again" }); await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.section.update", targetType: "website_workflow", targetId: workflow._id, result: "success", requestId: req.requestId, metadata: { sectionId, version: sections[index].version } }); const updated = await collections.websiteBuildWorkflows.findOne({ _id: workflow._id, orgId: req.orgId! }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/sections/:sectionId/regenerate", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (!["content_review", "preview_ready", "user_review"].includes(workflow.stage) || !workflow.sections || !workflow.brief) return res.status(409).json({ error: "Content is not regeneratable" }); const sectionId = String(req.params.sectionId); const index = workflow.sections.findIndex((item) => item.id === sectionId); if (index < 0) return res.status(404).json({ error: "Section not found" }); const regenerated = await resolveSiteGenerationProvider().regenerateSection(workflow.sections[index] as any, workflow.brief as any); const sections = workflow.sections.map((item, itemIndex) => itemIndex === index ? regenerated : item); const now = new Date(); const set: Record<string, unknown> = { sections, updatedAt: now }; if (workflow.stage !== "content_review" && workflow.architecture) { const brand = (workflow.brandDirections || []).find((item: any) => item.id === workflow.selectedBrandId); if (!brand) return res.status(409).json({ error: "Approved brand direction is unavailable" }); const artifact = buildStaticSiteArtifact(workflow.brief, workflow.architecture, brand, sections as any); set.artifact = artifact; set.validation = { ...buildValidation(sections as any), artifactSha256: artifact.sha256, artifactBytes: artifact.bytes }; } assertWorkflowChargeable(workflow, 0); const changed = await collections.websiteBuildWorkflows.updateOne({ _id: workflow._id, orgId: req.orgId!, version: workflow.version }, { $set: set, $inc: { version: 1, actualCredits: 0 } }); if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Workflow changed; reload and try again" }); await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.section.update", targetType: "website_workflow", targetId: workflow._id, result: "success", requestId: req.requestId, metadata: { sectionId, version: sections[index].version, deterministic: true } }); const updated = await collections.websiteBuildWorkflows.findOne({ _id: workflow._id, orgId: req.orgId! }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-content", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "content_review" || !workflow.sections || !workflow.architecture) return res.status(409).json({ error: "Content is not awaiting approval" }); const plan = buildImplementationPlan(workflow.architecture, workflow.sections as any); const updated = await recordApproval(req, workflow, "content", Math.max(...workflow.sections.map((item) => item.version)), { stage: "implementation_approval", implementationPlan: plan, estimatedCredits: 0 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-implementation", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "implementation_approval" || !workflow.implementationPlan || !workflow.sections || !workflow.brief || !workflow.architecture) return res.status(409).json({ error: "Implementation plan is not awaiting approval" }); const brand = (workflow.brandDirections || []).find((item: any) => item.id === workflow.selectedBrandId); if (!brand) return res.status(409).json({ error: "Approved brand direction is unavailable" }); const artifact = buildStaticSiteArtifact(workflow.brief, workflow.architecture, brand, workflow.sections as any); const validation = { ...buildValidation(workflow.sections as any), artifactSha256: artifact.sha256, artifactBytes: artifact.bytes }; assertWorkflowChargeable(workflow, 0); const updated = await recordApproval(req, workflow, "implementation_plan", Number((workflow.implementationPlan as any).version) || 1, { stage: "preview_ready", artifact, validation, actualCredits: 0 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

// Minimal, org-safe brief editing (business name is the priority). Only approved
// fields may change; unknown keys are rejected. Editing is refused once the design
// is approved for staging, preserving the approval boundary. Material changes
// re-derive the downstream artifacts deterministically from the edited brief so
// the new name propagates to title/hero/header/nav/metadata, while stage, brand
// selection, and the plan are preserved. The previous name is kept in the audit.
const briefPatchSchema = z.object({
  businessName: z.string().trim().max(80).optional(),
  description: z.string().trim().max(4000).optional(),
  websiteType: websiteTypeSchema.optional(),
  primaryAction: z.string().trim().min(1).max(80).optional(),
  requiredPages: z.array(z.string().trim().min(1).max(60)).min(1).max(12).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "No editable fields were provided" });

const BRIEF_EDITABLE_STAGES = new Set(["brief_review", "architecture_review", "brand_review", "content_review", "implementation_approval", "preview_ready", "user_review"]);

websiteBuilderRouter.patch("/website-builder/workflows/:id/brief", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try {
    const workflow = await loadWorkflow(req, res); if (!workflow) return;
    if (!workflow.brief) return res.status(409).json({ error: "This project has no brief to edit yet" });
    if (!BRIEF_EDITABLE_STAGES.has(workflow.stage)) return res.status(409).json({ error: "This project is approved for staging; the brief can no longer be edited" });
    const body = briefPatchSchema.parse(req.body);
    const previous = workflow.brief as any;
    const nextBrief = {
      ...previous, version: Number(previous.version || 1) + 1, approved: false,
      business: { ...previous.business, ...(body.businessName !== undefined ? { name: body.businessName || UNTITLED_BUSINESS } : {}), ...(body.description !== undefined ? { description: body.description } : {}) },
      goals: { ...previous.goals, ...(body.primaryAction !== undefined ? { primaryAction: body.primaryAction } : {}) },
      website: { ...previous.website, ...(body.websiteType !== undefined ? { type: body.websiteType } : {}), ...(body.requiredPages !== undefined ? { requiredPages: body.requiredPages } : {}) },
    };
    const now = new Date();
    const set: Record<string, unknown> = { stage: workflow.artifact ? "preview_ready" : "brief_review", brief: nextBrief, websiteType: body.websiteType ?? workflow.websiteType, updatedAt: now, regeneration: { status: "complete", reason: "brief_updated", completedAt: now } };
    // Re-derive only what already exists, from the edited brief. Deterministic and
    // reversible; the prior artifact remains until the new one is computed.
    if (workflow.architecture) {
      const architecture = buildArchitecture(nextBrief); set.architecture = architecture;
      if (workflow.sections) {
        const sections = buildSiteContent(nextBrief, architecture).map(section => ({ ...section, version: workflow.version + 1 })); set.sections = sections; set.implementationPlan = buildImplementationPlan(architecture, sections);
        if (workflow.artifact) {
          const brand = (workflow.brandDirections || []).find((item: any) => item.id === workflow.selectedBrandId) || buildBrandDirections(nextBrief)[0];
          const artifact = buildStaticSiteArtifact(nextBrief, architecture, brand, sections as any);
          set.artifact = artifact;
          set.validation = { ...buildValidation(sections as any), artifactSha256: artifact.sha256, artifactBytes: artifact.bytes };
        }
      }
    }
    const changed = await collections.websiteBuildWorkflows.updateOne({ _id: workflow._id, orgId: req.orgId!, version: workflow.version }, {
      $set: set,
      $push: {
        briefHistory: { changedAt: now, changedByUserId: req.user!._id, fields: Object.keys(body), previous: { businessName: previous.business?.name, description: previous.business?.description, websiteType: workflow.websiteType, primaryAction: previous.goals?.primaryAction, requiredPages: previous.website?.requiredPages }, next: { businessName: nextBrief.business?.name, description: nextBrief.business?.description, websiteType: body.websiteType ?? workflow.websiteType, primaryAction: nextBrief.goals?.primaryAction, requiredPages: nextBrief.website?.requiredPages } },
        timelineEvents: { type: "brief_updated", message: "Project brief updated; affected preview content was refreshed.", actorUserId: req.user!._id, createdAt: now },
      },
      $inc: { version: 1 },
    });
    if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Workflow changed; reload and try again" });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.brief.update", targetType: "website_workflow", targetId: workflow._id, result: "success", requestId: req.requestId, metadata: { fields: Object.keys(body).join(","), previousName: previous.business?.name ?? null, newName: nextBrief.business?.name ?? null } });
    const updated = await collections.websiteBuildWorkflows.findOne({ _id: workflow._id, orgId: req.orgId! });
    res.json(workflowResponse(updated));
  } catch (error) { next(error); }
});

websiteBuilderRouter.get("/website-builder/workflows/:id/artifact", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (!workflow.artifact || !["preview_ready", "user_review", "staging_approval"].includes(workflow.stage)) return res.status(409).json({ error: "Website artifact is not ready" }); res.setHeader("Content-Type", workflow.artifact.mimeType); res.setHeader("Content-Disposition", `attachment; filename="${workflow.artifact.filename}"`); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-OpsWorkbench-Artifact-SHA256", workflow.artifact.sha256); res.send(workflow.artifact.html); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-preview", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (!["preview_ready", "user_review"].includes(workflow.stage) || !workflow.artifact || !(workflow.validation as any)?.passed || (workflow.validation as any)?.artifactSha256 !== workflow.artifact.sha256) return res.status(409).json({ error: "A validated preview is not awaiting approval" }); if (req.body?.artifactSha256 !== workflow.artifact.sha256) return res.status(409).json({ error: "Preview digest changed or missing; reload before approving" }); const updated = await recordApproval(req, workflow, "preview", workflow.version, { stage: "staging_approval" }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.preview.approve", targetType: "website_workflow", targetId: workflow._id, result: "success", requestId: req.requestId, metadata: { productionProtected: true } }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/suggestions", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try {
    const workflow = await loadWorkflow(req, res); if (!workflow) return;
    if (workflow.stage !== "preview_ready" || !workflow.brief || !workflow.architecture || !workflow.sections || !workflow.artifact) return res.status(409).json({ error: "Suggestions require an unapproved preview" });
    const body = z.object({ suggestionId: z.string().regex(/^(regen-hero|regen-features|add-contact|a11y-contrast):[1-9][0-9]*$/), decision: z.enum(["accepted", "rejected"]) }).strict().parse(req.body);
    const [kind, revision] = body.suggestionId.split(":");
    const section = workflow.sections.find(item => item.id === kind.replace("regen-", ""));
    if (Number(revision) !== (section?.version || workflow.artifact.version) || (workflow.suggestionDecisions || []).some(item => item.id === body.suggestionId)) return res.status(409).json({ error: "Suggestion is stale or already decided" });
    if (body.decision === "accepted" && (!section || !kind.startsWith("regen-"))) return res.status(409).json({ error: "This recommendation requires a manual brief edit" });
    const now = new Date(); const set: Record<string, unknown> = { updatedAt: now };
    if (body.decision === "accepted") {
      const regenerated = await resolveSiteGenerationProvider().regenerateSection(section! as any, workflow.brief as any);
      const sections = workflow.sections.map(item => item.id === section!.id ? regenerated : item);
      const brand = workflow.brandDirections?.find(item => item.id === workflow.selectedBrandId); if (!brand) return res.status(409).json({ error: "Preview theme is unavailable" });
      const artifact = buildStaticSiteArtifact(workflow.brief, workflow.architecture, brand, sections as any); artifact.version = workflow.version + 1;
      Object.assign(set, { sections, artifact, validation: { ...buildValidation(sections as any), artifactSha256: artifact.sha256 }, stage: "preview_ready" });
    }
    const changed = await collections.websiteBuildWorkflows.updateOne({ _id: workflow._id, orgId: req.orgId!, version: workflow.version }, { $set: set, $inc: { version: 1 }, $push: { suggestionDecisions: { id: body.suggestionId, decision: body.decision, version: workflow.version, actorUserId: req.user!._id, createdAt: now }, timelineEvents: { type: "suggestion_decision", message: "Template suggestion " + kind + " " + body.decision + ". Final preview approval is pending.", actorUserId: req.user!._id, createdAt: now } } });
    if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Project changed; reload and try again" });
    res.json(workflowResponse(await collections.websiteBuildWorkflows.findOne({ _id: workflow._id, orgId: req.orgId! })));
  } catch (error) { next(error); }
});
