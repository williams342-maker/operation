"""Tests for iter137 maker-authored journal feature.

Coverage:
- GET /api/blog returns >=9 posts (3 originals + 6 new seeds)
- POST /api/maker/journal validation (title/excerpt/body length, cover, body cap, auth)
- POST sets created_by_maker + author
- GET /api/maker/journal/mine returns own posts only
- DELETE /api/maker/journal/{slug} for own / 404 for seed/other-maker
- Slug uniqueness (slug, slug-2, slug-3)
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

from maker_auth import issue_session_jwt  # noqa: E402

MAKER_SLUG = "iron-and-oak"
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
OTHER_SLUG = "metalart-pro"
OTHER_EMAIL = "metalart-pro@craftersmarket.org"


@pytest.fixture(scope="session")
def maker_token():
    return issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, role="maker")


@pytest.fixture(scope="session")
def other_maker_token():
    return issue_session_jwt(OTHER_SLUG, OTHER_EMAIL, role="maker")


@pytest.fixture
def maker_headers(maker_token):
    return {"Authorization": f"Bearer {maker_token}", "Content-Type": "application/json"}


@pytest.fixture
def other_headers(other_maker_token):
    return {"Authorization": f"Bearer {other_maker_token}", "Content-Type": "application/json"}


def _valid_payload(suffix=""):
    uniq = uuid.uuid4().hex[:8]
    return {
        "title": f"TEST_Post About Hand Tools {uniq}{suffix}",
        "excerpt": "A thoughtful preview about why we love hand tools in our workshop process today.",
        "body": (
            "This is a test body that needs to be at least 100 characters long "
            "to satisfy the validation. We talk about chisels, saws, planes, and "
            "the joy of slow craft work over fast machines."
        ),
    }


def _cleanup(headers):
    """Delete all TEST_ posts we created so re-runs are idempotent."""
    r = requests.get(f"{BASE_URL}/api/maker/journal/mine", headers=headers, timeout=20)
    if r.status_code == 200:
        for p in r.json():
            if p.get("title", "").startswith("TEST_"):
                requests.delete(
                    f"{BASE_URL}/api/maker/journal/{p['slug']}", headers=headers, timeout=20
                )


# ---------------- public blog feed ----------------
class TestBlogFeed:
    def test_blog_returns_at_least_9_posts(self):
        r = requests.get(f"{BASE_URL}/api/blog", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 9, f"Expected ≥9 blog posts, got {len(data)}"

    def test_blog_includes_new_seed_titles(self):
        r = requests.get(f"{BASE_URL}/api/blog", timeout=30)
        assert r.status_code == 200
        titles = [p.get("title", "") for p in r.json()]
        expected = [
            "Buying Handmade 101",
            "Outdoor Finish Survival Guide",
        ]
        for t in expected:
            assert any(t in title for title in titles), f"Missing seed title containing: {t}"


# ---------------- auth ----------------
class TestAuth:
    def test_post_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/maker/journal", json=_valid_payload(), timeout=20)
        assert r.status_code == 401


# ---------------- validation ----------------
class TestValidation:
    def test_title_too_short(self, maker_headers):
        p = _valid_payload(); p["title"] = "Hi"
        r = requests.post(f"{BASE_URL}/api/maker/journal", json=p, headers=maker_headers, timeout=20)
        assert r.status_code == 422

    def test_excerpt_too_short(self, maker_headers):
        p = _valid_payload(); p["excerpt"] = "too short"
        r = requests.post(f"{BASE_URL}/api/maker/journal", json=p, headers=maker_headers, timeout=20)
        assert r.status_code == 422

    def test_body_too_short(self, maker_headers):
        p = _valid_payload(); p["body"] = "too short body"
        r = requests.post(f"{BASE_URL}/api/maker/journal", json=p, headers=maker_headers, timeout=20)
        assert r.status_code == 422

    def test_cover_invalid_scheme(self, maker_headers):
        p = _valid_payload(); p["cover"] = "ftp://example.com/cover.jpg"
        r = requests.post(f"{BASE_URL}/api/maker/journal", json=p, headers=maker_headers, timeout=20)
        assert r.status_code == 422

    def test_body_too_long(self, maker_headers):
        p = _valid_payload(); p["body"] = "x" * 50_001
        r = requests.post(f"{BASE_URL}/api/maker/journal", json=p, headers=maker_headers, timeout=20)
        assert r.status_code == 413


# ---------------- create + persistence ----------------
class TestCreatePersist:
    def test_create_and_appears_in_blog_and_mine(self, maker_headers):
        p = _valid_payload()
        r = requests.post(f"{BASE_URL}/api/maker/journal", json=p, headers=maker_headers, timeout=20)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["title"] == p["title"]
        assert doc["created_by_maker"] == MAKER_SLUG
        # author should be the maker name (not slug)
        assert isinstance(doc.get("author"), str) and len(doc["author"]) > 0
        assert "_id" not in doc
        slug = doc["slug"]

        # Appears in public blog
        rb = requests.get(f"{BASE_URL}/api/blog", timeout=30)
        assert rb.status_code == 200
        slugs = [x.get("slug") for x in rb.json()]
        assert slug in slugs

        # Appears in /mine
        rm = requests.get(f"{BASE_URL}/api/maker/journal/mine", headers=maker_headers, timeout=20)
        assert rm.status_code == 200
        my_slugs = [x.get("slug") for x in rm.json()]
        assert slug in my_slugs

        # Cleanup
        rd = requests.delete(f"{BASE_URL}/api/maker/journal/{slug}", headers=maker_headers, timeout=20)
        assert rd.status_code == 200

    def test_mine_returns_only_own(self, maker_headers):
        # Post owned by iron-and-oak
        p = _valid_payload(suffix="-mineonly")
        r = requests.post(f"{BASE_URL}/api/maker/journal", json=p, headers=maker_headers, timeout=20)
        assert r.status_code == 200
        slug = r.json()["slug"]
        try:
            rm = requests.get(f"{BASE_URL}/api/maker/journal/mine", headers=maker_headers, timeout=20)
            assert rm.status_code == 200
            for entry in rm.json():
                assert entry.get("created_by_maker") == MAKER_SLUG
            # No seed posts (they have no created_by_maker)
            assert all(e.get("created_by_maker") for e in rm.json())
        finally:
            requests.delete(f"{BASE_URL}/api/maker/journal/{slug}", headers=maker_headers, timeout=20)


# ---------------- delete ----------------
class TestDelete:
    def test_delete_seed_post_404(self, maker_headers):
        # Pick a seed slug that should exist (no created_by_maker)
        rb = requests.get(f"{BASE_URL}/api/blog", timeout=30).json()
        seed_slugs = [p["slug"] for p in rb if not p.get("created_by_maker")]
        assert seed_slugs, "No seed posts found"
        target = seed_slugs[0]
        r = requests.delete(f"{BASE_URL}/api/maker/journal/{target}", headers=maker_headers, timeout=20)
        assert r.status_code == 404

    def test_delete_other_makers_post_404(self, maker_headers, other_headers):
        # Other maker posts
        p = _valid_payload(suffix="-otherown")
        r = requests.post(f"{BASE_URL}/api/maker/journal", json=p, headers=other_headers, timeout=20)
        assert r.status_code == 200
        slug = r.json()["slug"]
        try:
            # iron-and-oak attempts to delete metalart-pro's post
            rd = requests.delete(
                f"{BASE_URL}/api/maker/journal/{slug}", headers=maker_headers, timeout=20
            )
            assert rd.status_code == 404
        finally:
            requests.delete(f"{BASE_URL}/api/maker/journal/{slug}", headers=other_headers, timeout=20)


# ---------------- slug uniqueness ----------------
class TestSlugUniqueness:
    def test_collision_appends_suffix(self, maker_headers):
        unique_title = f"TEST_SlugCollision {uuid.uuid4().hex[:6]}"
        created_slugs = []
        try:
            for _ in range(3):
                p = _valid_payload()
                p["title"] = unique_title
                r = requests.post(
                    f"{BASE_URL}/api/maker/journal", json=p, headers=maker_headers, timeout=20
                )
                assert r.status_code == 200, r.text
                created_slugs.append(r.json()["slug"])
            base = created_slugs[0]
            assert created_slugs[1] == f"{base}-2"
            assert created_slugs[2] == f"{base}-3"
        finally:
            for s in created_slugs:
                requests.delete(
                    f"{BASE_URL}/api/maker/journal/{s}", headers=maker_headers, timeout=20
                )
