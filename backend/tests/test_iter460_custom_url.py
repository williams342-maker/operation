"""iter460 — Custom Store URL / Vanity URL (P1) regression tests.

Covers the review-request bullets:
  * GET /api/maker/custom-url (maker JWT) + 401/403 without auth
  * GET /api/maker/custom-url/check/{candidate} — format, reserved words,
    availability, another maker's vanity, another maker's previous slug
  * POST /api/maker/custom-url — auto-lowercase, resolve via vanity,
    change history (previous_slugs), empty-string clears
  * Uniqueness collisions (409) against another maker's live vanity,
    previous_slugs entry, or a canonical internal slug
  * Admin endpoints — GET state+history, POST set / null-reset,
    invalid format 400, no-auth 401/403
  * GET /api/sitemap.xml uses vanity, not internal slug
  * GET /api/makers list rows include custom_url field

Fixture kept AS-IS: iron-and-oak has custom_url='ironoak2' with
previous_slugs=['ironoak', 'ugogold-test']. Do NOT clobber. Any state
we set on kiln-and-clay or loom-and-thread gets torn down at the end.
"""
import os
import sys
import pytest
import requests
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip("/")


# ---- token helpers (module-scope so we mint once) ----

def _maker_token(slug: str, email: str) -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(slug, email)


def _admin_token() -> str:
    from maker_auth import issue_admin_magic_token
    magic = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify",
                      json={"token": magic}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


IRON_TOK = _maker_token("iron-and-oak", "iron-and-oak@craftersmarket.org")
KILN_TOK = _maker_token("kiln-and-clay", "kiln-and-clay@craftersmarket.org")
LOOM_TOK = _maker_token("loom-and-thread", "loom-and-thread@craftersmarket.org")
ADMIN_TOK = _admin_token()


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ---- teardown: reset any state we set on kiln/loom ----

@pytest.fixture(scope="module", autouse=True)
def _teardown():
    yield
    # Direct sync mongo cleanup — no asyncio needed. Preserves iron-and-oak.
    import os as _os
    from pymongo import MongoClient
    mongo_url = _os.environ.get("MONGO_URL")
    db_name = _os.environ.get("DB_NAME")
    client = MongoClient(mongo_url)
    db = client[db_name]
    for slug in ("kiln-and-clay", "loom-and-thread"):
        db.makers.update_one(
            {"slug": slug},
            {"$unset": {
                "custom_url": "",
                "previous_slugs": "",
                "custom_url_changed_at": "",
            }},
        )
    client.close()


# =============================================================
# 1. Maker GET /api/maker/custom-url
# =============================================================

