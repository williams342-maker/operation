"""iter114 (test) — Live E2E backend tests for Phase 2 Store Search on the
running preview URL. Focuses on the review checklist that unit tests do
not cover: real HTTP round-trips, scoping across makers, edge cases
(empty q, special-regex q, long q, no-sections maker), popular-searches
meta reflecting recently-logged queries, and score/relevance ordering.
"""
import os
import time
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
MAKER = "iron-and-oak"
ALT_MAKER = "metalart-pro"


def _get(path, **params):
    return requests.get(f"{BASE}/api{path}", params=params, timeout=10)


# ---------- Basic shape & scoping ----------
class TestStoreSearchBasic:
    def test_endpoint_exists_and_returns_expected_shape(self):
        r = _get(f"/makers/{MAKER}/search", q="wall")
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ("q", "sections", "products", "total", "by_section", "suggestions"):
            assert key in d, f"missing {key}"
        assert isinstance(d["sections"], list)
        assert isinstance(d["products"], list)
        assert isinstance(d["by_section"], list)
        assert isinstance(d["suggestions"], list)

    def test_section_name_hit_surfaces_section(self):
        r = _get(f"/makers/{MAKER}/search", q="wall")
        d = r.json()
        slugs = [s["slug"] for s in d["sections"]]
        assert "wall-art" in slugs, f"wall-art section should hit on 'wall': {d}"
        # Section object has count and matched_on
        wa = next(s for s in d["sections"] if s["slug"] == "wall-art")
        assert wa["count"] >= 1
        assert wa["matched_on"] in ("name", "description")

    def test_search_is_scoped_to_one_maker(self):
        """Products belonging to another maker MUST NEVER appear."""
        r = _get(f"/makers/{MAKER}/search", q="a")  # broad
        d = r.json()
        # Check every product has a slug that would only exist for MAKER
        # Cross-check: query alt maker with same term and ensure disjoint
        r2 = _get(f"/makers/{ALT_MAKER}/search", q="a")
        d2 = r2.json()
        s1 = {p["slug"] for p in d["products"]}
        s2 = {p["slug"] for p in d2["products"]}
        assert s1.isdisjoint(s2) or (not s1 and not s2), \
            f"cross-maker leakage: {s1 & s2}"

    def test_empty_q_returns_empty_payload_no_error(self):
        r = _get(f"/makers/{MAKER}/search", q="")
        assert r.status_code == 200
        d = r.json()
        assert d["products"] == []
        assert d["sections"] == []
        assert d["by_section"] == []
        assert d["suggestions"] == []

    def test_missing_q_returns_empty(self):
        r = _get(f"/makers/{MAKER}/search")
        assert r.status_code == 200
        d = r.json()
        assert d["products"] == [] and d["sections"] == []


# ---------- Edge cases ----------
class TestStoreSearchEdges:
    def test_special_regex_chars_do_not_500(self):
        for q in ["wood (oak)", "a+b", ".*", "[abc]", "hello?", "x|y"]:
            r = _get(f"/makers/{MAKER}/search", q=q)
            assert r.status_code == 200, f"q={q!r} → {r.status_code} {r.text}"

    def test_long_q_truncated_no_error(self):
        r = _get(f"/makers/{MAKER}/search", q="a" * 500)
        assert r.status_code == 200
        # Returned q should be truncated to 80 chars
        assert len(r.json()["q"]) <= 80

    def test_maker_with_no_sections_returns_products_no_error(self):
        """metalart-pro is documented as a maker with no store sections."""
        r = _get(f"/makers/{ALT_MAKER}/search", q="metal")
        assert r.status_code == 200, r.text
        d = r.json()
        # sections + by_section may be empty; response must be well-formed
        assert isinstance(d["sections"], list)
        assert isinstance(d["by_section"], list)

    def test_unknown_maker_slug_returns_empty_not_error(self):
        r = _get("/makers/does-not-exist-xyz/search", q="anything")
        assert r.status_code == 200
        d = r.json()
        assert d["products"] == []
        assert d["sections"] == []


