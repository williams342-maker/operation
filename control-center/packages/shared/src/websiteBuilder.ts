import { z } from "zod";

export const websiteBuilderSectionSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  type: z.enum(["hero", "features", "about", "cta", "contact"]),
  heading: z.string().min(1).max(120),
  body: z.string().min(1).max(800),
  buttonLabel: z.string().max(40).optional()
}).strict();

export const websiteBuilderContentSchema = z.object({
  siteName: z.string().min(1).max(80),
  tagline: z.string().min(1).max(140),
  description: z.string().min(1).max(400),
  primaryCta: z.string().min(1).max(40),
  palette: z.object({
    primary: z.string().regex(/^#[0-9a-f]{6}$/i),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    background: z.string().regex(/^#[0-9a-f]{6}$/i),
    text: z.string().regex(/^#[0-9a-f]{6}$/i)
  }).strict(),
  sections: z.array(websiteBuilderSectionSchema).min(2).max(12)
}).strict();

export const websiteBuilderSaveSchema = z.object({
  baseRevision: z.number().int().min(0),
  source: z.enum(["manual", "ai"]).default("manual"),
  content: websiteBuilderContentSchema
}).strict();

export const websiteBuilderGenerateSchema = z.object({
  prompt: z.string().trim().min(12).max(2000),
  current: websiteBuilderContentSchema.optional()
}).strict();

export type WebsiteBuilderContent = z.infer<typeof websiteBuilderContentSchema>;
export type WebsiteBuilderSave = z.infer<typeof websiteBuilderSaveSchema>;
export type WebsiteBuilderGenerate = z.infer<typeof websiteBuilderGenerateSchema>;
