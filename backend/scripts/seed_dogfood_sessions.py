"""Operational utility — seed Verification Sessions in bulk.

Reusable across every Verification Session Framework use case:
  • production_verification (the original dogfood pass)
  • founder_onboarding (first 30 days with a new founding seller)
  • feature_validation (new feature dogfooded against real flows)
  • seller_interview / buyer_research
  • beta_feedback / ai_evaluation

This is NOT a product feature. It's the standard operator tool for
spinning up a batch of sessions + sharing the `?compass=1&session=<id>`
deep-links with the participants.

Idempotent by default — won't create a duplicate OPEN session for the
same (verification_type, participant_email) tuple unless --force is
supplied. Safe to re-run after a partial failure.

============================================================
USAGE
============================================================

    # Minimal — 5 participants from CSV against production
    BASE_URL=https://craftersmarket.org \
      ADMIN_EMAIL=team@craftersmarket.org \
      python scripts/seed_dogfood_sessions.py \
        --input scripts/dogfood_participants.example.csv

    # With JSON input, custom verification type + title prefix,
    # and JSON export for reuse:
    BASE_URL=https://craftersmarket.org \
      ADMIN_EMAIL=team@craftersmarket.org \
      python scripts/seed_dogfood_sessions.py \
        --input ./participants.json \
        --verification-type founder_onboarding \
        --title-prefix "Founder Onboarding · Q1 2026" \
        --export-json ./onboarding_sessions.json

    # Force re-create (closes idempotency guard):
    python scripts/seed_dogfood_sessions.py --input p.csv --force

============================================================
INPUT FILE FORMAT
============================================================

CSV (required header row, extra columns ignored):

    participant_name,participant_type,email
    Michael Williams,admin,mike@example.com
    Loretta,seller,loretta@example.com
    Coastal Chic,seller,coastal@example.com

JSON (array of objects with the same field names):

    [
      {"participant_name": "Loretta", "participant_type": "seller",
       "email": "loretta@example.com"},
      ...
    ]

`participant_type` must be one of: seller / buyer / founder / admin / visitor.

============================================================
OUTPUT
============================================================

A table is printed to stdout:

  PARTICIPANT         TYPE      SESSION ID                              DEEP LINK
  Loretta             seller    a4f2-…-9b8c                             https://craftersmarket.org/?compass=1&session=a4f2-…-9b8c
  …

Followed by a SUMMARY line: "Created N, skipped M (already open), failed K".

When --export-json is supplied, the same data is written to disk as:

  {
    "base_url": "...", "verification_type": "...", "generated_at": "...",
    "sessions": [
      {"participant_name": "...", "participant_type": "...", "email": "...",
       "session_id": "...", "deep_link": "...", "status": "created|skipped|failed",
       "reason": "..." (only when status != created)}
    ]
  }

Exit code: 0 if every row is created or skipped, 2 if any row failed.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

import requests
from maker_auth import issue_admin_magic_token


VALID_PARTICIPANT_TYPES = {"seller", "buyer", "founder", "admin", "visitor"}

# Canonical types from routers/verification_sessions.VERIFICATION_TYPES.
# Duplicated here so this script stays runnable without the FastAPI app
# being importable (e.g. when run from CI / a developer laptop).
VALID_VERIFICATION_TYPES = {
    "production_verification", "founder_onboarding", "feature_validation",
    "seller_interview", "buyer_research", "beta_feedback", "ai_evaluation",
}


def _load_participants(path: Path) -> list:
    """Parse a CSV or JSON participant file. Validates the schema +
    surfaces clear errors on the first bad row so operators can fix
    their input file before retrying."""
    ext = path.suffix.lower()
    if ext == ".json":
        with path.open() as f:
            rows = json.load(f)
        if not isinstance(rows, list):
            raise ValueError("JSON input must be an array of participants")
    elif ext == ".csv":
        with path.open(newline="") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    else:
        raise ValueError(f"Unsupported input format: {ext} (use .csv or .json)")

    cleaned: list = []
    for i, row in enumerate(rows, start=1):
        name = (row.get("participant_name") or "").strip()
        ptype = (row.get("participant_type") or "").strip().lower()
        email = (row.get("email") or "").strip().lower()
        if not name:
            raise ValueError(f"row {i}: participant_name is required")
        if ptype not in VALID_PARTICIPANT_TYPES:
            raise ValueError(
                f"row {i}: participant_type must be one of "
                f"{sorted(VALID_PARTICIPANT_TYPES)} (got {ptype!r})",
            )
        if not email:
            raise ValueError(f"row {i}: email is required")
        cleaned.append({
            "participant_name": name,
            "participant_type": ptype,
            "email": email,
        })
    if not cleaned:
        raise ValueError("input file contains zero participants")
    return cleaned


def _mint_admin_jwt(base_url: str, admin_email: str) -> str:
    tok = issue_admin_magic_token(admin_email)
    r = requests.post(
        f"{base_url}/api/admin/auth/verify",
        json={"token": tok}, timeout=20,
    )
    r.raise_for_status()
    return r.json()["token"]


def _find_open_session(base_url: str, headers: dict,
                        verification_type: str, email: str) -> dict | None:
    """Return the most recent OPEN session whose subject.email matches.
    Used to enforce idempotency (don't open a 2nd parallel session for
    the same participant unless --force).

    The list endpoint already drops the `turns` array, so this is a
    cheap read even with many active sessions."""
    r = requests.get(
        f"{base_url}/api/admin/verification-sessions",
        headers=headers,
        params={"verification_type": verification_type, "status": "open", "limit": 200},
        timeout=30,
    )
    r.raise_for_status()
    for row in r.json().get("rows", []):
        subject = row.get("subject") or {}
        if (subject.get("email") or "").lower().strip() == email:
            return row
    return None


def _start_session(base_url: str, headers: dict, verification_type: str,
                    title: str, participant: dict, feature_area: str) -> str:
    body = {
        "verification_type": verification_type,
        "title": title,
        "feature_area": feature_area,
        "subject": {
            "name": participant["participant_name"],
            "type": participant["participant_type"],
            "email": participant["email"],
        },
        "participants": [{
            "type": participant["participant_type"],
            "name": participant["participant_name"],
            "identifier": participant["email"],
        }],
        "platform_area": "dashboard",
        "tags": ["dogfood", verification_type.replace("_", "-")],
        "resolution_status": "open",
    }
    r = requests.post(
        f"{base_url}/api/admin/verification-sessions/start",
        headers=headers, json=body, timeout=30,
    )
    r.raise_for_status()
    return r.json()["session"]["id"]


def _deep_link(base_url: str, session_id: str) -> str:
    return f"{base_url.rstrip('/')}/?compass=1&session={session_id}"


def _print_table(rows: list) -> None:
    if not rows:
        print("\n(no sessions to report)")
        return
    headers = ("PARTICIPANT", "TYPE", "STATUS", "SESSION ID", "DEEP LINK")
    widths = [
        max(len(headers[0]), max(len(r["participant_name"]) for r in rows)),
        max(len(headers[1]), max(len(r["participant_type"]) for r in rows)),
        max(len(headers[2]), max(len(r["status"]) for r in rows)),
        max(len(headers[3]), max(len(r.get("session_id") or "—") for r in rows)),
        len(headers[4]),
    ]
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print()
    print(fmt.format(*headers))
    print(fmt.format(*("-" * w for w in widths)))
    for r in rows:
        print(fmt.format(
            r["participant_name"],
            r["participant_type"],
            r["status"],
            r.get("session_id") or "—",
            r.get("deep_link") or "—",
        ))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, help="Path to CSV or JSON participant file")
    parser.add_argument("--verification-type", default="production_verification",
                        choices=sorted(VALID_VERIFICATION_TYPES),
                        help="VerificationSession type (default: production_verification)")
    parser.add_argument("--title-prefix", default="",
                        help="Optional prefix for each session title (default: derived from verification-type)")
    parser.add_argument("--feature-area", default="coaching_dogfood",
                        help="`feature_area` tag (default: coaching_dogfood)")
    parser.add_argument("--force", action="store_true",
                        help="Create new sessions even when an open one already exists for the participant")
    parser.add_argument("--export-json", default=None,
                        help="Optional path to write a machine-readable summary")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse + validate the input file without hitting the API")
    args = parser.parse_args()

    base_url = (os.environ.get("BASE_URL") or os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
    admin_email = os.environ.get("ADMIN_EMAIL") or "team@craftersmarket.org"
    if not base_url:
        print("ERROR: set BASE_URL (or REACT_APP_BACKEND_URL) before running.", file=sys.stderr)
        return 1

    input_path = Path(args.input)
    if not input_path.is_file():
        print(f"ERROR: input file not found: {input_path}", file=sys.stderr)
        return 1

    try:
        participants = _load_participants(input_path)
    except (ValueError, json.JSONDecodeError) as e:
        print(f"ERROR: input file invalid — {e}", file=sys.stderr)
        return 1

    print(f"BASE:      {base_url}")
    print(f"ADMIN:     {admin_email}")
    print(f"INPUT:     {input_path}  ({len(participants)} participants)")
    print(f"TYPE:      {args.verification_type}")
    print(f"FORCE:     {args.force}")
    print(f"DRY-RUN:   {args.dry_run}")

    if args.dry_run:
        print("\nDRY-RUN parsed input — no API calls made:")
        for p in participants:
            print(f"  · {p['participant_name']:30s} {p['participant_type']:8s} {p['email']}")
        return 0

    try:
        admin_jwt = _mint_admin_jwt(base_url, admin_email)
    except requests.HTTPError as e:
        print(f"\nERROR: admin auth failed against {base_url}: HTTP "
              f"{e.response.status_code if e.response is not None else '?'} — "
              "MAKER_AUTH_SECRET likely differs between this env and the target. "
              "Either run this from a host where the secret matches, OR generate a "
              "magic link manually and exchange it.", file=sys.stderr)
        return 1
    headers = {"Authorization": f"Bearer {admin_jwt}"}

    title_prefix = (args.title_prefix or "").strip() or args.verification_type.replace("_", " ").title()

    results: list = []
    created = skipped = failed = 0
    for p in participants:
        row = {
            "participant_name": p["participant_name"],
            "participant_type": p["participant_type"],
            "email": p["email"],
            "session_id": None,
            "deep_link": None,
            "status": "pending",
            "reason": "",
        }
        try:
            if not args.force:
                existing = _find_open_session(
                    base_url, headers, args.verification_type, p["email"],
                )
                if existing:
                    row["session_id"] = existing["id"]
                    row["deep_link"] = _deep_link(base_url, existing["id"])
                    row["status"] = "skipped"
                    row["reason"] = "open session already exists (use --force to override)"
                    skipped += 1
                    results.append(row)
                    continue
            title = f"{title_prefix} · {p['participant_name']}"
            session_id = _start_session(
                base_url, headers, args.verification_type, title, p,
                args.feature_area,
            )
            row["session_id"] = session_id
            row["deep_link"] = _deep_link(base_url, session_id)
            row["status"] = "created"
            created += 1
        except requests.HTTPError as e:
            failed += 1
            row["status"] = "failed"
            row["reason"] = (
                f"HTTP {e.response.status_code if e.response is not None else '?'} "
                f"— {(e.response.text[:200] if e.response is not None else str(e))}"
            )
        except Exception as e:
            failed += 1
            row["status"] = "failed"
            row["reason"] = f"{type(e).__name__}: {e}"
        results.append(row)

    _print_table(results)

    print(f"\nSUMMARY: {created} created · {skipped} skipped (already open) · {failed} failed")
    if failed:
        print("\nFAILURES:")
        for r in results:
            if r["status"] == "failed":
                print(f"  ✗ {r['participant_name']:30s} {r['reason']}")

    if args.export_json:
        out_path = Path(args.export_json)
        out_path.write_text(json.dumps({
            "base_url": base_url,
            "verification_type": args.verification_type,
            "title_prefix": title_prefix,
            "feature_area": args.feature_area,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sessions": results,
        }, indent=2) + "\n")
        print(f"\nExported summary → {out_path}")

    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
