export type WebsiteBuildStage = "discovery" | "brief_review" | "architecture_review" | "brand_review" | "content_review" | "implementation_approval" | "preview_ready" | "user_review" | "staging_approval" | "paused";
export type DiscoveryAnswer = { questionId: string; value: string };
export type WebsiteType = "business" | "store" | "landing_page" | "redesign" | "connected_project" | "other";
import crypto from "node:crypto";

export type SiteSection = { id: string; type: "hero" | "features" | "about" | "cta"; heading: string; body: string; cta?: string; version: number };

const answerMap = (answers: DiscoveryAnswer[]) => Object.fromEntries(answers.map((answer) => [answer.questionId, answer.value.trim()]));
const list = (value = "") => value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";

export function normalizeWebsiteObjective(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
}

export function inferWebsiteType(objective: string): WebsiteType {
  const value = normalizeWebsiteObjective(objective).toLowerCase();
  if (/\b(redesign|refresh|moderni[sz]e|replace).{0,30}\b(site|website)\b|\b(existing|current) (site|website)\b/.test(value)) return "redesign";
  if (/\b(connected project|existing project|repository|repo)\b/.test(value)) return "connected_project";
  if (/\b(online store|storefront|e-?commerce|shop|sell (?:my |our )?(?:products|goods|items))\b/.test(value)) return "store";
  if (/\b(landing page|campaign page|waitlist|lead capture|single page)\b/.test(value)) return "landing_page";
  return "business";
}

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

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const safeColor = (value: unknown, fallback: string) => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
export function buildStaticSiteArtifact(brief: any, architecture: any, brand: any, sections: SiteSection[]) {
  const background = safeColor(brand?.colors?.[2], "#f8fafc"); const text = safeColor(brand?.colors?.[0], "#0f172a"); const accent = safeColor(brand?.colors?.[1], "#2563eb");
  const navigation = architecture.navigation.map((item: any) => `<a href="${escapeHtml(item.route)}">${escapeHtml(item.title)}</a>`).join("");
  const content = sections.map((section) => `<section class="section ${escapeHtml(section.type)}"><div class="inner"><h${section.type === "hero" ? "1" : "2"}>${escapeHtml(section.heading)}</h${section.type === "hero" ? "1" : "2"}><p>${escapeHtml(section.body)}</p>${section.cta ? `<a class="button" href="#contact">${escapeHtml(section.cta)}</a>` : ""}</div></section>`).join("");
  const css = `:root{color-scheme:light;--bg:${background};--text:${text};--accent:${accent}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.6}header{display:flex;align-items:center;justify-content:space-between;gap:2rem;padding:1rem clamp(1rem,5vw,4rem);border-bottom:1px solid color-mix(in srgb,var(--text) 12%,transparent)}nav{display:flex;flex-wrap:wrap;gap:1rem}a{color:inherit;text-decoration:none}.section{padding:clamp(3rem,8vw,7rem) clamp(1rem,5vw,4rem);text-align:center;border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent)}.inner{max-width:64rem;margin:auto}h1{font-size:clamp(2.4rem,7vw,5.5rem);line-height:1.05;margin:0}h2{font-size:clamp(1.8rem,4vw,3rem);line-height:1.15;margin:0}.section p{max-width:48rem;margin:1.25rem auto 0}.button{display:inline-block;margin-top:2rem;padding:.85rem 1.25rem;border-radius:.65rem;background:var(--accent);color:#fff;font-weight:700}@media(max-width:640px){header nav{display:none}.section{padding-block:3.5rem}}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(brief.business.name)}</title><meta name="description" content="${escapeHtml(brief.business.description).slice(0, 160)}"><style>${css}</style></head><body><header><strong>${escapeHtml(brief.business.name)}</strong><nav aria-label="Primary">${navigation}</nav></header><main>${content}</main></body></html>`;
  return { version: 1, filename: `${slug(brief.business.name)}-website.html`, mimeType: "text/html; charset=utf-8", html, sha256: crypto.createHash("sha256").update(html).digest("hex"), bytes: Buffer.byteLength(html), generatedAt: new Date() };
}
