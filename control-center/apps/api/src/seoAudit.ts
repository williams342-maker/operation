import type { SeoCategory, SeoFinding } from "@control-center/shared";
import { fetchPublicWebsite, validatePublicHealthCheckUrl, type PublicWebsiteHooks } from "./urlDiscovery.js";

export type SeoPageEvidence = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  responseTimeMs: number;
  contentBytes: number;
  contentType?: string;
  redirected: boolean;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  h1Count: number;
  imageCount: number;
  imagesMissingAlt: number;
  internalLinkCount: number;
  externalLinkCount: number;
  robotsStatus?: number;
  sitemapStatus?: number;
};

const text = (value?: string) => value?.replace(/<[^>]*>/g, " ").replace(/&(?:amp|#38);/gi, "&").replace(/&(?:quot|#34);/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find(Boolean);
const meta = (html: string, name: string) => {
  const tag = html.match(new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, "i"))?.[0];
  return tag ? text(attr(tag, "content")) : undefined;
};
const link = (html: string, rel: string) => {
  const tag = html.match(new RegExp(`<link\\b[^>]*rel\\s*=\\s*["'][^"']*\\b${rel}\\b[^"']*["'][^>]*>`, "i"))?.[0];
  return tag ? attr(tag, "href") : undefined;
};

export function analyzeSeoDocument(input: { html: string; requestedUrl: string; finalUrl: string; status: number; responseTimeMs: number; redirected: boolean; contentType?: string; robotsStatus?: number; sitemapStatus?: number; keywords?: string[] }) {
  const { html } = input;
  const pageTitle = text(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  const description = meta(html, "description");
  const canonical = link(html, "canonical");
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map((match) => attr(match[0], "href")).filter(Boolean) as string[];
  const pageOrigin = new URL(input.finalUrl).origin;
  let internalLinkCount = 0; let externalLinkCount = 0;
  for (const href of anchors) { try { const resolved = new URL(href, input.finalUrl); if (resolved.protocol === "http:" || resolved.protocol === "https:") resolved.origin === pageOrigin ? internalLinkCount++ : externalLinkCount++; } catch { /* malformed links are ignored */ } }
  const evidence: SeoPageEvidence = { requestedUrl: input.requestedUrl, finalUrl: input.finalUrl, status: input.status, responseTimeMs: input.responseTimeMs, contentBytes: Buffer.byteLength(html), contentType: input.contentType, redirected: input.redirected, title: pageTitle, metaDescription: description, canonical, h1Count: h1s.length, imageCount: images.length, imagesMissingAlt: images.filter((tag) => !attr(tag, "alt")?.trim()).length, internalLinkCount, externalLinkCount, robotsStatus: input.robotsStatus, sitemapStatus: input.sitemapStatus };
  const findings: SeoFinding[] = [];
  const add = (finding: SeoFinding) => findings.push(finding);
  if (input.status < 200 || input.status >= 400) add({ code: "page-http-status", category: "technical", severity: "critical", title: "Page does not return a successful status", summary: `The audited page returned HTTP ${input.status}.`, recommendation: "Restore a 2xx response or an intentional permanent redirect before optimizing page content.", evidence: { status: input.status } });
  if (input.contentType && !/text\/html|application\/xhtml\+xml/i.test(input.contentType)) add({ code: "content-type", category: "technical", severity: "critical", title: "Audit target is not an HTML page", summary: `The target returned ${input.contentType}.`, recommendation: "Set the project's public URL to the rendered website rather than an API or health endpoint.", evidence: { contentType: input.contentType } });
  if (!input.finalUrl.startsWith("https://")) add({ code: "https-missing", category: "technical", severity: "critical", title: "HTTPS is not active", summary: "The final audited URL uses unencrypted HTTP.", recommendation: "Serve the public page over HTTPS with a valid certificate and redirect HTTP traffic.", evidence: { finalUrl: input.finalUrl } });
  if (!pageTitle) add({ code: "title-missing", category: "metadata", severity: "critical", title: "Page title is missing", summary: "No non-empty title element was found.", recommendation: "Add a unique, descriptive title that accurately represents this page.", evidence: { present: false } });
  else if (pageTitle.length < 20 || pageTitle.length > 60) add({ code: "title-length", category: "metadata", severity: "warning", title: "Page title length needs review", summary: `The title is ${pageTitle.length} characters; 20–60 is a useful review range.`, recommendation: "Rewrite the title concisely while preserving the page's actual subject.", evidence: { length: pageTitle.length } });
  if (!description) add({ code: "description-missing", category: "metadata", severity: "warning", title: "Meta description is missing", summary: "No non-empty meta description was found.", recommendation: "Add a concise summary for search result previews; avoid unsupported claims.", evidence: { present: false } });
  else if (description.length < 70 || description.length > 170) add({ code: "description-length", category: "metadata", severity: "warning", title: "Meta description length needs review", summary: `The description is ${description.length} characters; 70–170 is a useful review range.`, recommendation: "Adjust the description to communicate the page value clearly without keyword stuffing.", evidence: { length: description.length } });
  if (h1s.length !== 1) add({ code: "h1-count", category: "content", severity: h1s.length === 0 ? "critical" : "warning", title: h1s.length === 0 ? "Primary heading is missing" : "Multiple primary headings found", summary: `The page contains ${h1s.length} h1 elements.`, recommendation: "Use one clear primary heading that describes the main page topic.", evidence: { count: h1s.length } });
  if (images.length && evidence.imagesMissingAlt) add({ code: "image-alt-missing", category: "content", severity: "warning", title: "Some images lack alternative text", summary: `${evidence.imagesMissingAlt} of ${images.length} images have no non-empty alt attribute.`, recommendation: "Add meaningful alt text to informative images and an empty alt attribute to decorative images.", evidence: { images: images.length, missingAlt: evidence.imagesMissingAlt } });
  if (!canonical) add({ code: "canonical-missing", category: "indexing", severity: "warning", title: "Canonical URL is missing", summary: "No canonical link was found on the page.", recommendation: "Declare the preferred public URL after confirming the site's canonicalization strategy.", evidence: { present: false } });
  if (input.robotsStatus !== undefined && (input.robotsStatus === 0 || input.robotsStatus >= 400)) add({ code: "robots-unavailable", category: "indexing", severity: "warning", title: "robots.txt is unavailable", summary: input.robotsStatus ? `The origin robots.txt returned HTTP ${input.robotsStatus}.` : "The origin robots.txt could not be retrieved safely.", recommendation: "Publish and review robots.txt so crawler directives are explicit.", evidence: { status: input.robotsStatus } });
  if (input.sitemapStatus !== undefined && (input.sitemapStatus === 0 || input.sitemapStatus >= 400)) add({ code: "sitemap-unavailable", category: "indexing", severity: "warning", title: "XML sitemap is unavailable", summary: input.sitemapStatus ? `The origin sitemap.xml returned HTTP ${input.sitemapStatus}.` : "The origin sitemap.xml could not be retrieved safely.", recommendation: "Publish a current XML sitemap and reference it from robots.txt.", evidence: { status: input.sitemapStatus } });
  if (input.responseTimeMs > 500) add({ code: "response-time", category: "performance", severity: input.responseTimeMs > 2000 ? "critical" : "warning", title: "Server response is slower than the staging threshold", summary: `The bounded audit request completed in ${input.responseTimeMs} ms. This is not a Core Web Vitals measurement.`, recommendation: "Review server response time, caching, and upstream dependencies, then validate with real-user or browser performance telemetry.", evidence: { responseTimeMs: input.responseTimeMs, thresholdMs: 500 } });
  if (evidence.contentBytes > 200_000) add({ code: "html-size", category: "performance", severity: "warning", title: "HTML response is large", summary: `The captured HTML is ${evidence.contentBytes} bytes.`, recommendation: "Review server-rendered markup and embedded data; validate transfer size with browser tooling.", evidence: { contentBytes: evidence.contentBytes, reviewThresholdBytes: 200000 } });
  const searchable = `${pageTitle || ""} ${description || ""} ${h1s.map((match) => text(match[1])).join(" ")}`.toLocaleLowerCase();
  for (const keyword of input.keywords || []) if (!searchable.includes(keyword)) add({ code: `keyword-${findings.length}`, category: "content", severity: "info", title: `Target phrase not found: ${keyword}`, summary: "The phrase was not found in the title, meta description, or primary heading.", recommendation: "Use the phrase only if it accurately reflects this page and reads naturally.", evidence: { keyword, checkedFields: "title,meta-description,h1" } });
  const categories: SeoCategory[] = ["technical", "metadata", "content", "indexing", "performance"];
  const categoryScores = Object.fromEntries(categories.map((category) => [category, Math.max(0, 100 - findings.filter((finding) => finding.category === category).reduce((sum, finding) => sum + (finding.severity === "critical" ? 30 : finding.severity === "warning" ? 12 : 0), 0))])) as Record<SeoCategory, number>;
  const score = Math.round(categories.reduce((sum, category) => sum + categoryScores[category], 0) / categories.length);
  return { score, categoryScores, evidence, findings };
}

export async function runSeoAudit(targetUrl: string, keywords: string[] = [], hooks: PublicWebsiteHooks = {}) {
  const requestedUrl = await validatePublicHealthCheckUrl(targetUrl, hooks.resolve);
  const started = Date.now();
  const page = await fetchPublicWebsite(requestedUrl, hooks);
  const responseTimeMs = Date.now() - started;
  const origin = new URL(page.response.url).origin;
  const statusFor = async (path: string) => { try { return (await fetchPublicWebsite(new URL(path, origin).toString(), hooks)).response.status; } catch { return 0; } };
  const [robotsStatus, sitemapStatus] = await Promise.all([statusFor("/robots.txt"), statusFor("/sitemap.xml")]);
  return analyzeSeoDocument({ html: page.response.text, requestedUrl, finalUrl: page.response.url, status: page.response.status, responseTimeMs, redirected: page.redirected, contentType: page.response.headers["content-type"], robotsStatus, sitemapStatus, keywords });
}
