import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { audit } from "./audit.js";
import { noStore, requirePermission } from "./auth.js";
import { collections } from "./db.js";
import { buildArchitecture, buildBrandDirections, buildImplementationPlan, buildProjectBrief, buildSiteContent, buildStaticSiteArtifact, buildValidation, regenerateSiteSection } from "./websiteBuilder.js";

export const websiteBuilderRouter = express.Router();

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
  return { workflow: { id: workflow._id, websiteType: workflow.websiteType, stage: workflow.stage, version: workflow.version, currentQuestionIndex: workflow.currentQuestionIndex, answerCount: workflow.answers.length, brief: workflow.brief, architecture: workflow.architecture, brandDirections: workflow.brandDirections, selectedBrandId: workflow.selectedBrandId, sections: workflow.sections, implementationPlan: workflow.implementationPlan, artifact: workflow.artifact, validation: workflow.validation, approvals: workflow.approvals || [], estimatedCredits: workflow.estimatedCredits, actualCredits: workflow.actualCredits, createdAt: workflow.createdAt, updatedAt: workflow.updatedAt }, question };
}

async function loadWorkflow(req: express.Request, res: express.Response) {
  const workflowId = String(req.params.id); if (!ObjectId.isValid(workflowId)) { res.status(404).json({ error: "Workflow not found" }); return null; }
  const workflow = await collections.websiteBuildWorkflows.findOne({ _id: new ObjectId(workflowId), orgId: req.orgId! }); if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return null; } return workflow;
}

async function recordApproval(req: express.Request, workflow: any, artifactType: string, artifactVersion: number, set: Record<string, unknown>) {
  const now = new Date(); const changed = await collections.websiteBuildWorkflows.updateOne({ _id: workflow._id, orgId: req.orgId!, version: workflow.version }, { $set: { ...set, updatedAt: now }, $push: { approvals: { artifactType, artifactVersion, decidedBy: req.user!._id, decidedAt: now } }, $inc: { version: 1 } });
  if (changed.modifiedCount !== 1) return null;
  await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.artifact.approve", targetType: "website_workflow", targetId: workflow._id, result: "success", requestId: req.requestId, metadata: { artifactType, artifactVersion } });
  return collections.websiteBuildWorkflows.findOne({ _id: workflow._id, orgId: req.orgId! });
}

websiteBuilderRouter.get("/website-builder/workflows", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const rows = await collections.websiteBuildWorkflows.find({ orgId: req.orgId! }).sort({ updatedAt: -1 }).limit(50).toArray(); res.json({ workflows: rows.map((row) => workflowResponse(row).workflow) }); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try {
    const body = z.object({ websiteType: websiteTypeSchema }).strict().parse(req.body); const now = new Date();
    const result = await collections.websiteBuildWorkflows.insertOne({ orgId: req.orgId!, createdByUserId: req.user!._id, websiteType: body.websiteType, stage: "discovery", version: 1, currentQuestionIndex: 0, answers: [], estimatedCredits: 5, actualCredits: 0, createdAt: now, updatedAt: now });
    const workflow = await collections.websiteBuildWorkflows.findOne({ _id: result.insertedId, orgId: req.orgId! });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.workflow.create", targetType: "website_workflow", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { websiteType: body.websiteType, stage: "discovery", estimatedCredits: 5 } });
    res.status(201).json(workflowResponse(workflow));
  } catch (error) { next(error); }
});

