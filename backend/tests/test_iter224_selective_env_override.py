"""iter224 regression — selective env override (preview vs production).

Pre-fix bug: core.py used `load_dotenv(.env, override=True)` to defeat the
Emergent pod's `****`-masked placeholder env vars (so preview testing
worked with real Stripe/Mailgun keys). BUT in production deployment, the
same override clobbered real K8s-injected env vars (MONGO_URL etc.) with
.env values, causing the backend to crash and Cloudflare to surface a
520 error on craftersmarket.org/api/admin/auth/request.

Fix: switch to a SELECTIVE override — only replace OS env values that
contain the `****` placeholder mask. Real K8s vars (no `****`) are
preserved untouched.

This file guards both directions:
  - Dummy `****` placeholders MUST be overridden by .env (preview workflow).
  - Real-looking OS env values MUST be preserved (production safety).
"""
import importlib
import os
import sys
from pathlib import Path

import pytest


@pytest.fixture
def tmp_env(tmp_path, monkeypatch):
    """Write a temporary .env file and point a fresh selective loader at it."""
    env_file = tmp_path / ".env"
    yield env_file, monkeypatch


def _run_selective_loader(env_file: Path):
    """Inline copy of the selective override logic from core.py — so we can
    unit-test it without re-importing the whole module (which would pull
    in Motor / db connections)."""
    from dotenv import dotenv_values, load_dotenv
    if not env_file.exists():
        return
    load_dotenv(env_file, override=False)
    for key, env_val in dotenv_values(env_file).items():
        if not env_val:
            continue
        os_val = os.environ.get(key, "")
        if os_val and "****" in os_val:
            os.environ[key] = env_val


def test_dummy_placeholder_in_os_env_gets_replaced_by_dotenv(tmp_env):
    env_file, monkeypatch = tmp_env
    env_file.write_text("CM_TEST_KEY_A=sk_live_real_value_xyz\n")
    monkeypatch.setenv("CM_TEST_KEY_A", "sk_test_****gent")  # pod placeholder
    _run_selective_loader(env_file)
    assert os.environ["CM_TEST_KEY_A"] == "sk_live_real_value_xyz"


def test_real_looking_os_env_is_preserved(tmp_env):
    """The whole point of this fix: prod K8s vars must NOT be clobbered."""
    env_file, monkeypatch = tmp_env
    env_file.write_text("CM_TEST_KEY_B=mongodb://localhost:27017\n")
    monkeypatch.setenv("CM_TEST_KEY_B", "mongodb+srv://prod-cluster.example.net")
    _run_selective_loader(env_file)
    # Prod-looking value (no `****`) must win, .env must lose.
    assert os.environ["CM_TEST_KEY_B"] == "mongodb+srv://prod-cluster.example.net"


def test_missing_os_env_gets_filled_from_dotenv(tmp_env):
    env_file, monkeypatch = tmp_env
    env_file.write_text("CM_TEST_KEY_C=hello_world\n")
    monkeypatch.delenv("CM_TEST_KEY_C", raising=False)
    _run_selective_loader(env_file)
    assert os.environ["CM_TEST_KEY_C"] == "hello_world"


def test_empty_dotenv_value_does_not_clobber_os(tmp_env):
    env_file, monkeypatch = tmp_env
    env_file.write_text("CM_TEST_KEY_D=\n")
    monkeypatch.setenv("CM_TEST_KEY_D", "real_runtime_value")
    _run_selective_loader(env_file)
    assert os.environ["CM_TEST_KEY_D"] == "real_runtime_value"


def test_core_py_uses_no_global_override():
    """The literal `override=True` must not appear in core.py — that was
    the production-killer pattern."""
    src = Path("/app/backend/core.py").read_text()
    # We allow the string in COMMENTS (we cite the historical bug there)
    # but not in any actual load_dotenv(...) call.
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if "load_dotenv" in stripped and "override=True" in stripped:
            pytest.fail(f"core.py still has global override=True: {stripped}")


def test_email_service_uses_no_global_override():
    src = Path("/app/backend/email_service.py").read_text()
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if "load_dotenv" in stripped and "override=True" in stripped:
            pytest.fail(f"email_service.py still has global override=True: {stripped}")
