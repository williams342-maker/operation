# Pinterest Catalog Sync — Setup Guide (iter350)

Turn every Crafters Market product into a Rich Product Pin automatically — no per-pin API plumbing, no maker action required. Pinterest pulls our feed on a 24-hour schedule and surfaces products in visual search + shopping placements.

## How it works

```
┌────────────────────┐   pulls every 24h   ┌─────────────────────────┐
│  Pinterest crawler │ ─────────────────▶ │  /api/pinterest/         │
└────────────────────┘                    │     catalog.tsv          │
                                          │  (built from db.products │
                                          │   on every request)      │
                                          └─────────────────────────┘
```

- **Pull-based** — no token needed. Pinterest fetches a public URL.
- **Always fresh** — feed is built dynamically from MongoDB on every request, so price + availability are always live.
- **Independent** of existing one-off Pin publishing (`PINTEREST_ACCESS_TOKEN` flow is untouched).

## Feed endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/pinterest/catalog.tsv` | Public | The TSV feed Pinterest's crawler pulls. |
| `GET /api/pinterest/catalog/health` | Public | Diagnostic JSON: product count + last fetch timestamps. |

## One-time setup (~5 min)

1. **Verify the feed serves correctly:**
   ```bash
   curl -s "https://craftersmarket.org/api/pinterest/catalog.tsv" | head -5
   curl -s "https://craftersmarket.org/api/pinterest/catalog/health" | jq
   ```
   Expect: header row matching `id\ttitle\tdescription\tlink\timage_link\t…` plus product rows.

2. **Verify your domain on Pinterest** (skip if already done):
   - Go to https://business.pinterest.com → Settings → Claim → Claim Website.
   - Use the DNS TXT method (faster than HTML tag for our setup).
   - Wait ~10 min for Pinterest to detect the TXT record.

