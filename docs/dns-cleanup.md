# DNS Cleanup — Crafters Market

After consolidating to **Postmark + Mailtrap fallback** for transactional
mail (and decommissioning Brevo / Sender / Mailerlite), there's a list of
DNS records on `craftersmarket.org` that are no longer in use and should
be removed. Stale SPF includes and dangling DKIM keys hurt deliverability:
some downstream receivers penalize domains that authorize sender networks
they no longer use.

## What to remove

The records below are **safe to delete** because they only authenticated
mail providers we no longer route mail through. Search your Cloudflare DNS
panel (or whoever your authoritative DNS is) for each `Type` + `Name` pair.

### 1) Brevo (formerly Sendinblue)

| Type | Name | Notes |
|------|------|-------|
| TXT | `mail._domainkey.craftersmarket.org` | Brevo DKIM. Safe to delete if your active DKIM is on a different selector (e.g. `pm._domainkey` for Postmark). |
| TXT | `_dmarc.brevo.craftersmarket.org` (if exists) | Brevo-specific DMARC override. |
| CNAME | `bounces.craftersmarket.org → bounce.brevo.com` | Custom bounce domain. |
| TXT | `brevocode.craftersmarket.org` | Domain verification record. Brevo no longer needs to verify. |

**Search hint:** anything pointing at `*.brevo.com`, `*.sendinblue.com`,
or `*.sib.com`.

### 2) Sender.net

| Type | Name | Notes |
|------|------|-------|
| TXT | `sender._domainkey.craftersmarket.org` | Sender DKIM selector. |
| CNAME | `track.craftersmarket.org → click.sender.net` (or similar) | Click-tracking subdomain. Verify nothing legitimate still points here before deleting. |
| TXT | Any record containing `v=spf1 ... include:_spf.sender.net` | Old SPF include line — see SPF section below. |

### 3) Mailerlite

| Type | Name | Notes |
|------|------|-------|
| TXT | `ml._domainkey.craftersmarket.org` | Mailerlite DKIM. |
| CNAME | `email.craftersmarket.org → emails.ml-attach.com` (or similar) | Tracking domain. |
| TXT | Any record containing `include:_spf.mlsend.com` | SPF include — see below. |

---

## 4) Consolidate the SPF record (most important)

If your TXT record at `craftersmarket.org` (or apex) still looks like
this:

```
v=spf1 include:spf.mtasv.net include:_spf.brevo.com include:mail.zendesk.com include:_spf.sender.net include:_spf.mlsend.com include:_spf.mailgun.org ~all
```

**That's a problem.** SPF has a hard limit of **10 DNS lookups** — each
`include:` is a lookup. Crossing 10 causes a `permerror` and many
receivers (Gmail, Outlook, Apple) silently drop your mail.

Replace with the lean version that matches what we actually send through:

```
v=spf1 include:spf.mtasv.net include:_spf.mailgun.org include:smtp.mailtrap.io ~all
```

Where:
- `spf.mtasv.net` → Postmark (primary transactional)
- `_spf.mailgun.org` → Mailgun (fallback when Postmark is down)
- `smtp.mailtrap.io` → Mailtrap (last-resort fallback in dev/staging)

If Mailgun is unused in production, drop that include too.

---

## 5) DMARC — keep as-is

Don't touch `_dmarc.craftersmarket.org`. If it's currently:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@craftersmarket.org; pct=100; adkim=s; aspf=s
```

Leave it. Removing the no-longer-used DKIM selectors above means DMARC
alignment falls back to the active selector (Postmark's `pm._domainkey`)
which is the desired behavior.

---

## How to verify after the cleanup

```bash
# 1) SPF should resolve cleanly with ≤10 lookups.
dig +short TXT craftersmarket.org | grep -i spf
# Use https://dmarcian.com/spf-survey/?domain=craftersmarket.org to count includes.

# 2) Active DKIM selector responds.
dig +short TXT pm._domainkey.craftersmarket.org

# 3) Removed selectors should now NXDOMAIN / empty.
dig +short TXT mail._domainkey.craftersmarket.org    # was Brevo — should be empty
dig +short TXT sender._domainkey.craftersmarket.org  # was Sender — should be empty
dig +short TXT ml._domainkey.craftersmarket.org      # was Mailerlite — should be empty

# 4) DMARC unchanged.
dig +short TXT _dmarc.craftersmarket.org
```

---

## After the cleanup — send a test mail

Send a transactional email (e.g. trigger a magic-link to a Gmail address)
and inspect headers in Gmail (`More → Show original`). You want to see:

- `SPF: PASS`
- `DKIM: PASS  with domain craftersmarket.org` (selector `pm`)
- `DMARC: PASS`

If any of those flip to NEUTRAL or FAIL after the cleanup, restore the
specific record you deleted from your provider's audit log and re-test.
Cloudflare keeps a 30-day history of DNS changes for exactly this case.

---

## Why bother?

- **Deliverability lift**: a clean SPF + single active DKIM selector
  improves inbox-placement rates by 5–15% in our experience.
- **Faster DNS resolution**: every receiver does an SPF lookup;
  fewer includes = fewer round-trips = receivers spend less time on
  your mail and won't time out.
- **Smaller attack surface**: deleted DKIM keys can no longer be used
  to spoof your domain even if an old vendor account is compromised.
