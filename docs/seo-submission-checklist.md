# SEO Submission Day Checklist — Crafters Market

After iter120 shipped Schema.org structured data (Product / Person /
Article JSON-LD on every prerendered page), this is the operator's
playbook to get every major search engine indexing the new
rich-results signals as fast as possible.

**Estimated time to complete:** 25 minutes total. Most of it is waiting
for the consoles to verify ownership.

---

## Pre-flight (5 min)

Run these checks BEFORE you submit anything. Catching a misconfig now
prevents a 2-week indexing delay later.

### 1. Verify the sitemap is live and clean

```bash
curl -s https://craftersmarket.org/api/sitemap.xml | head -c 500
curl -s https://craftersmarket.org/api/seo/diag | python3 -m json.tool
```

The `seo/diag` payload should show:
- `resolved_site_root` ends in `craftersmarket.org` (NOT `preview.emergentagent.com`)
- `preview_domain_leakage: false`
- `total_indexable_urls` is a sane count (homepage + 9 static + your real product/maker/blog counts)
- `test_slugs_stripped` shows non-zero numbers if you've ever seeded test data — that's correct
- `public_site_url_env` is set in production env

If `preview_domain_leakage: true`, **stop here** — fix `PUBLIC_SITE_URL`
in production .env, redeploy, and re-check. Submitting a sitemap that
points at the preview domain will get every URL flagged as duplicate
content.

### 2. Verify robots.txt

```bash
curl -s https://craftersmarket.org/api/robots.txt
```

Confirm:
- The `Sitemap:` line at the bottom is `https://craftersmarket.org/api/sitemap.xml` (NOT a preview URL)
- Major user-agents (`*`, `GPTBot`, `ClaudeBot`, `PerplexityBot`) are allowed

### 3. Spot-check Schema.org structured data on three URLs

Open Google's Rich Results Test (https://search.google.com/test/rich-results) and paste these three URLs one by one:

- `https://craftersmarket.org/api/og/product/<any-real-product-slug>`
- `https://craftersmarket.org/api/og/maker/<any-real-maker-slug>`
- `https://craftersmarket.org/api/og/journal/<any-real-blog-slug>`

Each should report:
- ✅ Page is eligible for rich results
- The right schema detected: Product / Person / Article
- Zero errors, ≤ 0–1 warnings (warnings about optional fields are OK)

If any of the three errors out, screenshot the error and ping the dev
team — that's a JSON-LD bug that needs a fix before you submit.

---

## Submission day (15 min)

### A. Google Search Console

