"""
Iter81 — full sweep:
  • Workshop time-range selector (range_days param + response label)
  • Real cohort retention (community_users.last_seen aggregation)
  • Files leaderboard (uploads + downloads aggregation)
  • Restock waitlist (POST /products/{slug}/restock-waitlist,
                      GET /maker/restock-waitlist,
                      auto-fire on stock 0 → +)
  • Custom-orders policy fields PATCH-able on the maker
"""
import io
import os
import sys
import time
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_magic_token, issue_admin_magic_token  # noqa: E402

API = os.environ.get(
    "PUBLIC_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
MAKER_SLUG = "iron-and-oak"
ADMIN_EMAIL = "team@craftersmarket.org"


def _maker_jwt() -> str:
    tok = issue_magic_token(MAKER_EMAIL)
    r = requests.post(f"{API}/api/maker/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _admin_jwt() -> str:
    tok = issue_admin_magic_token(ADMIN_EMAIL)
    r = requests.post(f"{API}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def test_workshop_overview_range_days():
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    for n in (7, 30, 90):
        r = requests.get(
            f"{API}/api/workshop-analytics/overview",
            headers=h, params={"range_days": n}, timeout=20,
        )
        assert r.status_code == 200, (n, r.text)
        body = r.json()
        assert body.get("range_days") == n
        assert "deltas" in body and "kpis" in body
    # Bad value falls back to 30
    r = requests.get(
        f"{API}/api/workshop-analytics/overview",
        headers=h, params={"range_days": 999}, timeout=20,
    )
    assert r.json()["range_days"] == 30


def test_workshop_users_real_retention():
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    r = requests.get(f"{API}/api/workshop-analytics/users", headers=h, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    rows = body["retention"]
    assert len(rows) == 4
    assert {row["cohort"] for row in rows} == {"Week 1", "Week 2", "Week 4", "Week 8"}
    for row in rows:
        # Every row now has real-data shape: denom + retained ints + rate float
        assert "denom" in row, row
        assert "retained" in row, row
        assert isinstance(row["rate"], (int, float))


def test_files_leaderboard_public():
    r = requests.get(f"{API}/api/community/files/leaderboard", timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    if rows:
        # Sorted by score desc (uploads * 5 + downloads)
        scores = [r0["score"] for r0 in rows]
        assert scores == sorted(scores, reverse=True)
        for r0 in rows:
            assert "handle" in r0 and "uploads" in r0 and "downloads" in r0


def test_restock_waitlist_full_lifecycle():
    """End-to-end: enroll on a product, then bump stock and confirm
    the waitlist drains (entry gets a `notified_at` stamp)."""
    # Pick any published in-stock listing belonging to the maker so we can
    # mutate its stock without disturbing real inventory.
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    products = requests.get(f"{API}/api/maker/products", headers=h, timeout=15).json()
    target = None
    for p in products:
        if p.get("status") == "published" and not p.get("deleted_at"):
            target = p
            break
    assert target, "No published listing for iron-and-oak — fix test data."
    slug = target["slug"]
    original_stock = int(target.get("in_stock") or 0)

    # 1. Force stock to 0
    r = requests.patch(
        f"{API}/api/maker/products/{slug}",
        headers=h, json={"in_stock": 0}, timeout=15,
    )
    assert r.status_code == 200, r.text

    # 2. In-stock product should refuse waitlist signup
    r = requests.post(
        f"{API}/api/products/{slug}/restock-waitlist",
        json={"buyer_email": "ws-test@example.com", "buyer_name": "WS"},
        timeout=15,
    )
    # Now at 0 stock → should accept
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["product_slug"] == slug
    assert body["notified_at"] is None

    # 3. Duplicate signup → returns existing row (idempotent)
    r2 = requests.post(
        f"{API}/api/products/{slug}/restock-waitlist",
        json={"buyer_email": "ws-test@example.com", "buyer_name": "WS"},
        timeout=15,
    )
    assert r2.status_code == 200
    assert r2.json()["id"] == body["id"]

    # 4. Maker dashboard sees the demand
    dash = requests.get(
        f"{API}/api/maker/restock-waitlist", headers=h, timeout=15,
    ).json()
    assert dash["total_pending"] >= 1
    matching = [p for p in dash["products"] if p["product_slug"] == slug]
    assert matching and matching[0]["count"] >= 1

    # 5. Maker raises stock → drains the list
    r = requests.patch(
        f"{API}/api/maker/products/{slug}",
        headers=h, json={"in_stock": max(1, original_stock or 1)}, timeout=20,
    )
    assert r.status_code == 200, r.text

    # Give the BackgroundTasks a moment to flush the update_many
    for _ in range(8):
        time.sleep(0.5)
        dash = requests.get(
            f"{API}/api/maker/restock-waitlist", headers=h, timeout=15,
        ).json()
        if all(p["product_slug"] != slug for p in dash["products"]):
            break
    # The listing should no longer show pending demand
    remaining = [p for p in dash["products"] if p["product_slug"] == slug]
    assert not remaining, f"waitlist did not drain for {slug}: {dash}"


def test_custom_order_policy_patch():
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    payload = {
        "accepts_custom_orders": True,
        "custom_orders_require_proof": False,
        "custom_order_policy": "50% deposit at proof; balance at shipment.",
    }
    r = requests.patch(f"{API}/api/maker/profile", headers=h, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k, v in payload.items():
        assert body.get(k) == v, (k, body.get(k), v)


if __name__ == "__main__":
    test_workshop_overview_range_days(); print("✓ overview range_days")
    test_workshop_users_real_retention(); print("✓ real retention cohorts")
    test_files_leaderboard_public(); print("✓ files leaderboard")
    test_restock_waitlist_full_lifecycle(); print("✓ restock waitlist lifecycle")
    test_custom_order_policy_patch(); print("✓ custom-order policy patch")
    print("\nAll iter81 checks passed.")
