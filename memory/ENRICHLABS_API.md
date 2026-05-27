# Crafters Market · EnrichLabs Data API

Read-only JSON endpoints so the EnrichLabs marketing agent (https://agent.enrichlabs.ai/marketing) can pull live business metrics from Crafters Market.

---

## Connection details

| | |
|---|---|
| **Base URL** | `https://craftersmarket.org/api/enrich/v1` |
| **Auth method** | Static API key |
| **Auth header** | `X-EnrichLabs-Key: <your-key>` |
| **Content-Type** | `application/json` (responses) |
| **Rate limit** | None (sane defaults, please cap to ≤ 60 req/min) |

> **API key (provision yourself one-time, then share with EnrichLabs):** see `ENRICHLABS_API_KEY` in the production environment. Rotate by replacing the env var.

---

## Endpoints

### `GET /schema`
Self-describing manifest. Hit this first if you want to introspect the contract programmatically.

---

### `GET /orders`
Anonymized paid orders, newest first.

**Query params**
- `since` — ISO date (e.g. `2026-05-01`) — orders created at or after
- `until` — ISO date — orders created strictly before
- `limit` — 1–500 (default 200)
- `cursor` — pass the previous response's `next_cursor` value to paginate older

**Response**
```json
{
  "rows": [
    {
      "id": "uuid",
      "created_at": "2026-05-19T03:59:34Z",
      "amount": 1.00,
      "currency": "usd",
      "status": "complete",
      "payment_status": "paid",
      "summary": "Wood Steampunk Box × 1",
      "buyer_hash": "31b8f4a6152941eba4e194be8a2d4a89",
      "maker_slugs": ["iron-and-oak"],
      "item_count": 1,
      "items": [
        { "maker_slug": "iron-and-oak", "title": "Wood Steampunk Box", "price": 1.00, "quantity": 1 }
      ],
      "discount_code": null,
      "discount_amount": null,
      "attribution_source": null
    }
  ],
  "count": 1,
  "next_cursor": "2026-05-19T03:59:34Z"
}
```

> **Privacy**: buyer email/name/address are never returned. `buyer_hash` is a salted SHA-256 — two orders from the same buyer share the same hash, so you can compute repeat-buyer rates without seeing PII.

---

### `GET /sellers`
Active maker shops with GMV + paid-order counts.

**Query params**
- `tier` — `plus` or `free`
- `limit` — 1–1000 (default 500)

**Response row**
```json
{
  "slug": "iron-and-oak",
  "name": "Iron & Oak Studio",
  "shop_title": "Precision CNC Since 2019",
  "email_hash": "21bbbdd1777917166bbbeccfc25befa1",
  "tier": "free",
  "subscription_status": "free",
  "founder_status": "inaugural",
  "location": "Nashville, TN",
  "onboarded_at": "2026-04-25T22:23:04Z",
  "listings_count": 5,
  "paid_orders_count": 12,
  "gross_revenue": 487.50,
  "shop_open": true,
  "stripe_payouts_enabled": true
}
```

---

### `GET /listings`
Product catalog snapshot.

**Query params**
- `maker_slug` — filter to one seller
- `status` — `published` / `draft` / `sold_out` / `paused`
- `limit` — 1–1000 (default 500)

---

### `GET /funnel`
Maker onboarding funnel for the last N days.

**Query params**
- `days` — 1–365 (default 30)

**Response**
```json
{
  "window_days": 30,
  "since": "2026-04-27T00:00:00Z",
  "stages": [
    { "key": "applied",       "label": "Applied",               "count": 42 },
    { "key": "approved",      "label": "Approved",              "count": 30 },
    { "key": "first_listing", "label": "Published 1st listing", "count": 24 },
    { "key": "first_sale",    "label": "Landed 1st paid sale",  "count": 9  },
    { "key": "plus_upgrade",  "label": "Upgraded to Plus",      "count": 3  }
  ]
}
```

---

### `GET /traffic`
Daily on-platform pageview + session aggregates from first-party events.

**Query params**
- `days` — 1–90 (default 30)

**Response**
```json
{
  "window_days": 7,
  "totals": { "pageviews": 12450, "sessions": 3120, "visitors": 2840 },
  "daily":  [ { "date": "2026-05-20", "pageviews": 1880, "sessions": 470, "visitors": 430 } ],
  "by_source":  [ { "source": "google", "pageviews": 5400 } ],
  "by_country": [ { "country": "US",    "pageviews": 9800 } ],
  "note": "GA4 is the source of truth for richer traffic data."
}
```

> For full GA4 attribution + acquisition reports, plug into our GA4 property directly — this endpoint is for first-party correlation only.

---

## Errors

| Code | Meaning |
|------|---------|
| `400` | Invalid query param (e.g. malformed ISO date) |
| `401` | Missing or wrong `X-EnrichLabs-Key` header |
| `503` | `ENRICHLABS_API_KEY` env var not configured on the server (integration off) |

---

## Versioning

The path includes `/v1`. Breaking changes ship as `/v2` — backwards-compatible additions land on `/v1` without notice. Watch `GET /schema` for additions.
