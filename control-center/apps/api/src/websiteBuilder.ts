export type WebsiteBuildStage = "discovery" | "brief_review" | "architecture_review" | "brand_review" | "content_review" | "implementation_approval" | "preview_ready" | "user_review" | "staging_approval" | "paused";
export type DiscoveryAnswer = { questionId: string; value: string };
export type SiteSection = { id: string; type: "hero" | "features" | "about" | "cta"; heading: string; body: string; cta?: string; version: number };

const answerMap = (answers: DiscoveryAnswer[]) => Object.fromEntries(answers.map((answer) => [answer.questionId, answer.value.trim()]));
const list = (value = "") => value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";

export function buildProjectBrief(answers: DiscoveryAnswer[], websiteType: string) {
  const value = answerMap(answers);
  return { version: 1, business: { name: value.business_name || "Untitled business", description: value.business_purpose || "", }, audience: { primary: value.primary_audience || "General audience" }, goals: { primaryGoal: value.primary_goal || "Explain the business", primaryAction: value.primary_action || "Get in touch" }, brand: { personality: list(value.brand_personality) }, website: { type: websiteType, requiredPages: list(value.required_pages).length ? list(value.required_pages) : ["Home", "About", "Contact"] }, constraints: { launchDate: value.launch_target || undefined }, approved: false };
}

export function buildArchitecture(brief: any) {
  const pages = brief.website.requiredPages.map((title: string, index: number) => ({ id: `page-${index + 1}`, route: index === 0 ? "/" : `/${slug(title)}`, title, purpose: index === 0 ? brief.goals.primaryGoal : `Help visitors understand ${title.toLowerCase()}`, primaryAudience: brief.audience.primary, primaryAction: brief.goals.primaryAction, sections: index === 0 ? ["hero", "features", "about", "cta"] : ["hero", "about", "cta"] }));
  return { version: 1, pages, navigation: pages.map(({ title, route }: any) => ({ title, route })), accessibilityTarget: "WCAG 2.2 AA", approved: false };
}

export function buildBrandDirections(brief: any) {
  const name = brief.business.name;
  return [
    { id: "clear-trust", name: "Clear & Trustworthy", rationale: `A calm, credible direction for ${name}.`, colors: ["#0f172a", "#2563eb", "#f8fafc"], headingStyle: "Confident sans serif", density: "Comfortable" },
    { id: "warm-human", name: "Warm & Human", rationale: `An approachable, relationship-led direction for ${name}.`, colors: ["#422006", "#ea580c", "#fff7ed"], headingStyle: "Expressive serif", density: "Relaxed" },
    { id: "bold-modern", name: "Bold & Modern", rationale: `A high-contrast, action-focused direction for ${name}.`, colors: ["#09090b", "#10b981", "#fafafa"], headingStyle: "Geometric sans serif", density: "Compact" },
  ];
}

export function buildSiteContent(brief: any, architecture: any): SiteSection[] {
  const name = brief.business.name; const action = brief.goals.primaryAction;
  return [
    { id: "hero", type: "hero", heading: `${name}, built around what matters`, body: brief.business.description, cta: action, version: 1 },
    { id: "features", type: "features", heading: "How we help", body: `Focused solutions for ${brief.audience.primary}, shaped around ${brief.goals.primaryGoal.toLowerCase()}.`, version: 1 },
    { id: "about", type: "about", heading: `Why ${name}`, body: `A clear, practical approach designed for ${brief.audience.primary}.`, version: 1 },
    { id: "cta", type: "cta", heading: "Ready to take the next step?", body: `Start with ${name} today.`, cta: action, version: 1 },
  ].filter((section) => architecture.pages[0].sections.includes(section.id)) as SiteSection[];
}

export function buildImplementationPlan(architecture: any, sections: SiteSection[]) {
  return { version: 1, routeCount: architecture.pages.length, componentCount: sections.length, files: ["src/generated-site/content.json", "src/generated-site/LandingPage.tsx", "src/generated-site/site.css"], tests: ["responsive layout", "keyboard navigation", "heading hierarchy", "metadata"], estimatedCredits: 25, repositoryMutation: false, deploymentImpact: "Preview only; staging requires separate approval.", rollback: "Restore the prior immutable artifact version.", approved: false };
}

export function buildValidation(sections: SiteSection[]) {
  const findings = [sections.some((section) => section.type === "hero") ? null : "Hero section missing", sections.every((section) => section.heading.trim()) ? null : "A section heading is missing", sections.some((section) => section.cta) ? null : "Primary call to action missing"].filter(Boolean);
  return { passed: findings.length === 0, checks: 4, warnings: findings, reviewedAt: new Date() };
}

export function regenerateSiteSection(section: SiteSection, brief: any): SiteSection {
  const name = brief.business.name; const audience = brief.audience.primary;
  const alternatives: Record<string, Pick<SiteSection, "heading" | "body">> = {
    hero: { heading: `${name} helps you move forward with confidence`, body: `${brief.business.description} Built for ${audience}.` },
    features: { heading: "What you can expect", body: `Practical support designed around the priorities of ${audience}.` },
    about: { heading: `A thoughtful approach from ${name}`, body: `Clear communication and focused work for ${audience}.` },
    cta: { heading: "Let’s get started", body: `Take the next step with ${name}.` },
  };
  return { ...section, ...(alternatives[section.type] || alternatives.about), version: section.version + 1 };
}