3. **Register the catalog data source:**
   - Pinterest Business Hub → **Ads** → **Catalogs** → **Get started** (or **Add data source** if you already have a catalog).
   - **Feed URL:** `https://craftersmarket.org/api/pinterest/catalog.tsv`
   - **File format:** `TSV` (tab-separated)
   - **Country:** US · **Language:** en · **Currency:** USD
   - **Update schedule:** Daily (Pinterest's max frequency)
   - Click **Save**.

4. **First ingestion:** Pinterest processes the feed within 24 hours. After it lands, the diagnostic endpoint will show:
   ```json
   {
     "last_pinterest_fetch_at": "2026-06-11T03:14:00+00:00",
     "last_any_fetch_ua": "Pinterestbot/1.0 (+https://www.pinterest.com/bot.html)",
     "product_count": 83
   }
   ```

5. **Watch for errors:** Pinterest Business Hub → Catalogs → your data source → **Diagnostics** tab. Common warnings:
   - **Missing field warnings** → check `_product_to_row` in `routers/pinterest_catalog.py` and add the field to the source product if applicable.
   - **Image too small** → Pinterest requires ≥600×600. If our seed images are smaller, the row is still indexed but won't appear in shopping placements.
   - **Inactive item count** → rows missing `title`, `image_link`, or `price` are intentionally skipped (would cause feed rejection otherwise).

## Field mapping (our DB → Pinterest spec)

| Pinterest field | Source | Notes |
|---|---|---|
| `id` | `product.slug` | Stable identifier. |
| `title` | `product.title` | Trimmed to 150 chars. |
| `description` | `product.description` (falls back to `title`) | 5000 char ceiling. |
| `link` | `${PUBLIC_SITE_URL}/shop/{slug}` | Always absolute. |
| `image_link` | `product.images[0]` (or `image_url`) | Auto-absolutized against `PUBLIC_SITE_URL` if site-root-relative. |
| `additional_image_link` | `product.images[1..10]` | Up to 10 extras, comma-separated. |
| `price` | `product.price` | Formatted `49.00 USD`. |
| `availability` | `product.in_stock` + `status` | `in stock` / `out of stock` / `preorder`. |
| `condition` | hardcoded `new` | All handmade goods. |
| `brand` | maker `shop_title` (falls back to `name`, then `product.brand`, then "Crafters Market") | |
| `google_product_category` | `GOOGLE_CATEGORY_MAP[category]` | Maps `Wall Art` → "Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork", etc. Omitted for unmapped categories. |
| `product_type` | `category > technique` | Our internal taxonomy. |
| `item_group_id` | reserved | Future: per-variant breakout. |

## Why TSV (not XML or CSV)?

Pinterest accepts TSV / CSV / XML (RSS 2.0). TSV is the lightest format and our titles/descriptions can contain commas — TSV avoids the quote-escaping hell that CSV demands. The `_BAD_CHARS` regex in the router strips embedded tabs/newlines from each field so the format stays clean.

## When to bump to per-variant rows

If we ever expose unique URLs per size/color variant (we don't today), we'd:

1. Emit one row per variant in `_product_to_row`.
2. Populate `item_group_id` with the parent product slug so Pinterest groups them.
3. Populate `color` and `size` from the variant.

That makes the variant selector on Pinterest's product pin match ours pixel-for-pixel.

## Verifying after setup

```bash
# Smoke check — last 3 rows of the live feed
curl -s "https://craftersmarket.org/api/pinterest/catalog.tsv" | tail -3 | column -t -s $'\t'

# Health endpoint — should show "Pinterestbot" UA after first ingestion
curl -s "https://craftersmarket.org/api/pinterest/catalog/health" | jq
```

If `last_pinterest_fetch_at` is still `null` 30 hours after registering the data source, double-check the Pinterest dashboard Diagnostics tab for ingestion errors.

## Real-time sync (optional · iter352)

The TSV feed above handles bulk sync on Pinterest's 24-48h schedule. For **immediate** updates after a price change or new listing, the same `PINTEREST_ACCESS_TOKEN` can call `POST /v5/catalogs/items/batch` to push specific items — provided the token includes the `catalogs:write` scope.

### Scope detection

Hit the admin endpoint to see what your current token can do:

```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  "https://craftersmarket.org/api/admin/pinterest/catalog-status"
```

Possible `status` values:
| status | meaning | action |
|---|---|---|
| `ok` | Token has `catalogs:read` + (likely) `catalogs:write` | Real-time sync available. |
| `no_token` | `PINTEREST_ACCESS_TOKEN` env var is empty | Run OAuth, store the token. |
| `expired` | 401 from Pinterest | Refresh the token (or re-run OAuth). |
| `no_read_scope` | 403 with "scope"/"permission" in message | Re-run OAuth with `scope=catalogs:read,catalogs:write`. |
| `no_catalogs_role` | 403 without scope wording | The Pinterest user lacks an ad-account Catalogs role (Owner/Admin/Catalogs Manager). |

### Manual re-sync the N most-recent products

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"limit":20}' \
  "https://craftersmarket.org/api/admin/pinterest/catalog-resync"
```

Pushes the 20 most-recently-updated published products via Pinterest's items-batch API. Useful after a bulk price change so the catalog reflects the new prices in minutes instead of waiting for the next 24h feed ingestion. Audit row written to `pinterest_resync_log`.

### Important — there is NO "force re-fetch feed" endpoint

Per Pinterest's official docs, the v5 API does **not** expose an endpoint to make Pinterest re-download the TSV feed on demand. The two mechanisms complement each other:

- **Feed (TSV)** — nightly bulk truth, no API token required.
- **Items batch API** — real-time deltas, requires `catalogs:write`.

If `catalogs:write` is missing, the `/admin/pinterest/catalog-resync` endpoint degrades cleanly (returns `{ok:false, reason:"no_write_scope"}`) — the next nightly feed ingestion will still pick up all changes, you just lose the minutes-instead-of-hours latency for the items you change between ingestions.

### Upgrading scope

The OAuth refresh token alone won't add new scopes — Pinterest requires a fresh user consent. Send your business admin through the OAuth flow again with `scope=user_accounts:read,boards:read,pins:read,pins:write,catalogs:read,catalogs:write` so the new token covers both pin publishing (unchanged) and catalog real-time sync (new).

