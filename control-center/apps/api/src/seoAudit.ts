import type { SeoFinding } from "./models.js";

export function analyzeSeoHtml(html: string, httpStatus: number) {
  const clean = (value?: string) => value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = html.match(/<meta\s+[^>]*name=["']description["'][^>]*>/i)?.[0].match(/content=["']([^"']*)["']/i)?.[1]?.trim();
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const images = html.match(/<img\b[^>]*>/gi) || [];
  const missingAlt = images.filter((tag) => !/\balt=["'][^"']*["']/i.test(tag)).length;
  const make = (id: string, ok: boolean, heading: string, detail: string, warning = false): SeoFinding => ({ id, severity: ok ? "pass" : warning ? "warning" : "error", title: heading, detail });
  const findings: SeoFinding[] = [
    make("status", httpStatus >= 200 && httpStatus < 300, "Page is reachable", `HTTP status ${httpStatus}`),
    make("title", !!title && title.length >= 15 && title.length <= 60, "Search title", title ? `${title.length} characters; recommended 15–60` : "Missing <title>"),
    make("description", !!description && description.length >= 50 && description.length <= 160, "Meta description", description ? `${description.length} characters; recommended 50–160` : "Missing meta description"),
    make("h1", h1Count === 1, "Primary heading", h1Count === 1 ? "Exactly one H1" : `Found ${h1Count} H1 elements`),
    make("canonical", /<link\s+[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i.test(html), "Canonical URL", "Declare the preferred page URL", true),
    make("lang", /<html\s+[^>]*lang=["'][^"']+["']/i.test(html), "Document language", "Set the html lang attribute", true),
    make("viewport", /<meta\s+[^>]*name=["']viewport["']/i.test(html), "Mobile viewport", "Include a viewport meta tag"),
    make("image-alt", missingAlt === 0, "Image alternatives", `${missingAlt} of ${images.length} images missing alt text`),
    make("indexable", !/<meta\s+[^>]*(?:name=["']robots["'][^>]*content=["'][^"']*noindex|content=["'][^"']*noindex[^>]*name=["']robots["'])/i.test(html), "Indexability", "No page-level noindex directive detected"),
  ];
  const deductions = findings.reduce((sum, item) => sum + (item.severity === "error" ? 12 : item.severity === "warning" ? 5 : 0), 0);
  return { score: Math.max(0, 100 - deductions), findings, pageTitle: title, metaDescription: description };
}
