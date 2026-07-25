import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { audit } from "./audit.js";
import { noStore, requirePermission } from "./auth.js";
import { collections } from "./db.js";

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
  return { workflow: { id: workflow._id, websiteType: workflow.websiteType, stage: workflow.stage, version: workflow.version, currentQuestionIndex: workflow.currentQuestionIndex, answerCount: workflow.answers.length, estimatedCredits: workflow.estimatedCredits, actualCredits: workflow.actualCredits, createdAt: workflow.createdAt, updatedAt: workflow.updatedAt }, question };
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
    const now = new Date(); const nextIndex = workflow.currentQuestionIndex + 1; const stage = nextIndex >= discoveryQuestions.length ? "brief_review" : "discovery";
    const changed = await collections.websiteBuildWorkflows.updateOne({ _id: id, orgId: req.orgId!, currentQuestionIndex: workflow.currentQuestionIndex, stage: "discovery" }, { $push: { answers: { questionId: body.questionId, value: body.value, answeredAt: now, answeredByUserId: req.user!._id } }, $set: { currentQuestionIndex: nextIndex, stage, updatedAt: now }, $inc: { version: 1 } });
    if (changed.modifiedCount !== 1) return res.status(409).json({ error: "Workflow changed; reload and try again" });
    const updated = await collections.websiteBuildWorkflows.findOne({ _id: id, orgId: req.orgId! });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "website.discovery.answer", targetType: "website_workflow", targetId: id, result: "success", requestId: req.requestId, metadata: { questionId: body.questionId, stage } });
    res.json(workflowResponse(updated));
  } catch (error) { next(error); }
});
