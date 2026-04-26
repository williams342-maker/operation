"""iter16 — Variants, Draft mode (publish/unpublish), .glb upload via R2."""
import os
import sys
import io
import uuid

import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_magic_token  # noqa: E402

def _read_frontend_url():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_url()).rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def maker_jwt():
    tok = issue_magic_token("iron-and-oak@craftersmarket.org")
    r = requests.post(f"{API}/maker/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def H(jwt):
    return {"Authorization": f"Bearer {jwt}"}


def Hj(jwt):
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


def _cleanup(slug):
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    async def _go():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await c[os.environ["DB_NAME"]].products.delete_one({"slug": slug})
        finally:
            c.close()
    asyncio.run(_go())


# Fake but technically valid-ish .glb header (12-byte glTF binary header).
def _tiny_glb_bytes() -> bytes:
    return b"glTF" + b"\x02\x00\x00\x00" + b"\x14\x00\x00\x00" + b"\x00" * 8


@pytest.fixture(scope="module")
def draft_product(maker_jwt):
    title = f"TEST_iter16 Variants Draft {uuid.uuid4().hex[:6]}"
    payload = {
        "title": title,
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 100.0,
        "description": "iter16 draft+variants test",
        "materials": ["Steel"],
        "in_stock": 5,
        "status": "draft",
        "variants": [
            {"label": "12in", "price_delta": 0, "in_stock": 5},
            {"label": "24in", "price_delta": 50, "in_stock": 3},
        ],
    }
    r = requests.post(f"{API}/maker/products", headers=Hj(maker_jwt), json=payload, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    yield body
    _cleanup(body["slug"])


# ---- 1. Create draft + variants ----
class TestCreateDraftVariants:
    def test_status_draft_and_two_variants_with_ids(self, draft_product):
        body = draft_product
        assert body["status"] == "draft"
        assert isinstance(body.get("variants"), list)
        assert len(body["variants"]) == 2
        ids = set()
        labels_by_id = {}
        for v in body["variants"]:
            assert v.get("id"), "variant id missing"
            assert v["label"] in ("12in", "24in")
            ids.add(v["id"])
            labels_by_id[v["id"]] = v["label"]
        assert len(ids) == 2  # auto-generated and unique
        # Verify price_delta + stock
        for v in body["variants"]:
            if v["label"] == "24in":
                assert float(v["price_delta"]) == 50.0
                assert int(v["in_stock"]) == 3
            else:
                assert float(v["price_delta"]) == 0.0
                assert int(v["in_stock"]) == 5


# ---- 2 & 3. Visibility ----
class TestDraftVisibility:
    def test_public_catalog_excludes_draft(self, draft_product):
        r = requests.get(f"{API}/products?maker=iron-and-oak", timeout=15)
        assert r.status_code == 200
        slugs = [p["slug"] for p in r.json()]
        assert draft_product["slug"] not in slugs, "Draft leaked into public catalog"

    def test_public_direct_fetch_returns_404(self, draft_product):
        # Drafts should not be reachable via public detail endpoint
        r = requests.get(f"{API}/products/{draft_product['slug']}", timeout=15)
        assert r.status_code in (404, 410), r.text

    def test_maker_list_includes_draft(self, draft_product, maker_jwt):
        r = requests.get(f"{API}/maker/products", headers=H(maker_jwt), timeout=15)
        assert r.status_code == 200
        slugs = [p["slug"] for p in r.json()]
        assert draft_product["slug"] in slugs


# ---- 4 & 5. Publish / Unpublish flips ----
class TestPublishUnpublish:
    def test_publish_then_unpublish(self, draft_product, maker_jwt):
        slug = draft_product["slug"]
        r = requests.post(f"{API}/maker/products/{slug}/publish",
                          headers=H(maker_jwt), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "published"

        # Now visible publicly
        r2 = requests.get(f"{API}/products?maker=iron-and-oak", timeout=15)
        assert slug in [p["slug"] for p in r2.json()]

        # Unpublish
        r = requests.post(f"{API}/maker/products/{slug}/unpublish",
                          headers=H(maker_jwt), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "draft"
        # Hidden again
        r2 = requests.get(f"{API}/products?maker=iron-and-oak", timeout=15)
        assert slug not in [p["slug"] for p in r2.json()]


# ---- 6 & 7. Cart quote variant rules ----
class TestCartQuoteVariants:
    def test_quote_requires_variant_when_product_has_variants(self, draft_product, maker_jwt):
        slug = draft_product["slug"]
        # Publish first so /cart/quote can see it
        requests.post(f"{API}/maker/products/{slug}/publish",
                      headers=H(maker_jwt), timeout=15)
        r = requests.post(
            f"{API}/cart/quote",
            json={"items": [{"product_id": slug, "quantity": 1}],
                  "origin_url": BASE},
            timeout=15,
        )
        assert r.status_code == 400, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "option" in detail or "variant" in detail or "choose" in detail, \
            f"Expected 'choose option' style error, got: {detail}"

    def test_quote_with_variant_applies_price_delta(self, draft_product, maker_jwt):
        slug = draft_product["slug"]
        # Reload to get the variant ids
        prod = requests.get(f"{API}/products/{slug}", timeout=15).json()
        vid_24 = next(v["id"] for v in prod["variants"] if v["label"] == "24in")
        r = requests.post(
            f"{API}/cart/quote",
            json={"items": [{"product_id": slug, "quantity": 1, "variant_id": vid_24}],
                  "origin_url": BASE},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Subtotal should be base 100 + delta 50 = 150
        sub = float(body.get("subtotal") or body.get("total") or 0)
        assert sub == 150.0, f"Expected subtotal 150, got {sub}: {body}"

    def test_quote_with_variant_zero_delta(self, draft_product, maker_jwt):
        slug = draft_product["slug"]
        prod = requests.get(f"{API}/products/{slug}", timeout=15).json()
        vid_12 = next(v["id"] for v in prod["variants"] if v["label"] == "12in")
        r = requests.post(
            f"{API}/cart/quote",
            json={"items": [{"product_id": slug, "quantity": 1, "variant_id": vid_12}],
                  "origin_url": BASE},
            timeout=15,
        )
        assert r.status_code == 200
        sub = float(r.json().get("subtotal") or 0)
        assert sub == 100.0, f"Expected 100 base price, got {sub}"


# ---- 8. .glb upload to R2 ----
class TestGlbUpload:
    def test_upload_returns_r2_url(self, maker_jwt):
        body = _tiny_glb_bytes()
        files = {"file": ("test.glb", io.BytesIO(body), "model/gltf-binary")}
        r = requests.post(f"{API}/maker/uploads/model",
                          headers=H(maker_jwt), files=files, timeout=30)
        assert r.status_code == 200, r.text
        out = r.json()
        assert "url" in out, out
        url = out["url"]
        # The bucket public CDN host
        assert ".r2.dev/" in url, f"URL should be on R2 CDN, got {url}"
        assert "/models/iron-and-oak/" in url, f"Wrong key prefix: {url}"
        assert url.endswith(".glb"), f"URL must end .glb, got {url}"
        assert int(out.get("size") or 0) == len(body)

        # Cleanup the uploaded object
        try:
            from r2_storage import _key_from_public_url, _client, BUCKET  # type: ignore
            client = _client()
            key = _key_from_public_url(url)
            if client and key:
                client.delete_object(Bucket=BUCKET, Key=key)
        except Exception:
            pass  # best-effort cleanup

    def test_upload_rejects_non_glb(self, maker_jwt):
        files = {"file": ("test.txt", io.BytesIO(b"not a model"), "text/plain")}
        r = requests.post(f"{API}/maker/uploads/model",
                          headers=H(maker_jwt), files=files, timeout=15)
        assert r.status_code == 400