websiteBuilderRouter.get("/website-builder/workflows/:id", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflowId = String(req.params.id); if (!ObjectId.isValid(workflowId)) return res.status(404).json({ error: "Workflow not found" }); const workflow = await collections.websiteBuildWorkflows.findOne({ _id: new ObjectId(workflowId), orgId: req.orgId! }); if (!workflow) return res.status(404).json({ error: "Workflow not found" }); res.json(workflowResponse(workflow)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/answers", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try {
    const workflowId = String(req.params.id); if (!ObjectId.isValid(workflowId)) return res.status(404).json({ error: "Workflow not found" });
    const id = new ObjectId(workflowId); const workflow = await collections.websiteBuildWorkflows.findOne({ _id: id, orgId: req.orgId!, stage: "discovery" });
    if (!workflow) return res.status(404).json({ error: "Active discovery workflow not found" });
    const expected = discoveryQuestions[workflow.currentQuestionIndex]; if (!expected) return res.status(409).json({ error: "Discovery is already complete" });
    const body = z.object({ questionId: z.literal(expected.id), value: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
    const now = new Date(); const nextIndex = workflow.currentQuestionIndex + 1; const stage = nextIndex >= discoveryQuestions.length ? "brief_review" : "discovery"; const answer = { questionId: body.questionId, value: body.value, answeredAt: now, answeredByUserId: req.user!._id }; const set: Record<string, unknown> = { currentQuestionIndex: nextIndex, stage, updatedAt: now };
    if (stage === "brief_review") set.brief = buildProjectBrief([...workflow.answers, answer], workflow.websiteType);
    const changed = await collections.websiteBuildWorkflows.updateOne({ _id: id, orgId: req.orgId!, currentQuestionIndex: workflow.currentQuestionIndex, stage: "discovery" }, { $push: { answers: answer }, $set: set, $inc: { version: 1 } });
    if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Workflow changed; reload and try again" });
    const updated = await collections.websiteBuildWorkflows.findOne({ _id: id, orgId: req.orgId! });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.discovery.answer", targetType: "website_workflow", targetId: id, result: "success", requestId: req.requestId, metadata: { questionId: body.questionId, stage } });
    res.json(workflowResponse(updated));
  } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-brief", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "brief_review" || !workflow.brief) return res.status(409).json({ error: "Brief is not awaiting approval" }); const architecture = buildArchitecture(workflow.brief); const updated = await recordApproval(req, workflow, "brief", Number((workflow.brief as any).version) || 1, { stage: "architecture_review", architecture, estimatedCredits: 15 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-architecture", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "architecture_review" || !workflow.architecture || !workflow.brief) return res.status(409).json({ error: "Architecture is not awaiting approval" }); const updated = await recordApproval(req, workflow, "architecture", Number((workflow.architecture as any).version) || 1, { stage: "brand_review", brandDirections: buildBrandDirections(workflow.brief), estimatedCredits: 35 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/select-brand", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "brand_review" || !workflow.brief || !workflow.architecture) return res.status(409).json({ error: "Brand direction is not awaiting selection" }); const allowed = (workflow.brandDirections || []).map((item: any) => item.id); const body = z.object({ directionId: z.enum(["clear-trust", "warm-human", "bold-modern"]) }).strict().parse(req.body); if (!allowed.includes(body.directionId)) return res.status(409).json({ error: "Brand direction is unavailable" }); const sections = buildSiteContent(workflow.brief, workflow.architecture); const updated = await recordApproval(req, workflow, "brand", 1, { stage: "content_review", selectedBrandId: body.directionId, sections, estimatedCredits: 45 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.patch("/website-builder/workflows/:id/sections/:sectionId", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (!["content_review", "preview_ready", "user_review"].includes(workflow.stage) || !workflow.sections) return res.status(409).json({ error: "Content is not editable" }); const sectionId = String(req.params.sectionId); const index = workflow.sections.findIndex((item) => item.id === sectionId); if (index < 0) return res.status(404).json({ error: "Section not found" }); const body = z.object({ heading: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(2000), cta: z.string().trim().max(80).optional() }).strict().parse(req.body); const sections = workflow.sections.map((item, itemIndex) => itemIndex === index ? { ...item, ...body, version: item.version + 1 } : item); const now = new Date(); const set: Record<string, unknown> = { sections, updatedAt: now }; if (workflow.stage !== "content_review" && workflow.brief && workflow.architecture) { const brand = (workflow.brandDirections || []).find((item: any) => item.id === workflow.selectedBrandId); if (!brand) return res.status(409).json({ error: "Approved brand direction is unavailable" }); const artifact = buildStaticSiteArtifact(workflow.brief, workflow.architecture, brand, sections as any); set.artifact = artifact; set.validation = { ...buildValidation(sections as any), artifactSha256: artifact.sha256, artifactBytes: artifact.bytes }; } const changed = await collections.websiteBuildWorkflows.updateOne({ _id: workflow._id, orgId: req.orgId!, version: workflow.version }, { $set: set, $inc: { version: 1 } }); if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Workflow changed; reload and try again" }); await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.section.update", targetType: "website_workflow", targetId: workflow._id, result: "success", requestId: req.requestId, metadata: { sectionId, version: sections[index].version } }); const updated = await collections.websiteBuildWorkflows.findOne({ _id: workflow._id, orgId: req.orgId! }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/sections/:sectionId/regenerate", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (!["content_review", "preview_ready", "user_review"].includes(workflow.stage) || !workflow.sections || !workflow.brief) return res.status(409).json({ error: "Content is not regeneratable" }); const sectionId = String(req.params.sectionId); const index = workflow.sections.findIndex((item) => item.id === sectionId); if (index < 0) return res.status(404).json({ error: "Section not found" }); const sections = workflow.sections.map((item, itemIndex) => itemIndex === index ? regenerateSiteSection(item as any, workflow.brief) : item); const now = new Date(); const set: Record<string, unknown> = { sections, updatedAt: now }; if (workflow.stage !== "content_review" && workflow.architecture) { const brand = (workflow.brandDirections || []).find((item: any) => item.id === workflow.selectedBrandId); if (!brand) return res.status(409).json({ error: "Approved brand direction is unavailable" }); const artifact = buildStaticSiteArtifact(workflow.brief, workflow.architecture, brand, sections as any); set.artifact = artifact; set.validation = { ...buildValidation(sections as any), artifactSha256: artifact.sha256, artifactBytes: artifact.bytes }; } const changed = await collections.websiteBuildWorkflows.updateOne({ _id: workflow._id, orgId: req.orgId!, version: workflow.version }, { $set: set, $inc: { version: 1, actualCredits: 0 } }); if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Workflow changed; reload and try again" }); await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.section.update", targetType: "website_workflow", targetId: workflow._id, result: "success", requestId: req.requestId, metadata: { sectionId, version: sections[index].version, deterministic: true } }); const updated = await collections.websiteBuildWorkflows.findOne({ _id: workflow._id, orgId: req.orgId! }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-content", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "content_review" || !workflow.sections || !workflow.architecture) return res.status(409).json({ error: "Content is not awaiting approval" }); const plan = buildImplementationPlan(workflow.architecture, workflow.sections as any); const updated = await recordApproval(req, workflow, "content", Math.max(...workflow.sections.map((item) => item.version)), { stage: "implementation_approval", implementationPlan: plan, estimatedCredits: 55 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-implementation", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "implementation_approval" || !workflow.implementationPlan || !workflow.sections || !workflow.brief || !workflow.architecture) return res.status(409).json({ error: "Implementation plan is not awaiting approval" }); const brand = (workflow.brandDirections || []).find((item: any) => item.id === workflow.selectedBrandId); if (!brand) return res.status(409).json({ error: "Approved brand direction is unavailable" }); const artifact = buildStaticSiteArtifact(workflow.brief, workflow.architecture, brand, workflow.sections as any); const validation = { ...buildValidation(workflow.sections as any), artifactSha256: artifact.sha256, artifactBytes: artifact.bytes }; const updated = await recordApproval(req, workflow, "implementation_plan", Number((workflow.implementationPlan as any).version) || 1, { stage: "preview_ready", artifact, validation, actualCredits: 0 }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});

websiteBuilderRouter.get("/website-builder/workflows/:id/artifact", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (!workflow.artifact || !["preview_ready", "user_review", "staging_approval"].includes(workflow.stage)) return res.status(409).json({ error: "Website artifact is not ready" }); res.setHeader("Content-Type", workflow.artifact.mimeType); res.setHeader("Content-Disposition", `attachment; filename="${workflow.artifact.filename}"`); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-OpsWorkbench-Artifact-SHA256", workflow.artifact.sha256); res.send(workflow.artifact.html); } catch (error) { next(error); }
});

websiteBuilderRouter.post("/website-builder/workflows/:id/approve-preview", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const workflow = await loadWorkflow(req, res); if (!workflow) return; if (workflow.stage !== "preview_ready" || !(workflow.validation as any)?.passed) return res.status(409).json({ error: "A validated preview is not awaiting approval" }); const updated = await recordApproval(req, workflow, "preview", workflow.version, { stage: "staging_approval" }); if (!updated) return res.status(409).json({ error: "Workflow changed; reload and try again" }); await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.preview.approve", targetType: "website_workflow", targetId: workflow._id, result: "success", requestId: req.requestId, metadata: { productionProtected: true } }); res.json(workflowResponse(updated)); } catch (error) { next(error); }
});