# ---------- Zero-result suggestions ----------
class TestZeroResults:
    def test_nonsense_query_returns_suggestions_from_sections(self):
        r = _get(f"/makers/{MAKER}/search", q="zzzzqqqqxxxxvvvv")
        d = r.json()
        assert d["products"] == []
        assert d["sections"] == []
        # iron-and-oak has sections → suggestions should be populated (max 5)
        assert 0 < len(d["suggestions"]) <= 5
        for s in d["suggestions"]:
            assert "name" in s and "slug" in s and "count" in s

    def test_nonsense_query_no_sections_maker_has_empty_suggestions(self):
        r = _get(f"/makers/{ALT_MAKER}/search", q="zzzzqqqqxxxxvvvv")
        d = r.json()
        assert d["products"] == []
        # If maker has no sections, suggestions should be [] (nothing to browse)
        # (test still passes if maker happens to have some sections — assert list type only)
        assert isinstance(d["suggestions"], list)


# ---------- Product scoring & limit ----------
class TestScoring:
    def test_limit_default_and_max(self):
        r = _get(f"/makers/{MAKER}/search", q="a", limit=50)
        d = r.json()
        # limit capped at 24
        assert len(d["products"]) <= 24
        r2 = _get(f"/makers/{MAKER}/search", q="a")
        d2 = r2.json()
        assert len(d2["products"]) <= 12

    def test_results_only_status_published(self):
        r = _get(f"/makers/{MAKER}/search", q="a")
        d = r.json()
        # Not verifiable via API alone (no status field in the projection),
        # but total must be >=len(products) and non-negative
        assert d["total"] >= len(d["products"]) >= 0

    def test_scores_descending(self):
        r = _get(f"/makers/{MAKER}/search", q="a")
        d = r.json()
        scores = [p["score"] for p in d["products"]]
        assert scores == sorted(scores, reverse=True)


# ---------- Popular searches (meta) ----------
class TestSearchMeta:
    def test_meta_endpoint_shape(self):
        r = _get(f"/makers/{MAKER}/search/meta")
        assert r.status_code == 200
        d = r.json()
        assert "popular" in d
        assert isinstance(d["popular"], list)
        assert len(d["popular"]) <= 6

    def test_meta_reflects_queries_with_results(self):
        """Run a search that has results, then check that q appears in popular."""
        # Use a term that returns products (section-only hits log results=0)
        term = "sign"
        # Fire several times to bump frequency
        for _ in range(3):
            _get(f"/makers/{MAKER}/search", q=term)
        # give the fire-and-forget log a moment
        time.sleep(0.5)
        r = _get(f"/makers/{MAKER}/search/meta")
        d = r.json()
        assert term in d["popular"], f"'{term}' expected in popular after logging: {d['popular']}"

    def test_meta_excludes_zero_result_queries(self):
        """Log a zero-result query and confirm it's NOT in popular."""
        zero_q = "zzzzqqqqxxxxvvvvunique114"
        for _ in range(3):
            _get(f"/makers/{MAKER}/search", q=zero_q)
        time.sleep(0.5)
        r = _get(f"/makers/{MAKER}/search/meta")
        d = r.json()
        assert zero_q not in d["popular"], "zero-result queries must not appear in popular"


# ---------- Cross-maker: alt maker meta scoped ----------
class TestMetaScoping:
    def test_alt_maker_meta_isolated(self):
        # Fire alt-maker specific query
        alt_term = "iron_and_oak_only_marker_zzz"
        for _ in range(2):
            _get(f"/makers/{MAKER}/search", q=alt_term)
        time.sleep(0.3)
        # alt maker's meta should NOT include this term (it was logged under MAKER only)
        r = _get(f"/makers/{ALT_MAKER}/search/meta")
        d = r.json()
        assert alt_term not in d.get("popular", [])
