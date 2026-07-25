import { z } from "zod";
import { aiWorkforceRoleIdSchema } from "./aiWorkforce.js";

export const aiAssistantScopeSchema = z.object({ type: z.enum(["server", "application"]), id: z.string().min(1).max(128) }).strict();
export const aiAssistantRequestSchema = z.object({
  scope: aiAssistantScopeSchema,
  roleId: aiWorkforceRoleIdSchema.default("operations_analyst"),
  question: z.string().trim().min(3).max(1000),
  contextOptions: z.object({ includeHealth: z.boolean().default(true), includeDiscovery: z.boolean().default(true), includeRecentLogs: z.boolean().default(false), includeDeployments: z.boolean().default(true), includeCiSummary: z.boolean().default(true) }).strict().default({})
}).strict();

export const operationalSourceTypes = ["server", "agent_heartbeat", "telemetry", "metrics", "services", "containers", "compose", "kubernetes", "health_check", "discovery", "git", "deployment", "rollback", "scheduled_task", "failure", "alert", "audit", "rate_limit", "ai_usage", "ci_summary", "logs"] as const;
const sourceTypeSchema = z.enum(operationalSourceTypes);
const freshnessSchema = z.enum(["fresh", "aging", "stale", "unavailable"]);
const confidenceSchema = z.enum(["low", "medium", "high"]);
const evidenceSchema = z.object({
  sourceType: sourceTypeSchema, label: z.string().max(160), value: z.string().max(1000),
  timestamp: z.string().datetime(), freshness: freshnessSchema, source: z.string().max(160), confidence: confidenceSchema
}).strict();
const causeSchema = z.object({ title: z.string().max(200), score: z.number().min(0).max(1), evidence: z.array(z.string().max(500)).max(10) }).strict();
const stepSchema = z.object({ order: z.number().int().min(1).max(20), title: z.string().max(200), description: z.string().max(1000), classification: z.enum(["information", "low_risk_diagnostic", "medium_risk_investigation", "manual_intervention", "high_risk_operation"]), evidence: z.array(z.string().max(500)).max(10), actionType: z.literal("manual_diagnostic") }).strict();
const timelineSchema = z.object({ timestamp: z.string().datetime(), event: z.string().max(500), source: sourceTypeSchema, confidence: confidenceSchema }).strict();
const incidentSchema = z.object({ id: z.string().max(128), summary: z.string().max(500), similarity: z.number().min(0).max(1), timestamp: z.string().datetime() }).strict();

export const aiAssistantResponseSchema = z.object({
  summary: z.string().min(1).max(2000), status: z.enum(["healthy", "warning", "critical", "unknown"]), confidence: confidenceSchema, risk: z.enum(["low", "medium", "high"]),
  likelyCauses: z.array(causeSchema).max(10), recommendedSteps: z.array(stepSchema).max(12), evidence: z.array(evidenceSchema).max(50),
  alternativePossibilities: z.array(z.string().max(500)).max(10), timeline: z.array(timelineSchema).max(50), relatedIncidents: z.array(incidentSchema).max(10),
  limitations: z.array(z.string().max(500)).max(10), executedActions: z.array(z.never()).max(0), generatedAt: z.string().datetime().optional()
}).strict();

export type OperationalSourceType = typeof operationalSourceTypes[number];
export type AiEvidence = z.infer<typeof evidenceSchema>;
export type AiAssistantRequest = z.infer<typeof aiAssistantRequestSchema>;
export type AiAssistantResponse = z.infer<typeof aiAssistantResponseSchema>;
