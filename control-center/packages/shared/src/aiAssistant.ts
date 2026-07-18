import { z } from "zod";

export const aiAssistantScopeSchema = z.object({ type: z.enum(["server", "application"]), id: z.string().min(1).max(128) }).strict();
export const aiAssistantRequestSchema = z.object({
  scope: aiAssistantScopeSchema,
  question: z.string().trim().min(3).max(1000),
  contextOptions: z.object({ includeHealth: z.boolean().default(true), includeDiscovery: z.boolean().default(true), includeRecentLogs: z.boolean().default(false), includeDeployments: z.boolean().default(true), includeCiSummary: z.boolean().default(true) }).strict().default({})
}).strict();

const evidenceSchema = z.object({ sourceType: z.enum(["server", "application", "telemetry", "health_check", "discovery", "deployment", "ci_summary"]), label: z.string().max(160), value: z.string().max(500) }).strict();
const causeSchema = z.object({ title: z.string().max(200), evidence: z.array(z.string().max(500)).max(10) }).strict();
const stepSchema = z.object({ order: z.number().int().min(1).max(20), title: z.string().max(200), description: z.string().max(1000), actionType: z.literal("manual_diagnostic") }).strict();

export const aiAssistantResponseSchema = z.object({
  summary: z.string().min(1).max(2000), status: z.enum(["healthy", "warning", "critical", "unknown"]), confidence: z.enum(["low", "medium", "high"]), risk: z.enum(["low", "medium", "high"]),
  likelyCauses: z.array(causeSchema).max(10), recommendedSteps: z.array(stepSchema).max(12), evidence: z.array(evidenceSchema).max(20), limitations: z.array(z.string().max(500)).max(10), executedActions: z.array(z.never()).max(0), generatedAt: z.string().datetime().optional()
}).strict();

export type AiAssistantRequest = z.infer<typeof aiAssistantRequestSchema>;
export type AiAssistantResponse = z.infer<typeof aiAssistantResponseSchema>;
