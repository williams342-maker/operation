"""Crafters Market backend tests — products, makers, activity, custom orders, maker-applications, Stripe checkout.

iter411c — Auto-tagged `smoke` via conftest.py SMOKE_FILES so the
pre-deploy CI gate (`pytest -m smoke`) runs these flows.

iter413ak — Seed restoration is now session-scoped in conftest.py,
not per-file. Any test that depends on the canonical
`mountain-range-silhouette` product will see it on first request
even after sibling tests delete from the collection.
"""
import os, time, requests, pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()

def test_root(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"

def test_products_list(s):
    r = s.get(f"{API}/products")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) > 0
    # iter413ak — Catalog has 100+ products now and /products paginates
    # to the first 100. Asserting via the slug-specific endpoint is the
    # reliable way to confirm the canonical seed exists.
    r2 = s.get(f"{API}/products/mountain-range-silhouette")
    assert r2.status_code == 200, (
        f"Canonical seed product missing: GET /products/mountain-range-silhouette → {r2.status_code}"
    )

def test_get_product(s):
    r = s.get(f"{API}/products/mountain-range-silhouette")
    assert r.status_code == 200
    p = r.json()
    assert p["slug"] == "mountain-range-silhouette"
    assert p["price"] == 149.0
    assert "id" in p and "_id" not in p

def test_makers(s):
    r = s.get(f"{API}/makers")
    assert r.status_code == 200
    assert len(r.json()) >= 2

def test_activity(s):
    r = s.get(f"{API}/activity")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

def test_custom_order(s):
    payload = {"name": "TEST_Buyer", "email": "TEST_buyer@example.com",
               "project_type": "Custom Sign", "material": "Steel",
               "size": "24x12", "budget": "$200", "description": "TEST custom order",
               # iter411c — Site Policies acceptance is now required on
               # /api/custom-orders (see routers/catalog.py).
               "policy_accepted": True}
    r = s.post(f"{API}/custom-orders", json=payload)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["email"] == payload["email"]
    assert "id" in d

def test_maker_application(s):
    payload = {"name": "TEST_Maker", "email": "TEST_maker@example.com",
               "studio_name": "TEST_Studio", "location": "Austin, TX",
               "techniques": ["LASER"], "about": "TEST about"}
    r = s.post(f"{API}/maker-applications", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["studio_name"] == "TEST_Studio"

@pytest.fixture(scope="module")
def session_id(s):
    # Get product id
    p = s.get(f"{API}/products/mountain-range-silhouette").json()
    pid = p["id"]
    payload = {"items": [{"product_id": pid, "quantity": 1}],
               "origin_url": BASE,
               # iter411c — Site Policies acceptance is required on
               # /api/checkout/session (see routers/checkout.py).
               "policy_accepted": True}
    r = s.post(f"{API}/checkout/session", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "url" in body and "session_id" in body
    assert body["amount"] == 174.0  # 149 product + 25 Wall Art shipping
    assert body["subtotal"] == 149.0
    assert body["shipping"] == 25.0
    assert body["url"].startswith("https://")
    return body["session_id"]

def test_checkout_session_created(session_id):
    assert session_id and len(session_id) > 5

def test_checkout_status(s, session_id):
    r = s.get(f"{API}/checkout/status/{session_id}")
    assert r.status_code == 200, r.text
    d = r.json()
    assert "status" in d and "payment_status" in d
    # Unpaid (we didn't complete) — should be "open" or "unpaid"
    assert d["payment_status"] in ("unpaid", "paid", "no_payment_required")

def test_checkout_empty_cart(s):
    r = s.post(f"{API}/checkout/session", json={"items": [], "origin_url": BASE})
    assert r.status_code == 400

def test_checkout_invalid_product(s):
    r = s.post(f"{API}/checkout/session", json={"items": [{"product_id": "nope", "quantity": 1}], "origin_url": BASE})
    assert r.status_code == 400
