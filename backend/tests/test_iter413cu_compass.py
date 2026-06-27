"""iter413cu — Compass brand identity tests.

Coverage:
  - POST /api/help/chat self-identifies as Compass.
  - POST /api/help/chat preserves iter413cq video-not-supported behavior.
  - /brand/* asset HTTP 200 + content-type.
"""
import os
import re
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://active-project-4.preview.emergentagent.com"
).rstrip("/")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestCompassChatIdentity:
    """AI must self-identify as Compass."""

    def test_who_are_you_mentions_compass(self, session):
        r = session.post(
            f"{BASE_URL}/api/help/chat",
            json={"message": "who are you?", "user_role": "visitor"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reply" in data
        reply_lower = data["reply"].lower()
        assert "compass" in reply_lower, f"Reply should contain 'Compass': {data['reply']!r}"
        # Should NOT identify as legacy names.
        legacy_phrases = ["crafters market help", "help & support assistant"]
        for phrase in legacy_phrases:
            assert phrase not in reply_lower, f"Reply contains legacy phrase {phrase!r}: {data['reply']!r}"

    def test_video_supported_via_capabilities(self, session):
        """iter413cq capabilities injection must remain green post-rebrand.

        Rebaselined in iter413cz: iter413cx flipped listing-video uploads
        from disabled → enabled with the 60s/100MB/MP4-or-MOV constraints.
        The reply must now affirm support AND surface those constraints
        — proving the prompt is reading live CAPABILITIES, not stale text."""
        r = session.post(
            f"{BASE_URL}/api/help/chat",
            json={"message": "can I upload a video to my listing?", "user_role": "maker"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        reply_lower = data["reply"].lower()
        # Must affirm support.
        affirm_signals = ["yes", "supported", "you can"]
        assert any(s in reply_lower for s in affirm_signals), (
            f"Reply should affirm video upload support: {data['reply']!r}"
        )
        # Must surface the live constraints from CAPABILITIES.
        assert "60" in reply_lower or "sixty" in reply_lower, (
            f"Reply should mention 60-second duration cap: {data['reply']!r}"
        )
        assert "100" in reply_lower or "mp4" in reply_lower or "mov" in reply_lower, (
            f"Reply should mention 100MB cap or MP4/MOV formats: {data['reply']!r}"
        )


# /brand/* assets
class TestCompassBrandAssets:
    """All shipped brand-kit assets must serve correctly."""

    @pytest.mark.parametrize(
        "path,expected_ct_substr",
        [
            ("/brand/compass-master.svg", "svg"),
            ("/brand/compass-light.svg", "svg"),
            ("/brand/compass-dark.svg", "svg"),
            ("/brand/compass-brand.svg", "svg"),
            ("/brand/compass-avatar.svg", "svg"),
            ("/brand/compass-favicon.svg", "svg"),
            ("/brand/README.md", "text"),
        ],
    )
    def test_asset_served(self, session, path, expected_ct_substr):
        url = f"{BASE_URL}{path}"
        r = session.get(url, timeout=30)
        assert r.status_code == 200, f"{url} → {r.status_code}"
        ct = r.headers.get("content-type", "").lower()
        assert expected_ct_substr in ct, f"{url} content-type={ct!r}"
        assert len(r.content) > 0
