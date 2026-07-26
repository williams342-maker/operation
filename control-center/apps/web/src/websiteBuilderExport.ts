import type { WebsiteBuilderContent } from "@control-center/shared";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const safeColor = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

export function websiteBuilderFilename(siteName: string) {
  const slug = siteName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${slug || "website"}.html`;
}

export function renderWebsiteDocument(content: WebsiteBuilderContent) {
  const name = escapeHtml(content.siteName);
  const description = escapeHtml(content.description);
  const primary = safeColor(content.palette.primary, "#06b6d4");
  const accent = safeColor(content.palette.accent, "#22c55e");
  const background = safeColor(content.palette.background, "#07131f");
  const text = safeColor(content.palette.text, "#f8fafc");
  const sections = content.sections.map((section, index) => `<section id="${escapeHtml(section.id)}" class="section ${escapeHtml(section.type)}${index % 2 ? " alternate" : ""}"><div class="wrap"><p class="eyebrow">${escapeHtml(section.type)}</p><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p>${section.buttonLabel ? `<a class="button" href="#contact">${escapeHtml(section.buttonLabel)}</a>` : ""}</div></section>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${description}"><title>${name}</title><style>
:root{--primary:${primary};--accent:${accent};--bg:${background};--text:${text}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem clamp(1rem,5vw,4rem);border-bottom:1px solid color-mix(in srgb,var(--text) 14%,transparent)}header strong{font-size:1.1rem}.wrap{width:min(720px,calc(100% - 2rem));margin:auto}.section{padding:clamp(3.5rem,8vw,7rem) 0}.alternate{background:color-mix(in srgb,var(--text) 5%,transparent)}.hero{text-align:center;padding-block:clamp(5rem,13vw,10rem)}h1,h2{margin:.25rem 0 1rem;line-height:1.1}h1{font-size:clamp(2.6rem,8vw,5rem)}h2{font-size:clamp(2rem,5vw,3.25rem)}p{margin:.5rem 0;opacity:.82}.eyebrow{color:var(--primary);font-size:.75rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.button{display:inline-block;margin-top:1.5rem;padding:.75rem 1.1rem;border-radius:.5rem;background:var(--primary);color:var(--bg);font-weight:800;text-decoration:none}header .button{margin:0;background:var(--accent)}footer{padding:2rem;text-align:center;border-top:1px solid color-mix(in srgb,var(--text) 14%,transparent);font-size:.8rem;opacity:.65}@media(max-width:480px){header{align-items:flex-start;flex-direction:column}}
</style></head><body><header><strong>${name}</strong><a class="button" href="#contact">${escapeHtml(content.primaryCta)}</a></header><main><section class="section hero"><div class="wrap"><p class="eyebrow">Welcome</p><h1>${escapeHtml(content.tagline)}</h1><p>${description}</p></div></section>${sections}</main><footer>© ${new Date().getFullYear()} ${name}</footer></body></html>`;
}
