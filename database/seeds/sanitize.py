#!/usr/bin/env python3
"""
Sanitize Mongo seed exports before committing them to GitHub.

Strips:
- Authentication: password_hash, password_reset_*, password_set_at,
  last_password_change_at, magic_* tokens, sessions
- PII: email, contact_email, phone, address fields
- Payment: stripe_customer_id, stripe_account_id, bank_*, tax_id, ssn
- Operational: _id (Mongo internal — caller can use slug/id field instead)

Run via: python3 sanitize.py
Re-runs are idempotent — safe to invoke before every commit.
"""
import json
import pathlib

SENSITIVE_KEY_SUBSTRINGS = [
    "password", "email", "phone", "token", "secret",
    "stripe_customer", "stripe_account", "bank_", "tax_id", "ssn",
    "session", "magic_", "nonce",
    "last_password_change_at", "password_set_at",
    "address_line", "address_street", "billing_address",
]

# Allowlist: keys that LOOK risky by substring but are actually safe to keep.
KEEP = {"contact_method"}  # e.g. "email" / "form" as an enum value, not a value

# Files to sanitize. Each tuple: (filename, extra_keys_to_strip).
TARGETS = [
    ("products.json", []),
    ("makers.json", []),
    ("reviews.json", ["reviewer_email", "buyer_email"]),
]


def is_sensitive(key: str) -> bool:
    if key in KEEP:
        return False
    k = key.lower()
    if k == "_id":
        return True
    return any(s in k for s in SENSITIVE_KEY_SUBSTRINGS)


def clean(doc, extra: list[str]) -> dict:
    return {
        k: v
        for k, v in doc.items()
        if not is_sensitive(k) and k not in extra
    }


def main():
    root = pathlib.Path(__file__).parent
    for filename, extra in TARGETS:
        path = root / filename
        if not path.exists():
            print(f"  skip {filename} (not found)")
            continue
        data = json.loads(path.read_text())
        before_keys = set()
        for d in data:
            before_keys.update(d.keys())
        cleaned = [clean(d, extra) for d in data]
        after_keys = set()
        for d in cleaned:
            after_keys.update(d.keys())
        stripped = sorted(before_keys - after_keys)
        path.write_text(json.dumps(cleaned, indent=2, default=str))
        print(f"  ✓ {filename}: {len(cleaned)} docs, stripped {len(stripped)} keys → {stripped}")


if __name__ == "__main__":
    main()
