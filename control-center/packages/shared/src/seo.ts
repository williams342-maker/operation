import { z } from "zod";

export const seoCategorySchema = z.enum(["technical", "metadata", "content", "indexing", "performance"]);
export const seoSeveritySchema = z.enum(["info", "warning", "critical"]);

export const seoFindingSchema = z.object({
  code: z.string().min(1).max(80),
  category: seoCategorySchema,
  severity: seoSeveritySchema,
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(600),
  recommendation: z.string().min(1).max(600),
  evidence: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
}).strict();

export const seoAuditRequestSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(80)).max(10).default([])
}).strict().transform((value) => ({ keywords: [...new Set(value.keywords.map((keyword) => keyword.toLocaleLowerCase()))] }));

export type SeoCategory = z.infer<typeof seoCategorySchema>;
export type SeoSeverity = z.infer<typeof seoSeveritySchema>;
export type SeoFinding = z.infer<typeof seoFindingSchema>;
export type SeoAuditRequest = z.infer<typeof seoAuditRequestSchema>;
