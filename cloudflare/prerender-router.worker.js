// Cloudflare Worker — Crafters Market crawler prerender router (iter298)
// =====================================================================
//
// What this does
// --------------
// Sniffs the `User-Agent` header on incoming requests to craftersmarket.org.
// When the requester is a known search-engine, social-media, or AI crawler
// AND the URL maps to a route we already have an `/api/og/<kind>/<slug>`
// prerender for, it transparently re-fetches the prerender URL from the
// backend and returns that HTML to the crawler. Real human traffic (any UA
// not on the crawler list) passes through to the React SPA unchanged.
//
// Why
// ---
// The React app is JS-only — Googlebot can execute JS but SEO tools, Bing,
// Pinterest, social-media unfurlers, and most AI crawlers don't. Without
// this Worker they see the static `index.html` shell and miss per-page
// content (product titles, prices, maker bios, breadcrumbs, JSON-LD).
// The backend prerender at `/api/og/<kind>/<slug>` already returns fully
// crawlable HTML with Product/Person/BreadcrumbList/ItemList schema —
// this Worker just routes crawlers to it.
//
// Deploy
// ------
// 1. Cloudflare Dashboard → craftersmarket.org → Workers Routes → Add
// 2. Route:  craftersmarket.org/*   (and  www.craftersmarket.org/*  if used)
// 3. Worker: paste this file's contents, deploy.
// 4. Verify:
//      curl -A "Googlebot/2.1" https://craftersmarket.org/shop/<slug>
//      → expect the `/api/og/product/<slug>` HTML, NOT the SPA shell.
//      curl -A "Mozilla/5.0 (Macintosh)" https://craftersmarket.org/shop/<slug>
//      → expect the regular SPA shell.
//
// Maintenance
// -----------
// • Add a new route family by extending `ROUTES` below.
// • Add a new crawler by extending `CRAWLER_UA_PATTERNS`.
// • Worker is read-only; no DB access. Origin (FastAPI) handles all data.

const CRAWLER_UA_PATTERNS = [
  // Search engines
  "Googlebot", "Bingbot", "Slurp", "DuckDuckBot", "Baiduspider", "YandexBot",
  "Sogou", "Exabot", "facebot", "ia_archiver", "Applebot",
  // Social unfurlers
  "facebookexternalhit", "Twitterbot", "LinkedInBot", "Slackbot",
  "Discordbot", "TelegramBot", "Pinterestbot", "Pinterest",
  "WhatsApp", "redditbot", "vkShare", "Embedly", "SkypeUriPreview",
  // AI crawlers
  "GPTBot", "ChatGPT-User", "ClaudeBot", "anthropic-ai", "PerplexityBot",
  "Google-Extended", "CCBot", "Bytespider", "Amazonbot", "Applebot-Extended",
  // SEO tools
  "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "DataForSeoBot",
  "ScreamingFrogSEOSpider", "SiteAuditBot", "SEOkicks",
];

// Map SPA path → backend prerender path. Function signatures take the
// matched slug/id and return the rewrite target. Order matters: more
// specific patterns first.
const ROUTES = [
  // /shop/<slug> → /api/og/product/<slug>
  {
    regex: /^\/shop\/([a-z0-9][a-z0-9_-]{0,119})\/?$/i,
    rewrite: (m) => `/api/og/product/${m[1]}`,
  },
  // /makers/<slug> → /api/og/maker/<slug>
  {
    regex: /^\/makers\/([a-z0-9][a-z0-9_-]{0,119})\/?$/i,
    rewrite: (m) => `/api/og/maker/${m[1]}`,
  },
  // /journal/<slug> → /api/og/journal/<slug>
  {
    regex: /^\/journal\/([a-z0-9][a-z0-9_-]{0,119})\/?$/i,
    rewrite: (m) => `/api/og/journal/${m[1]}`,
  },
  // /community/files/<uuid> → /api/og/community/file/<uuid>
  {
    regex: /^\/community\/files\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i,
    rewrite: (m) => `/api/og/community/file/${m[1]}`,
  },
  // /shop (index)   → /api/og/shop
  {
    regex: /^\/shop\/?$/i,
    rewrite: () => `/api/og/shop`,
  },
  // /makers (index) → /api/og/makers
  {
    regex: /^\/makers\/?$/i,
    rewrite: () => `/api/og/makers`,
  },
];

function isCrawler(ua) {
  if (!ua) return false;
  for (const p of CRAWLER_UA_PATTERNS) {
    if (ua.includes(p)) return true;
  }
  return false;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const ua = request.headers.get("user-agent") || "";

    // Non-crawlers → pass through to the SPA / regular origin.
    if (!isCrawler(ua)) {
      return fetch(request);
    }

    // Find a matching prerender route. If none match, pass through —
    // crawlers will get the SPA shell with its (already good) homepage
    // pre-mount HTML.
    let rewritePath = null;
    for (const route of ROUTES) {
      const m = url.pathname.match(route.regex);
      if (m) {
        rewritePath = route.rewrite(m);
        break;
      }
    }
    if (!rewritePath) {
      return fetch(request);
    }

    // Rewrite to the backend prerender. Preserve scheme + host so the
    // origin still sees `craftersmarket.org` and emits correct
    // canonical URLs. Strip any query string — the prerender doesn't
    // need it and forwarding it can cause cache misses.
    const target = new URL(rewritePath, url.origin).toString();
    const upstream = await fetch(target, {
      headers: {
        // Forward the original crawler UA so backend logging shows
        // which crawler asked for what.
        "User-Agent": ua,
        "X-Forwarded-Host": url.hostname,
        "X-Forwarded-Proto": "https",
        // Marker so backend logs can grep for Worker-routed requests.
        "X-CM-Prerender-Worker": "1",
      },
    });

    // Pass through whatever the origin returned (HTML 200, 302 to /shop
    // on a missing slug, etc.). Add a debug header so curl + DevTools
    // make the rewrite visible.
    const headers = new Headers(upstream.headers);
    headers.set("X-CM-Prerender", rewritePath);
    headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
