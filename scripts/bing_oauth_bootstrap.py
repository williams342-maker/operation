#!/usr/bin/env python3
"""
Microsoft Advertising — Refresh-Token Bootstrap
================================================
Run this script ONCE on your local machine to get a long-lived
`BING_REFRESH_TOKEN`. Paste that token into /app/backend/.env on the
server. After that, the production app refreshes its own access tokens
silently — you should never need to run this again unless the user
"team@craftersmarket.org" revokes consent or changes their password.

PREREQUISITE (one-time, in Azure portal)
----------------------------------------
1. Go to https://portal.azure.com → App registrations → your
   "CraftersMarket Bing Sync" app.
2. Click "Authentication" in the left sidebar.
3. Click "+ Add a platform" → "Mobile and desktop applications".
4. Tick the checkbox for:
     https://login.microsoftonline.com/common/oauth2/nativeclient
5. Click "Configure". Save.

That's it on Azure. Now run this script.

USAGE
-----
    pip install requests
    python3 bing_oauth_bootstrap.py

When the script prompts you, sign in at the URL it prints, approve the
permissions, copy the final URL the browser lands on, and paste it back.
The script extracts the auth code, exchanges it for a refresh token,
and prints the token.
"""
from __future__ import annotations
import sys
import urllib.parse
from typing import Optional

try:
    import requests
except ImportError:
    print("ERROR: `requests` not installed. Run: pip install requests")
    sys.exit(1)


# ── Fill these in (or read from env) ──────────────────────────────────
CLIENT_ID = "f33e5b3d-d8dd-4c53-b199-368c94bf60eb"
CLIENT_SECRET = "Css8Q~Jfc0lA6ZQXnP1nOXVuaw94K3ke3t.o3b6k"
REDIRECT_URI = "https://login.microsoftonline.com/common/oauth2/nativeclient"
SCOPE = "https://ads.microsoft.com/msads.manage offline_access"

# Microsoft v2.0 OAuth endpoints — `/common/` because the account
# (team@craftersmarket.org) is a Microsoft personal account, not an
# Azure AD tenant account.
AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"


def build_auth_url() -> str:
    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPE,
        "prompt": "consent",   # force consent screen on first run
        "state": "cm_bing_bootstrap",
    }
    return f"{AUTH_BASE}?{urllib.parse.urlencode(params)}"


def extract_code(redirect_url: str) -> Optional[str]:
    """Extract the ?code= param from the URL the user pasted back."""
    parsed = urllib.parse.urlparse(redirect_url.strip())
    qs = urllib.parse.parse_qs(parsed.query)
    if "error" in qs:
        print(f"\nERROR from Microsoft: {qs['error'][0]}")
        print(f"Description: {qs.get('error_description', ['?'])[0]}")
        return None
    return qs.get("code", [None])[0]


def exchange_for_refresh_token(code: str) -> dict:
    """POST to the token endpoint and return the JSON response."""
    body = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
        "scope": SCOPE,
    }
    r = requests.post(TOKEN_URL, data=body, timeout=30)
    return r.json()


def main():
    print("=" * 70)
    print("Microsoft Advertising — Refresh-Token Bootstrap")
    print("=" * 70)
    print()
    print("STEP 1 — Open this URL in your browser:")
    print()
    print(build_auth_url())
    print()
    print("STEP 2 — Sign in with team@craftersmarket.org.")
    print("         Approve the 'Manage your Microsoft Advertising account'")
    print("         permission when asked.")
    print()
    print("STEP 3 — After approving, the browser will land on a page that")
    print("         looks like a blank/error page at")
    print("         login.microsoftonline.com/common/oauth2/nativeclient")
    print("         — that's expected. Copy the FULL URL from the address")
    print("         bar (it contains a long ?code=... parameter).")
    print()
    redirect_url = input("Paste the URL here, then press Enter: ").strip()

    code = extract_code(redirect_url)
    if not code:
        print("\nNo `code` parameter found in that URL. Aborting.")
        sys.exit(1)

    print(f"\n✓ Got auth code (len={len(code)}). Exchanging for refresh token…")
    result = exchange_for_refresh_token(code)

    if "refresh_token" not in result:
        print("\n✗ Token exchange FAILED. Microsoft replied:")
        for k, v in result.items():
            print(f"  {k}: {v}")
        sys.exit(2)

    refresh_token = result["refresh_token"]
    print()
    print("=" * 70)
    print("✓ SUCCESS — paste this into /app/backend/.env on the server:")
    print("=" * 70)
    print()
    print(f"BING_REFRESH_TOKEN={refresh_token}")
    print()
    print("Token type:", result.get("token_type"))
    print("Access-token expires in:", result.get("expires_in"), "seconds")
    print("Scope granted:", result.get("scope"))
    print()
    print("(The refresh token is long-lived — keep it secret like a password.)")


if __name__ == "__main__":
    main()
