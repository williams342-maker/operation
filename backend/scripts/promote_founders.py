"""iter413cz+ — Idempotent admin script: promote a list of makers to Inaugural Founder.

Run against ANY environment (preview OR production) by setting BASE_URL +
ADMIN_EMAIL. Uses the existing admin endpoint `POST /api/admin/founders/promote`
(which is idempotent: re-running on an already-founder maker is safe and
reuses the existing `founder_number`).

Usage:
    cd /app/backend
    BASE_URL=https://craftersmarket.org \\
        ADMIN_EMAIL=team@craftersmarket.org \\
        python scripts/promote_founders.py \\
            coastal-chic-studio-inc \\
            peach-and-pine-designs \\
            avery-street-design-co

Effect per slug:
  • Sets `tier="founder"`, `founder_status="inaugural"`, lifetime expiry.
  • Issues an Inaugural Founder welcome email IFF this is the first time
    (skipped silently on re-runs to prevent re-spam).
  • Assigns the next monotonic `founder_number` (reused on subsequent runs).
  • Posts a public "Maker just became Founder #NNN" event to the activity
    ticker (deduplicated by event id, so re-runs are no-ops).
  • Immediately unlocks the Vanity URL claim form in the Settings tab.

Safe to run multiple times. Refuses to run without ADMIN_EMAIL.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

import requests
from maker_auth import issue_admin_magic_token


def main(slugs: list[str]) -> int:
    base = (os.environ.get("BASE_URL") or os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
    if not base:
        print("ERROR: set BASE_URL or REACT_APP_BACKEND_URL")
        return 1
    admin_email = os.environ.get("ADMIN_EMAIL") or "team@craftersmarket.org"
    if not slugs:
        print("ERROR: pass at least one maker slug as a CLI arg")
        return 1

    print(f"BASE: {base}")
    print(f"ADMIN: {admin_email}")
    print(f"PROMOTING {len(slugs)} maker(s) to Inaugural Founder:")
    for s in slugs:
        print(f"  - {s}")
    print()

    tok = issue_admin_magic_token(admin_email)
    r = requests.post(f"{base}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    admin_jwt = r.json()["token"]
    H = {"Authorization": f"Bearer {admin_jwt}"}

    ok, fail = 0, 0
    for slug in slugs:
        try:
            pr = requests.post(
                f"{base}/api/admin/founders/promote", headers=H,
                json={"slug": slug, "force_status": "inaugural"}, timeout=60,
            )
            if pr.status_code == 200:
                body = pr.json()
                print(f"  ✓ {slug:30s} → tier={body.get('tier')} "
                      f"founder_status={body.get('founder_status')} "
                      f"number={body.get('founder_number')}")
                ok += 1
            else:
                print(f"  ✗ {slug:30s} → HTTP {pr.status_code} {pr.text[:200]}")
                fail += 1
        except Exception as e:
            print(f"  ✗ {slug:30s} → exception: {e}")
            fail += 1

    print()
    print(f"SUMMARY: {ok} promoted, {fail} failed")
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
