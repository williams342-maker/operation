"""iter379 — GSC-proven queries feed the AI Ad-Creative workshop.

Covers:
  • _build_copy_prompt includes the PROVEN SEARCH QUERIES block when
    seo_keywords are passed, and omits it when empty.
  • GenerateRequest accepts/validates seo_keywords (≤10).
"""
import os
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest

SUBJECT = {"slug": "flag-sign", "title": "Walnut Flag Sign",
           "type": "product", "price": 249}


def test_prompt_includes_proven_queries():
    from routers.ai_ad_creative import _build_copy_prompt
    p = _build_copy_prompt(SUBJECT, ["google_search"], "professional",
                           seo_keywords=["custom metal signs", "walnut flag"])
    assert "PROVEN SEARCH QUERIES" in p
    assert "custom metal signs" in p
    assert "walnut flag" in p
    assert "never keyword-stuff" in p


def test_prompt_omits_block_without_keywords():
    from routers.ai_ad_creative import _build_copy_prompt
    p = _build_copy_prompt(SUBJECT, ["google_search"], "professional")
    assert "PROVEN SEARCH QUERIES" not in p


def test_generate_request_accepts_seo_keywords():
    from routers.ai_ad_creative import GenerateRequest
    r = GenerateRequest(subject_type="product", subject_slug="flag-sign",
                        channels=["google_search"],
                        seo_keywords=["custom metal signs"])
    assert r.seo_keywords == ["custom metal signs"]
    # >10 keywords rejected by the field constraint
    with pytest.raises(Exception):
        GenerateRequest(subject_type="product", subject_slug="flag-sign",
                        channels=["google_search"],
                        seo_keywords=[f"kw{i}" for i in range(11)])
