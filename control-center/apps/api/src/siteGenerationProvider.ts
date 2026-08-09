// Provider-neutral site *planning* for Foundry.
//
// Safety model: the deterministic generator in websiteBuilder.ts is the default
// and the guaranteed fallback. No LLM is ever contacted unless AI planning is
// explicitly enabled (FOUNDRY_AI_PLANNING_ENABLED=true) AND the shared AI
// provider (aiAssistant.ts) reports "ready". Any resolution failure falls back
// to deterministic — the builder never breaks because a provider is missing.
//
// Only *planning* (brief, sitemap, brand, content) is pluggable here. Rendering
// (buildStaticSiteArtifact / buildValidation) stays deterministic always, so the
// engine controls *how* a site is built while a provider may inform *what* to
// build. Provider-specific code must never leak past this module into routes or
// the UI: callers depend on SiteGenerationProvider, not on any concrete provider.
import { z } from "zod";
import { providerReadiness } from "./aiAssistant.js";
import {
  buildArchitecture,
  buildBrandDirections,
  buildProjectBrief,
  buildSiteContent,
  deriveDiscoveryAnswers,
  regenerateSiteSection,
  type DiscoveryAnswer,
  type SiteSection,
} from "./websiteBuilder.js";

// Structured site-plan contract. The deterministic generator already produces
// these shapes; any future LLM planning provider MUST return output that parses
// against these schemas before it is applied to a workflow. This is the single
// validation boundary for untrusted model output.
export const briefSchema = z.object({
  version: z.number().int().positive(),
  business: z.object({ name: z.string().min(1), description: z.string() }),
  audience: z.object({ primary: z.string().min(1) }),
  goals: z.object({ primaryGoal: z.string().min(1), primaryAction: z.string().min(1) }),
  brand: z.object({ personality: z.array(z.string()) }),
  website: z.object({ type: z.string().min(1), requiredPages: z.array(z.string().min(1)).min(1) }),
  constraints: z.object({ launchDate: z.string().optional() }),
  approved: z.boolean(),
});

export const architectureSchema = z.object({
  version: z.number().int().positive(),
  pages: z.array(z.object({
    id: z.string().min(1),
    route: z.string().min(1),
    title: z.string().min(1),
    purpose: z.string(),
    primaryAudience: z.string(),
    primaryAction: z.string(),
    sections: z.array(z.string()),
  })).min(1),
  navigation: z.array(z.object({ title: z.string(), route: z.string() })),
  accessibilityTarget: z.string(),
  approved: z.boolean(),
});

export const brandDirectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rationale: z.string(),
  colors: z.array(z.string()),
  headingStyle: z.string(),
  density: z.string(),
});

export const siteSectionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["hero", "features", "about", "cta"]),
  heading: z.string().min(1),
  body: z.string().min(1),
  cta: z.string().optional(),
  version: z.number().int().positive(),
});

export type Brief = z.infer<typeof briefSchema>;
export type Architecture = z.infer<typeof architectureSchema>;
export type BrandDirection = z.infer<typeof brandDirectionSchema>;

export type SiteGenerationMode = "deterministic" | "ai-planning";

// The seam every caller depends on. Methods are async so an AI provider can plug
// in without changing call sites; the deterministic provider resolves immediately.
export interface SiteGenerationProvider {
  readonly name: string;
  readonly mode: SiteGenerationMode;
  // Turn one natural-language request into structured discovery answers. This is
  // the AI-first entry; the deterministic default derives honest answers, a live
  // provider can genuinely interpret intent — callers stay identical either way.
  understand(prompt: string, websiteType: string): Promise<DiscoveryAnswer[]>;
  brief(answers: DiscoveryAnswer[], websiteType: string): Promise<Brief>;
  architecture(brief: Brief): Promise<Architecture>;
  brandDirections(brief: Brief): Promise<BrandDirection[]>;
  content(brief: Brief, architecture: Architecture): Promise<SiteSection[]>;
  regenerateSection(section: SiteSection, brief: Brief): Promise<SiteSection>;
}

// Wraps the existing deterministic generators unchanged. This is the default
// provider and the fallback for every other provider.
export const deterministicSiteProvider: SiteGenerationProvider = {
  name: "deterministic",
  mode: "deterministic",
  async understand(prompt, websiteType) { return deriveDiscoveryAnswers(prompt, websiteType); },
  async brief(answers, websiteType) { return buildProjectBrief(answers, websiteType) as Brief; },
  async architecture(brief) { return buildArchitecture(brief) as Architecture; },
  async brandDirections(brief) { return buildBrandDirections(brief) as BrandDirection[]; },
  async content(brief, architecture) { return buildSiteContent(brief, architecture); },
  async regenerateSection(section, brief) { return regenerateSiteSection(section, brief); },
};

// Feature flag: off by default. Turning it on is necessary but not sufficient —
// the shared AI provider must also be configured and ready, and a budget must be
// in place (enforced separately) before any paid call is made.
export function foundryAiPlanningEnabled() {
  return process.env.FOUNDRY_AI_PLANNING_ENABLED === "true";
}

// Resolves the active planning provider. Deterministic unless AI planning is
// enabled and the shared provider is ready. When an AiPlanningSiteProvider is
// introduced (Stage 1), it is returned here and nowhere else.
export function resolveSiteGenerationProvider(): SiteGenerationProvider {
  if (!foundryAiPlanningEnabled()) return deterministicSiteProvider;
  if (providerReadiness().state !== "ready") return deterministicSiteProvider;
  // Stage 1 (requires provider credentials + approved budget) plugs the AI
  // planning provider in here; until then we stay deterministic even when the
  // flag is on, so enabling the flag alone can never incur cost.
  return deterministicSiteProvider;
}