1. Go to https://search.google.com/search-console
2. Add property → URL prefix → `https://craftersmarket.org/`
3. Verify ownership. **Easiest path:** DNS TXT record (already set if
   you've used GSC for this domain before). If not, the HTML-tag method
   needs a small `<meta name="google-site-verification" content="…">`
   added to `/app/frontend/public/index.html` `<head>` and a redeploy.
4. Once verified: **Sitemaps** → "Add a new sitemap" → enter
   `api/sitemap.xml` → Submit.
5. Wait ~5 minutes for the first crawl, then refresh — status should
   flip from "Couldn't fetch" → "Success" with the URL count.
6. **Coverage** report: come back tomorrow and check the "Discovered"
   numbers. Within 7 days you should see the bulk of your products
   under "Indexed" with ≤ 5% errors.
7. **Enhancements → Products**: this is where the JSON-LD pays off.
   Within ~14 days you should see your products show up here as
   "Eligible for Product rich results" with the price + availability
   pulled from the schema. Watch for any "Invalid" entries — those are
   pages where the JSON-LD couldn't parse (usually a price field issue).

### B. Bing Webmaster Tools

1. Go to https://www.bing.com/webmasters
2. Sign in with the same Microsoft account you use for Bing Ads (if any
   — same login means automatic ad-attribution down the line).
3. Add site → `https://craftersmarket.org/` → use the GSC import option
   if it's offered. That copies your verification + sitemap from GSC in
   one click. Otherwise verify via DNS TXT or HTML-tag.
4. Sitemap → **already auto-imported from GSC** if you used the import
   path. Otherwise: Sitemaps → Submit sitemap → `https://craftersmarket.org/api/sitemap.xml`.
5. **Use the IndexNow integration** that's already live in the admin
   dashboard (`/admin → SEO → Ping IndexNow`). Bing reads IndexNow
   submissions as authoritative, often indexing within hours instead of
   days.

### C. Yandex Webmaster (optional, ~3% of US search traffic)

Skip unless you have meaningful Russian-speaking customers. If you do:
1. https://webmaster.yandex.com/
2. Add site → verify via TXT or `<meta>` → Sitemap submit.
3. Yandex auto-respects the same IndexNow pings Bing does.

### D. DuckDuckGo

DuckDuckGo doesn't have its own webmaster console — it reads from Bing
+ Wikipedia + a few smaller sources. If your Bing index is healthy,
DuckDuckGo coverage follows automatically within ~1 week.

### E. Pinterest (optional but high-leverage for makers)

Crafters Market's product photos rank well on Pinterest visual search.
- https://business.pinterest.com → Claim your website (DNS TXT).
- This unlocks Rich Pins that pull price + availability from your
  Product JSON-LD automatically. No extra code needed.

---

## Day 1 + 7 + 30 follow-ups

### Day 1 (24 hours after submission)
- GSC → URL Inspection: paste your homepage URL → "Test live URL". Should report "URL is on Google" within 24h of submission. If not, click "Request indexing" to force-queue it.
- Hit `/admin/seo/ping` from the admin dashboard once to fire IndexNow at Bing/Yandex/Naver/Seznam/Yep. Logs the result to `seo_indexnow_audit`.

### Day 7
- GSC → Performance → check Impressions count for the domain. Should be > 0 (Google is showing your pages, even if no clicks yet).
- GSC → Coverage → confirm "Indexed" count is at least 60–70% of `total_indexable_urls` from `seo/diag`.
- Bing Webmaster → SEO Reports → fix any flagged issues (usually missing alt text or short titles).

### Day 30
- GSC → Search Results → filter by "Rich result type: Product" → confirm impressions are flowing. This is where the Schema.org investment shows up.
- Set up GSC alerts: Settings → Alerts → email any sudden coverage drops.
- Connect GSC + Google Analytics: Admin → Property → Search Console links. Lets you see organic-search → revenue attribution in GA without leaving the dashboard.

---

## Common gotchas

- **www.craftersmarket.org vs craftersmarket.org**: The canonical-host
  middleware (iter109) 301-redirects www to apex. Submit ONLY the apex
  to GSC. Submitting both creates a duplicate-content split.
- **Sitemap caching**: the `/api/sitemap.xml` route is dynamic — every
  request rebuilds from Mongo. If you've just added a new product and
  want it indexed today, hit `/admin/seo/ping` from admin to fire
  IndexNow rather than waiting for the next GSC crawl.
- **JSON-LD price field**: must be a STRING, not a number, per Schema.org
  spec. Already correct in iter120. If a future code change accidentally
  serializes it as a number, GSC will flip Products to "Invalid" and
  you'll lose rich results until it's fixed.
- **Test slugs in sitemap**: confirmed stripped via `_TEST_SLUG_PATTERNS`
  in `routers/seo.py`. If you ever add a new test data convention,
  update that regex tuple — otherwise GSC will flag your test rows as
  thin content and ding the whole domain.

---

## How to know it's working

**Best leading indicator (Day 3–7):** open https://craftersmarket.org
in a private window and search Google for `site:craftersmarket.org`.
The result count = number of URLs Google has actually indexed. Should
climb daily. Same query on Bing.

**Best trailing indicator (Day 14–30):** Search Google for the title of
one of your top products. If your Product page shows up with the
**price + "In stock"** annotation in the search snippet — that's the
JSON-LD doing its job.
