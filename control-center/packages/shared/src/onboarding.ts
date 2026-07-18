export function normalizeWebsiteUrl(input: string) {
  const raw = input.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Website URL must use HTTP or HTTPS');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  if (url.pathname === '/') url.pathname = '';
  return url.toString().replace(/\/$/, '');
}

export function slugFromDomain(domain: string) {
  return domain.toLowerCase().replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
}

export function displayNameFromDomain(domain: string) {
  const slug = slugFromDomain(domain);
  if (slug === "opsworkbench") return "OpsWorkbench";
  return slug.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function deriveWebsiteTarget(input: string) {
  const normalizedUrl = normalizeWebsiteUrl(input);
  const domain = new URL(normalizedUrl).hostname;
  return { normalizedUrl, domain, displayName: displayNameFromDomain(domain), slug: slugFromDomain(domain) };
}
