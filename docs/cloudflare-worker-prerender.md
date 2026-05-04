# Cloudflare Worker — Social Crawler Prerender Recipe

**Purpose:** Route known social-media / link-preview crawlers (Facebook, LinkedIn,
Twitter/X, Slack, Discord, iMessage, Telegram, WhatsApp, Pinterest, SEO auditors)
to our server-side OG prerender endpoints so every shared URL unfurls with a real
title, description and image — even though the main site is a React SPA.

Regular human traffic (anything that looks like a browser) is passed straight to
the origin SPA untouched. Zero impact on end-user latency.

---

## How it works

1. A user pastes `https://craftersmarket.org/product/walnut-american-flag` into
   Slack.
2. Slack's unfurler (User-Agent: `Slackbot-LinkExpanding 1.0`) hits Cloudflare.
3. The Worker matches the UA against our `CRAWLER_UA_REGEX`, then **rewrites**
   the request internally to `/api/og/product/walnut-american-flag`.
4. FastAPI (`backend/routers/og_prerender.py`) returns a tiny fully-rendered HTML
   page with complete `<meta og:*>` tags pre-filled from MongoDB.
5. Slack reads those tags and shows a rich card with the real product photo,
   title, maker name and price.
6. A human clicking the same link in a browser is **not** matched, so the Worker
   just does `fetch(request)` and the SPA loads normally.

---

## Prerender endpoints available on the API

All live behind the `/api` prefix (K8s ingress routes anything `/api/*` to the
FastAPI pod):

| URL pattern                       | Purpose                          |
| --------------------------------- | -------------------------------- |
| `/api/og/product/{slug}`          | Product detail page unfurl       |
| `/api/og/maker/{slug}`            | Maker profile unfurl             |
| `/api/og/journal/{slug}`          | Workshop journal post unfurl     |
| `/api/og/diag`                    | Sanity-check endpoint (returns JSON) |

Every route returns HTTP 200 with a complete `<!doctype html>` body containing:

- `<title>` and `<meta name="description">`
- `og:title`, `og:description`, `og:image`, `og:url`, `og:type`
- `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`
- A canonical `<link rel="canonical">` back to the SPA URL
- A visible `<h1>` + descriptive paragraph (so non-social SEO tools get real text)

