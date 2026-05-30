# Cloudflare prerender Worker — setup for craftersmarket.org

**iter298 · May 30 2026**

## What this Worker does

Routes search-engine, social-media, and AI crawler traffic transparently to the FastAPI prerender endpoints (`/api/og/<kind>/<slug>`) so they get crawlable HTML with full schema markup instead of the JS-only React shell. Real human traffic is untouched.

Coverage:

| SPA route                              | Backend prerender              |
|----------------------------------------|--------------------------------|
| `/shop`                                | `/api/og/shop`                 |
| `/shop/<slug>`                         | `/api/og/product/<slug>`       |
| `/makers`                              | `/api/og/makers`               |
| `/makers/<slug>`                       | `/api/og/maker/<slug>`         |
| `/journal/<slug>`                      | `/api/og/journal/<slug>`       |
| `/community/files/<uuid>`              | `/api/og/community/file/<uuid>`|

Crawlers detected (substring match on `User-Agent`):

- Search: Googlebot, Bingbot, DuckDuckBot, Yandex, Baidu, Applebot, etc.
- Social: facebookexternalhit, Twitterbot, LinkedInBot, Slackbot, Discordbot, Pinterestbot, TelegramBot, WhatsApp, redditbot, Embedly
- AI: GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, anthropic-ai
- SEO tools: AhrefsBot, SemrushBot, ScreamingFrogSEOSpider, DataForSeoBot, MJ12bot

## Deploy

1. **Cloudflare Dashboard → `craftersmarket.org` → Workers Routes → Create**
2. Route pattern: `craftersmarket.org/*` (and `www.craftersmarket.org/*` if that hostname is still live)
3. Worker → "Create application" → paste the contents of `/app/cloudflare/prerender-router.worker.js`
4. **Save and Deploy**.

Optional: assign the Worker to a custom name (e.g. `crafters-market-prerender-router`) so future deploys overwrite the same worker.

## Verify

```bash
# Crawler request → expect prerender HTML + X-CM-Prerender header.
curl -sI -A "Googlebot/2.1" https://craftersmarket.org/shop/some-real-slug | grep -i 'x-cm-prerender\|content-type'

# Same URL, regular browser → expect SPA shell.
curl -sI -A "Mozilla/5.0 (Macintosh)" https://craftersmarket.org/shop/some-real-slug | head -5

# Index page sanity check.
curl -s -A "Bingbot" https://craftersmarket.org/shop | head -50
curl -s -A "Pinterestbot" https://craftersmarket.org/makers | head -50
```

The first call should return HTML whose `<title>` reflects the actual product / category title and includes a `<script type="application/ld+json">` block with `Product` + `BreadcrumbList`. The second call should return the regular SPA shell.

## Diagnostics

Backend exposes a public health endpoint that lists sample prerender URLs so you can verify the catalog → prerender pipeline:

```
GET https://craftersmarket.org/api/og/diag
```

Returns `{ site_root, indexes: { shop, makers }, samples: { products[], makers[], journal[] } }`.

## Operational notes

- **No cache-busting needed.** Cloudflare's default cache for Workers is short-lived (`max-age=300`, set by the Worker itself). Product / maker edits surface within 5 minutes.
- **Stale slugs.** When a crawler asks for a slug that no longer exists, the backend prerender soft-302s to `/shop` (products) or `/makers` (makers) so the share link still lands somewhere useful.
- **`OPTIONS` preflight + non-GET.** The Worker only rewrites GET requests (default `fetch()` behavior). All other methods pass through.
- **AI bot opt-out.** If you want to BLOCK AI crawlers instead of routing them, extend the Worker with an early `return new Response("", { status: 403 })` for matching UAs (or use Cloudflare → Security → Bots → "AI Scrapers and Crawlers" → Block).

## Rollback

To disable the Worker without removing it: Cloudflare Dashboard → Workers Routes → toggle the route to "Disabled". The SPA continues to serve all traffic. The prerender endpoints stay live and accessible at `/api/og/...` URLs for manual sharing.

## Source

- Worker: `/app/cloudflare/prerender-router.worker.js`
- Backend prerender: `/app/backend/routers/og_prerender.py`
- Diag: `GET /api/og/diag`
