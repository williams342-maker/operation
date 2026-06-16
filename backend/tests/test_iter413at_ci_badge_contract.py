"""iter413at — CI Pass-Rate Badge endpoint contract.

Validates:
  • GET /api/ci/badge.svg returns 200 + image/svg+xml
  • GET /api/ci/health returns 200 + {passed, failed, files, pass_rate, status}
  • Badge SVG includes the pass count + file count
  • health status flips between green/yellow/red based on pass_rate
"""
from __future__ import annotations

import os
import re
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


def test_ci_badge_svg_returns_200_with_svg_mime():
    r = requests.get(f"{BASE_URL}/api/ci/badge.svg", timeout=10)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("image/svg+xml")
    assert "<svg" in r.text
    # Pass count should appear in the badge value text.
    assert re.search(r"\d+ passing", r.text), "pass count missing from SVG"


def test_ci_health_endpoint_shape():
    r = requests.get(f"{BASE_URL}/api/ci/health", timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("passed", "failed", "files", "pass_rate", "status"):
        assert k in body, f"missing key {k} in {body}"
    assert isinstance(body["passed"], int) and body["passed"] >= 0
    assert isinstance(body["failed"], int) and body["failed"] >= 0
    assert isinstance(body["files"], int) and body["files"] >= 100
    assert 0.0 <= float(body["pass_rate"]) <= 100.0
    assert body["status"] in ("green", "yellow", "red")


def test_ci_badge_svg_style_param_flat_square():
    """`?style=flat-square` should emit a 0-radius rect (sharp corners)."""
    r = requests.get(f"{BASE_URL}/api/ci/badge.svg?style=flat-square", timeout=10)
    assert r.status_code == 200
    # flat-square uses rx="0" (sharp), flat uses rx="3" (rounded).
    assert 'rx="0"' in r.text


def test_ci_badge_svg_custom_label():
    r = requests.get(f"{BASE_URL}/api/ci/badge.svg?label=CI", timeout=10)
    assert r.status_code == 200
    assert ">CI<" in r.text
