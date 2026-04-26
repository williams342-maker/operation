# Cloudflare R2 — Custom Domain Setup (`cdn.craftersmarket.org`)

The R2 bucket currently serves images from
`https://pub-96d13eb6b15840a98236f6c1053262c3.r2.dev`. This guide walks you
through swapping that for `https://cdn.craftersmarket.org` — better for SEO,
brand polish, and to remove Cloudflare's "this is a dev URL" warnings.

⏱ Time: ~5 minutes (Cloudflare side) + ~5 minutes for DNS to propagate.

---

## Step 1 — In Cloudflare R2 dashboard

1. Open https://dash.cloudflare.com → **R2** → click bucket **`craftersmarket-assets`**.
2. Go to the **Settings** tab.
3. Scroll to **Custom Domains** → click **Connect Domain**.
4. Enter `cdn.craftersmarket.org` → **Continue**.
5. Cloudflare will:
   - Create the CNAME automatically if `craftersmarket.org` is on a Cloudflare-managed zone.
   - Otherwise show you a target like `cdn.<account-id>.r2.cloudflarestorage.com` — copy that and add a CNAME at your DNS provider:
     ```
     Type:  CNAME
     Name:  cdn
     Value: cdn.<account-id>.r2.cloudflarestorage.com
     TTL:   Auto
     ```
6. Once "Connected · ✓ Active" shows up (~2-5 min), copy the new URL: `https://cdn.craftersmarket.org`.

## Step 2 — Tell the backend to use the new domain

Edit `/app/backend/.env`:

```bash
# replace this line:
R2_PUBLIC_URL=https://pub-96d13eb6b15840a98236f6c1053262c3.r2.dev
# with:
R2_PUBLIC_URL=https://cdn.craftersmarket.org
```

Then restart the backend (hot reload only catches code changes, not env):
```bash
sudo supervisorctl restart backend
```

## Step 3 — Migrate existing URLs in the database

Existing products still point at the old `pub-…r2.dev` host. Run this one-shot
migration:

```bash
cd /app/backend
python -m scripts.swap_r2_host \
  --old https://pub-96d13eb6b15840a98236f6c1053262c3.r2.dev \
  --new https://cdn.craftersmarket.org
```

It walks every `db.products.images[]` and `model_url` and rewrites the host,
keeping the path/key the same. Idempotent — safe to run twice.

## Step 4 — (Optional) Sanity check

```bash
curl -I https://cdn.craftersmarket.org/products/iron-and-oak/test.png
# Expect: HTTP/2 200 · Content-Type: image/png · Cache-Control: public, max-age=31536000, immutable
```

That's it — every new upload from `POST /api/maker/products` and
`POST /api/maker/uploads/model` will now serve from `cdn.craftersmarket.org`
automatically (the URL is built from `R2_PUBLIC_URL`).

---

## Rollback

If anything goes wrong, revert `R2_PUBLIC_URL` to the old `pub-…` URL and
restart the backend. Re-run `swap_r2_host.py` in reverse to roll back DB URLs.
