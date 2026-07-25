import crypto from "node:crypto";
import type { AiWorkforceRunDoc } from "./models.js";
import { collections } from "./db.js";
import { audit } from "./audit.js";

const worker = { enabled: false, running: false, lastPollAt: null as Date | null, lastCompletedAt: null as Date | null, lastFailureCategory: null as string | null };
export function aiWorkforceWorkerStatus() { return { ...worker, externalProvidersEnabled: false, supportedProviders: ["mock"] }; }
export function buildWorkforceMockSummary(run: Pick<AiWorkforceRunDoc, "roleId" | "resourceType">, resource: Record<string, unknown> | null) {
  if (!resource) throw new Error("resource_missing");
  if (run.resourceType === "seo_audit") return `SEO analysis draft prepared from stored audit score ${Number(resource.score) || 0} across ${Number(resource.pagesCrawled) || 0} crawled pages.`;
  if (run.resourceType === "website_workflow") return `Website planning draft prepared for ${String(resource.websiteType || "website")} workflow in ${String(resource.stage || "unknown")} stage.`;
  if (run.resourceType === "server") return `Operations analysis draft prepared for server ${String(resource.name || "unnamed")} with ${String(resource.agentStatus || resource.status || "unknown")} status.`;
  return `Operations analysis draft prepared for project ${String(resource.name || "unnamed")}.`;
}
async function resourceFor(run: AiWorkforceRunDoc) {
  const filter = { _id: run.resourceId, orgId: run.orgId };
  if (run.resourceType === "seo_audit") return collections.seoAudits.findOne(filter, { projection: { score: 1, pagesCrawled: 1 } });
  if (run.resourceType === "website_workflow") return collections.websiteBuildWorkflows.findOne(filter, { projection: { websiteType: 1, stage: 1 } });
  if (run.resourceType === "server") return collections.servers.findOne(filter, { projection: { name: 1, agentStatus: 1, status: 1 } });
  return collections.projects.findOne(filter, { projection: { name: 1 } });
}
export async function processOneMockWorkforceRun() {
  const now = new Date(); worker.lastPollAt = now;
  const run = await collections.aiWorkforceRuns.findOneAndUpdate({ state: "queued", provider: "mock", availableAt: { $lte: now } }, { $set: { state: "running", startedAt: now, updatedAt: now }, $inc: { version: 1 } }, { sort: { availableAt: 1 }, returnDocument: "after" });
  if (!run) return false;
  try {
    await audit({ orgId: run.orgId, actorType: "system", action: "ai.workforce.run.start", targetType: "ai_workforce_run", targetId: run._id, result: "success", requestId: crypto.randomUUID(), metadata: { roleId: run.roleId, provider: "mock" } });
    const summary = buildWorkforceMockSummary(run, await resourceFor(run) as Record<string, unknown> | null); const completedAt = new Date();
    await collections.aiWorkforceRuns.updateOne({ _id: run._id, orgId: run.orgId, state: "running", version: run.version }, { $set: { state: "succeeded", resultSummary: summary.slice(0, 500), completedAt, updatedAt: completedAt }, $inc: { version: 1 } });
    worker.lastCompletedAt = completedAt; worker.lastFailureCategory = null;
    await audit({ orgId: run.orgId, actorType: "system", action: "ai.workforce.run.complete", targetType: "ai_workforce_run", targetId: run._id, result: "success", requestId: crypto.randomUUID(), metadata: { roleId: run.roleId, provider: "mock" } });
  } catch (error) {
    const category = error instanceof Error && error.message === "resource_missing" ? "resource_missing" : "worker_failure"; const completedAt = new Date(); worker.lastFailureCategory = category;
    await collections.aiWorkforceRuns.updateOne({ _id: run._id, orgId: run.orgId, state: "running", version: run.version }, { $set: { state: "failed", failureCategory: category, completedAt, updatedAt: completedAt }, $inc: { version: 1 } });
    await audit({ orgId: run.orgId, actorType: "system", action: "ai.workforce.run.complete", targetType: "ai_workforce_run", targetId: run._id, result: "failure", requestId: crypto.randomUUID(), metadata: { roleId: run.roleId, provider: "mock", category } });
  }
  return true;
}
export async function startAiWorkforceWorker() {
  worker.enabled = process.env.AI_WORKFORCE_WORKER_ENABLED === "true"; if (!worker.enabled || worker.running) return;
  worker.running = true; const stale = new Date(Date.now() - 5 * 60_000); await collections.aiWorkforceRuns.updateMany({ state: "running", provider: "mock", startedAt: { $lt: stale } }, { $set: { state: "queued", availableAt: new Date(), updatedAt: new Date() }, $unset: { startedAt: "" }, $inc: { version: 1 } });
  const poll = async () => { try { while (await processOneMockWorkforceRun()) { /* drain bounded queue serially */ } } catch { worker.lastFailureCategory = "poll_failure"; } };
  await poll(); const timer = setInterval(poll, 5000); timer.unref();
}