class TestMakerGet:
    def test_get_state_returns_current(self):
        r = requests.get(f"{BASE_URL}/api/maker/custom-url", headers=_h(IRON_TOK), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["custom_url"] == "ironoak2"
        assert "ironoak" in (body.get("previous_slugs") or [])
        assert body.get("custom_url_changed_at")
        assert isinstance(body.get("rules"), str)

    def test_get_no_auth_denied(self):
        r = requests.get(f"{BASE_URL}/api/maker/custom-url", timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# =============================================================
# 2. Availability checker
# =============================================================

class TestAvailability:
    def test_bad_format_rejected(self):
        r = requests.get(f"{BASE_URL}/api/maker/custom-url/check/Bad!Name",
                         headers=_h(KILN_TOK), timeout=30)
        assert r.status_code == 200
        assert r.json()["available"] is False

    @pytest.mark.parametrize("word", ["admin", "api", "cart", "state"])
    def test_reserved_words_rejected(self, word):
        r = requests.get(f"{BASE_URL}/api/maker/custom-url/check/{word}",
                         headers=_h(KILN_TOK), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["available"] is False, f"{word} should be reserved"

    def test_fresh_unique_available(self):
        # Use a distinctive candidate unlikely to collide.
        r = requests.get(f"{BASE_URL}/api/maker/custom-url/check/testvanity-fresh-9x",
                         headers=_h(KILN_TOK), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is True, body

    def test_other_makers_live_vanity_rejected(self):
        # iron-and-oak owns ironoak2
        r = requests.get(f"{BASE_URL}/api/maker/custom-url/check/ironoak2",
                         headers=_h(KILN_TOK), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is False
        assert "taken" in (body.get("reason") or "").lower()

    def test_other_makers_previous_slug_rejected(self):
        # 'ironoak' is in iron-and-oak.previous_slugs
        r = requests.get(f"{BASE_URL}/api/maker/custom-url/check/ironoak",
                         headers=_h(KILN_TOK), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is False


# =============================================================
# 3. Claim + resolve + history on change + empty-string clear
# =============================================================

class TestClaimHistory:
    def test_full_lifecycle(self):
        # Claim uppercase → auto-lowercased
        r = requests.post(f"{BASE_URL}/api/maker/custom-url",
                          json={"custom_url": "TestVanity1"},
                          headers=_h(KILN_TOK), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["custom_url"] == "testvanity1"

        # Resolve via new vanity → kiln-and-clay
        r = requests.get(f"{BASE_URL}/api/makers/testvanity1", timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["slug"] == "kiln-and-clay"
        assert body.get("custom_url") == "testvanity1"

        # Change to testvanity2 → previous_slugs pushes testvanity1
        r = requests.post(f"{BASE_URL}/api/maker/custom-url",
                          json={"custom_url": "testvanity2"},
                          headers=_h(KILN_TOK), timeout=30)
        assert r.status_code == 200, r.text
        state = r.json()
        assert state["custom_url"] == "testvanity2"
        assert "testvanity1" in (state.get("previous_slugs") or [])

        # Old vanity still resolves the maker
        r = requests.get(f"{BASE_URL}/api/makers/testvanity1", timeout=30)
        assert r.status_code == 200
        assert r.json()["slug"] == "kiln-and-clay"

        # Resolve endpoint reports matched_via=previous with canonical public_slug
        r = requests.get(f"{BASE_URL}/api/makers/resolve/testvanity1", timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body == {"slug": "kiln-and-clay",
                        "public_slug": "testvanity2",
                        "matched_via": "previous"}

        # Empty string clears → custom_url None, testvanity2 in previous_slugs
        r = requests.post(f"{BASE_URL}/api/maker/custom-url",
                          json={"custom_url": ""},
                          headers=_h(KILN_TOK), timeout=30)
        assert r.status_code == 200, r.text
        state = r.json()
        assert state["custom_url"] is None
        assert "testvanity2" in (state.get("previous_slugs") or [])


# =============================================================
# 4. Uniqueness collisions
# =============================================================

class TestCollisions:
    def test_loom_cannot_claim_kilns_previous(self):
        # After previous test, kiln's previous_slugs contains testvanity1,2
        r = requests.post(f"{BASE_URL}/api/maker/custom-url",
                          json={"custom_url": "testvanity1"},
                          headers=_h(LOOM_TOK), timeout=30)
        assert r.status_code == 409, r.text
        r = requests.post(f"{BASE_URL}/api/maker/custom-url",
                          json={"custom_url": "testvanity2"},
                          headers=_h(LOOM_TOK), timeout=30)
        assert r.status_code == 409, r.text

    def test_loom_cannot_claim_existing_internal_slug(self):
        r = requests.post(f"{BASE_URL}/api/maker/custom-url",
                          json={"custom_url": "iron-and-oak"},
                          headers=_h(LOOM_TOK), timeout=30)
        assert r.status_code == 409, r.text


# =============================================================
# 5. Admin endpoints
# =============================================================

class TestAdmin:
    def test_admin_get_state_and_history(self):
        r = requests.get(
            f"{BASE_URL}/api/admin/makers/iron-and-oak/custom-url",
            headers=_h(ADMIN_TOK), timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["slug"] == "iron-and-oak"
        assert body["custom_url"] == "ironoak2"
        assert "ironoak" in (body.get("previous_slugs") or [])

    def test_admin_requires_auth(self):
        r = requests.get(
            f"{BASE_URL}/api/admin/makers/iron-and-oak/custom-url", timeout=30)
        assert r.status_code in (401, 403)
        r = requests.post(
            f"{BASE_URL}/api/admin/makers/iron-and-oak/custom-url",
            json={"custom_url": "hax"}, timeout=30)
        assert r.status_code in (401, 403)

    def test_admin_set_then_reset_roundtrip(self):
        # Set on loom-and-thread
        r = requests.post(
            f"{BASE_URL}/api/admin/makers/loom-and-thread/custom-url",
            json={"custom_url": "admintest-x"},
            headers=_h(ADMIN_TOK), timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["custom_url"] == "admintest-x"

        # Verify resolve
        r = requests.get(f"{BASE_URL}/api/makers/admintest-x", timeout=30)
        assert r.status_code == 200
        assert r.json()["slug"] == "loom-and-thread"

        # Reset via null → previous_slugs picks up admintest-x
        r = requests.post(
            f"{BASE_URL}/api/admin/makers/loom-and-thread/custom-url",
            json={"custom_url": None},
            headers=_h(ADMIN_TOK), timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["custom_url"] in (None, "")
        assert "admintest-x" in (body.get("previous_slugs") or [])

    def test_admin_invalid_format_400(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/makers/loom-and-thread/custom-url",
            json={"custom_url": "Bad!Name"},
            headers=_h(ADMIN_TOK), timeout=30,
        )
        assert r.status_code == 400, r.text


# =============================================================
# 6. Sitemap uses vanity
# =============================================================

class TestSitemap:
    def test_sitemap_uses_vanity_for_iron_and_oak(self):
        r = requests.get(f"{BASE_URL}/api/sitemap.xml", timeout=60)
        assert r.status_code == 200
        body = r.text
        assert "/makers/ironoak2" in body, "vanity URL missing from sitemap"
        # Internal slug URL for iron-and-oak MUST NOT appear as a maker URL.
        assert "/makers/iron-and-oak<" not in body, "internal slug leaked into sitemap"


# =============================================================
# 7. Makers list surfaces custom_url
# =============================================================

class TestMakersList:
    def test_list_rows_include_custom_url(self):
        r = requests.get(f"{BASE_URL}/api/makers", timeout=30)
        assert r.status_code == 200
        rows = r.json()
        iron = next((m for m in rows if m.get("slug") == "iron-and-oak"), None)
        assert iron is not None, "iron-and-oak missing from /api/makers"
        assert iron.get("custom_url") == "ironoak2"


# =============================================================
# 8. Regression — no-vanity maker still resolves normally
# =============================================================

class TestRegression:
    def test_loom_without_vanity_loads(self):
        # After teardown-in-progress state, loom-and-thread has no custom_url
        # Force clear via admin to be safe.
        requests.post(
            f"{BASE_URL}/api/admin/makers/loom-and-thread/custom-url",
            json={"custom_url": None},
            headers=_h(ADMIN_TOK), timeout=30,
        )
        r = requests.get(f"{BASE_URL}/api/makers/loom-and-thread", timeout=30)
        assert r.status_code == 200
        assert r.json()["slug"] == "loom-and-thread"

    def test_iron_and_oak_internal_slug_still_resolves(self):
        # Analytics keyed on internal slug — direct fetch must work.
        r = requests.get(f"{BASE_URL}/api/makers/iron-and-oak", timeout=30)
        assert r.status_code == 200
        assert r.json()["slug"] == "iron-and-oak"