If the slug is missing / deleted, the route falls back to generic marketplace
tags and still returns 200 (never 404 — 404s break some unfurlers' cache).

---

## Worker source (`crafters-prerender.js`)

Paste this into **Cloudflare → Workers & Pages → Create application → Create
Worker**, then bind it to the `craftersmarket.org` zone on the route
`craftersmarket.org/*`.

```js
// crafters-prerender.js
// Routes social-media crawlers to server-rendered OG endpoints.
// Passes everything else through to the origin unchanged.

// Matches the major link-preview bots. Kept intentionally tight — we DO NOT
// want to match Googlebot (it executes JS and should see the real SPA).
const CRAWLER_UA_REGEX = new RegExp(
  [
    "facebookexternalhit",
    "Facebot",
    "LinkedInBot",
    "Twitterbot",
    "Slackbot",            // matches Slackbot-LinkExpanding too
    "Discordbot",
    "TelegramBot",
    "WhatsApp",
    "Applebot",            // iMessage / Safari share sheet preview
    "Pinterest",
    "redditbot",
    "Embedly",
    "Iframely",
    "SkypeUriPreview",
    "vkShare",
    "W3C_Validator",
    "Screaming Frog SEO Spider",
    "AhrefsBot",
    "SemrushBot",
    "MJ12bot",
  ].join("|"),
  "i"
);

// URL patterns → OG endpoint builder
// Each returns null if the path does not match.
const ROUTE_MAP = [
  {
    test: /^\/product\/([a-z0-9-]+)\/?$/i,
    build: (m) => `/api/og/product/${m[1]}`,
  },
  {
    test: /^\/maker\/([a-z0-9-]+)\/?$/i,
    build: (m) => `/api/og/maker/${m[1]}`,
  },
  {
    test: /^\/journal\/([a-z0-9-]+)\/?$/i,
    build: (m) => `/api/og/journal/${m[1]}`,
  },
];

function resolveOgPath(pathname) {
  for (const route of ROUTE_MAP) {
    const m = pathname.match(route.test);
    if (m) return route.build(m);
  }
  return null;
}

export default {
  async fetch(request) {
    const ua = request.headers.get("user-agent") || "";
    const url = new URL(request.url);

    // Only GET + HTML-ish requests are candidates for rewriting.
    if (request.method !== "GET") return fetch(request);

    const isCrawler = CRAWLER_UA_REGEX.test(ua);
    if (!isCrawler) return fetch(request);

    const ogPath = resolveOgPath(url.pathname);
    if (!ogPath) return fetch(request); // crawler hitting /, /shop, etc.

    // Rewrite to the OG endpoint on the SAME origin. Cloudflare keeps this
    // internal (no extra DNS hop) and strips the original UA downstream if
    // you want — we forward it so FastAPI can log which bot asked.
    const rewritten = new URL(ogPath, url.origin);
    const originReq = new Request(rewritten.toString(), {
      method: "GET",
      headers: request.headers,
      redirect: "manual",
    });

    const res = await fetch(originReq);

    // Force a short cache on crawler responses so the next bot that asks
    // about the same URL gets the answer instantly.
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "public, max-age=600");
    out.headers.set("X-Prerendered", "1");
    out.headers.set("X-Prerender-UA", ua.slice(0, 120));
    return out;
  },
};
```

---

## Deploy checklist

1. **Create Worker** — Cloudflare Dashboard → Workers & Pages → Create → Hello
   World template → paste code above → Save & Deploy.
2. **Route binding** — Workers & Pages → your Worker → Settings → Triggers →
   Add route:
   - Route: `craftersmarket.org/*`
   - Zone: `craftersmarket.org`
   - Failure mode: `Fail open` (so if the Worker errors, users still get the
     SPA)
3. **Test locally first** with `curl` before binding the route:
   ```bash
   # Should return HTML with og:title pulled from Mongo
   curl -A "facebookexternalhit/1.1" https://craftersmarket.org/product/<slug>

   # Should return the SPA shell (no og:title in body — only in <head>)
   curl -A "Mozilla/5.0" https://craftersmarket.org/product/<slug>
   ```
4. **Verify unfurls** after binding:
   - Facebook: https://developers.facebook.com/tools/debug/
   - LinkedIn: https://www.linkedin.com/post-inspector/
   - Twitter/X: https://cards-dev.twitter.com/validator (or just paste into a
     draft tweet)
   - Slack: paste the URL in a private channel — the card should show real
     image + title within ~1 second.
5. **Monitor** — Workers dashboard → Metrics. You want to see a steady trickle
   of sub-request invocations with 200s. Any 5xx means the FastAPI pod is down
   — Worker fails open and users still get the SPA.

---

## Why not just do this in Nginx / FastAPI middleware?

We could, but Cloudflare Workers:

- Run at the edge (sub-10ms added latency worldwide) so link unfurlers don't
  wait on our origin to cold-start.
- Keep the crawler-routing logic **out of application code**, so adding a new
  bot (e.g., Mastodon) is a 30-second Worker edit — no deploy, no downtime.
- Give us a free 600-second edge cache per URL per crawler, which kills the
  thundering-herd problem when a single link is shared in a large Slack.
- Let us blackhole abusive scrapers (AhrefsBot, MJ12bot, etc.) in one line
  later if we decide to.

---

## Rollback

Disable the route binding in Cloudflare (Workers → Triggers → remove route).
Everything reverts to the SPA behavior within ~30 seconds worldwide. The
`/api/og/*` endpoints continue to work for direct curl / debugging — they're
just no longer reached by crawlers.

---

## Future additions

- **Adding a new SPA route that needs prerender:**
  1. Add the FastAPI handler in `backend/routers/og_prerender.py`
     (mimic the `/og/product/{slug}` pattern).
  2. Add an entry to `ROUTE_MAP` in the Worker.
  3. Redeploy Worker only — no origin deploy needed if the API handler was
     already shipped.
- **Adding a new crawler UA** — append the string to `CRAWLER_UA_REGEX`. Make
  sure it will not accidentally match Chrome, Safari, or Googlebot.
- **Locale-aware previews** — the Worker can read `Accept-Language` and pass it
  to the API as a query-string; the `og_prerender` route already falls through
  to a default if the locale is missing.
