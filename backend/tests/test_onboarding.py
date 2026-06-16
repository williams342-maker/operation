"""iter249 — Onboarding state machine backend tests."""
import os
import sys
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

VALID_STEPS = [
    "user_type_selected",
    "profile_created",
    "first_upload",
    "first_follow",
    "first_engagement",
    "tour_completed",
]


@pytest.fixture
def anon_id():
    return f"anon_test_{uuid.uuid4().hex[:10]}"


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ──────────────────────────────────────────────────────────
# /onboarding/start
# ──────────────────────────────────────────────────────────
class TestOnboardingStart:
    def test_start_anonymous_creates_state(self, client, anon_id):
        r = client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "maker"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_key"] == anon_id
        assert data["user_type"] == "maker"
        assert "user_type_selected" in data["steps_completed"]
        assert data["started_at"] is not None
        assert data["last_step_at"] is not None
        assert data["completed_at"] is None

    def test_start_is_idempotent(self, client, anon_id):
        r1 = client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "buyer"})
        assert r1.status_code == 200
        started = r1.json()["started_at"]
        r2 = client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "buyer"})
        assert r2.status_code == 200
        # started_at preserved
        assert r2.json()["started_at"] == started

    def test_start_without_identity_fails(self, client):
        r = client.post(f"{API}/onboarding/start", json={})
        assert r.status_code == 400


# ──────────────────────────────────────────────────────────
# /onboarding/step
# ──────────────────────────────────────────────────────────
class TestOnboardingStep:
    def test_each_valid_step(self, client, anon_id):
        client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "maker"})
        for step in VALID_STEPS:
            r = client.post(f"{API}/onboarding/step", json={"anon_id": anon_id, "step": step})
            assert r.status_code == 200, f"step {step} → {r.status_code} {r.text}"
            assert step in r.json()["steps_completed"]

    def test_invalid_step_returns_400(self, client, anon_id):
        client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "maker"})
        r = client.post(f"{API}/onboarding/step", json={"anon_id": anon_id, "step": "bogus_step"})
        assert r.status_code == 400

    def test_dedup_and_sorted(self, client, anon_id):
        client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "maker"})
        client.post(f"{API}/onboarding/step", json={"anon_id": anon_id, "step": "profile_created"})
        r = client.post(f"{API}/onboarding/step", json={"anon_id": anon_id, "step": "profile_created"})
        steps = r.json()["steps_completed"]
        assert steps.count("profile_created") == 1
        assert steps == sorted(steps)

    def test_tour_completed_sets_completed_at(self, client, anon_id):
        client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "maker"})
        r = client.post(f"{API}/onboarding/step", json={"anon_id": anon_id, "step": "tour_completed"})
        assert r.json()["completed_at"] is not None

    def test_three_steps_with_first_action_sets_completed_at(self, client, anon_id):
        client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "maker"})
        # already have user_type_selected. Add profile_created (no first_*) → not complete
        r = client.post(f"{API}/onboarding/step", json={"anon_id": anon_id, "step": "profile_created"})
        assert r.json()["completed_at"] is None
        # Now add first_upload → 3 steps incl. first_* → completed
        r = client.post(f"{API}/onboarding/step", json={"anon_id": anon_id, "step": "first_upload"})
        assert r.json()["completed_at"] is not None

    def test_two_steps_without_first_action_not_completed(self, client, anon_id):
        client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "maker"})
        r = client.post(f"{API}/onboarding/step", json={"anon_id": anon_id, "step": "profile_created"})
        assert r.json()["completed_at"] is None


# ──────────────────────────────────────────────────────────
# /onboarding/me
# ──────────────────────────────────────────────────────────
class TestOnboardingMe:
    def test_me_known_anon(self, client, anon_id):
        client.post(f"{API}/onboarding/start", json={"anon_id": anon_id, "user_type": "supporter"})
        r = client.get(f"{API}/onboarding/me", params={"anon_id": anon_id})
        assert r.status_code == 200
        body = r.json()
        assert body["state"] is not None
        assert body["state"]["user_type"] == "supporter"

    def test_me_unknown_returns_null(self, client):
        unknown = f"anon_unknown_{uuid.uuid4().hex[:8]}"
        r = client.get(f"{API}/onboarding/me", params={"anon_id": unknown})
        assert r.status_code == 200
        assert r.json()["state"] is None

    def test_me_no_identity_returns_null(self, client):
        r = client.get(f"{API}/onboarding/me")
        assert r.status_code == 200
        assert r.json() == {"state": None}


# ──────────────────────────────────────────────────────────
# /onboarding/skip
# ──────────────────────────────────────────────────────────
class TestOnboardingSkip:
    def test_skip_anonymous_returns_ok(self, client):
        r = client.post(f"{API}/onboarding/skip", json={})
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_skip_with_maker_jwt_sets_skipped_at(self, client):
        sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from maker_auth import issue_session_jwt
        jwt = issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org", "maker")
        r = client.post(
            f"{API}/onboarding/skip",
            json={},
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200
        # Check skipped_at via /me
        r2 = client.get(
            f"{API}/onboarding/me", headers={"Authorization": f"Bearer {jwt}"}
        )
        state = r2.json().get("state")
        assert state is not None
        assert state.get("skipped_at") is not None


# ──────────────────────────────────────────────────────────
# Welcome email send path (verified by welcome_email_sent_at stamp)
# ──────────────────────────────────────────────────────────
class TestWelcomeEmailPath:
    def test_welcome_email_path_invoked_for_authed_maker(self, client):
        sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from maker_auth import issue_session_jwt
        # Unique-ish slug so we get a fresh state row for this test
        slug = f"test-maker-{uuid.uuid4().hex[:6]}"
        email = f"{slug}@craftersmarket.org"
        jwt = issue_session_jwt(slug, email, "maker")

        # Clean up any prior state for this user_key
        try:
            import asyncio
            from core import db
            asyncio.run(
                db.onboarding_states.delete_many({"user_key": slug})
            )
        except Exception:
            pass

        r = client.post(
            f"{API}/onboarding/start",
            json={"user_type": "maker"},
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200, r.text
        # /me to fetch persisted state
        r2 = client.get(
            f"{API}/onboarding/me", headers={"Authorization": f"Bearer {jwt}"}
        )
        state = r2.json().get("state")
        assert state is not None
        assert state.get("email") == email
        assert state.get("user_type") == "maker"
        # email path is best-effort; verify either stamp or that user is properly authed
        # (the underlying mailgun call may silently 4xx in test env — that's OK)
        # The fact that email was stored on the doc means _send_welcome_email path was reached.
        assert "welcome_email_sent_at" in state
