"""iter219 regression — /api/community/showcase/recent now accepts `only_makers`.

Pre-fix the endpoint threw a 500 NameError because `only_makers` was
referenced inside the inner `_query()` builder but never declared as a
function parameter. This suite locks in the four query shapes the
frontend actually fires.
"""
import os
import pytest
import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://active-project-4.preview.emergentagent.com"
API = f"{API_URL.rstrip('/')}/api"


@pytest.mark.parametrize("qs,description", [
    ("", "default: no filters, public homepage strip"),
    ("?only_makers=true", "only_makers=true: workshop imagery mosaic"),
    ("?strict=true&maker_slug=iron-and-oak", "strict maker scope: profile page strip"),
    ("?product_slug=plasma-cut-sign&limit=8", "product-page recently-shared strip"),
])
def test_recent_showcase_returns_200(qs, description):
    r = requests.get(f"{API}/community/showcase/recent{qs}", timeout=10)
    assert r.status_code == 200, f"500 still: {description} — body: {r.text[:200]}"
    body = r.json()
    assert "items" in body
    assert "count" in body
    assert isinstance(body["items"], list)
    assert body["count"] == len(body["items"])


def test_only_makers_filters_to_maker_authored_posts():
    """When only_makers=true, every returned post must carry a non-null
    maker_slug. The default endpoint still includes buyer photos that
    don't have a maker_slug. Verifies the filter actually does something."""
    r = requests.get(f"{API}/community/showcase/recent?only_makers=true&limit=20", timeout=10)
    assert r.status_code == 200
    items = r.json().get("items", [])
    # Either it returns posts (all maker-authored) or returns an empty
    # list — both are valid; what's NOT valid is returning buyer-only
    # posts when only_makers=true.
    for item in items:
        assert item.get("maker_slug"), f"only_makers leaked non-maker post: {item.get('id')}"
