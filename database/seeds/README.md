# Mongo Seed Exports

Safe-to-commit JSON snapshots from the preview database. Used as fixtures for
local dev, fresh-deploy seeding, and onboarding new contributors.

## Files

| File | Collection | Docs |
|---|---|---|
| `products.json` | `products` | 98 |
| `makers.json`   | `makers`   | 19 |
| `reviews.json`  | `reviews`  | 7  |

> No `categories.json` — Crafters Market uses a hardcoded category enum (`metal · wood · resin · 3d · leather · mixed`), not a Mongo collection.

## Sanitization

These files are **post-sanitization** — sensitive fields are stripped by
`sanitize.py` before commit. Stripped keys include:

- Authentication: `password_hash`, `password_reset_*`, `password_set_at`, `last_password_change_at`, magic tokens, session ids
- PII: `email`, `contact_email`, `phone`, address fields
- Payment: `stripe_customer_id`, `stripe_account_id`, bank fields, `tax_id`, `ssn`
- Mongo internal: `_id`

## How to refresh

```bash
# 1. Re-export from Mongo
URL="$(grep ^MONGO_URL /app/backend/.env | cut -d'=' -f2- | tr -d '"')"
DB="$(grep ^DB_NAME   /app/backend/.env | cut -d'=' -f2- | tr -d '"')"
mongoexport --uri="$URL/$DB" --collection=products --out=/app/database/seeds/products.json --jsonArray --pretty
mongoexport --uri="$URL/$DB" --collection=makers   --out=/app/database/seeds/makers.json   --jsonArray --pretty
mongoexport --uri="$URL/$DB" --collection=reviews  --out=/app/database/seeds/reviews.json  --jsonArray --pretty

# 2. Strip sensitive fields (idempotent, safe to re-run)
python3 /app/database/seeds/sanitize.py

# 3. Eyeball the diff, then commit via Emergent's "Save to GitHub" button.
```

## How to load into a fresh database

```python
# Run inside /app/backend
import asyncio, json
from core import db
from pathlib import Path

async def seed():
    for name in ("products", "makers", "reviews"):
        docs = json.loads(Path(f"/app/database/seeds/{name}.json").read_text())
        if not docs: continue
        await db[name].delete_many({"slug": {"$in": [d.get("slug") for d in docs if d.get("slug")]}})
        await db[name].insert_many(docs)
        print(f"  ✓ {name}: {len(docs)} docs")

asyncio.run(seed())
```

## ⚠ Source

These exports come from the **preview** environment (`mongodb://localhost:27017/test_database`),
not production. Production data on `craftersmarket.org` is a separate managed
MongoDB — contact Emergent Support if you need a production backup.
