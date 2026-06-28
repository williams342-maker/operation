# PROD-CONFIG-001 · Production frontend calling preview backend

**Filed:** 2026-06-28 · **Severity:** stability (not perf, despite how it surfaced) · **Phase D status:** infra ticket, not a product feature — does NOT violate the freeze

---

## Problem statement

The production frontend deployed at `https://craftersmarket.org` is configured to call the **preview backend pod** `https://active-project-4.emergent.host` for all `/api/*` requests, instead of calling the production backend on the same canonical domain.

If the preview pod is ever reaped, recycled, scaled to zero, or has its hostname re-issued to a different project, the production homepage breaks. This is a deployment-fragility issue independent of the perf audit that surfaced it.

## Evidence

1. **Production JavaScript bundle hardcodes the preview host in 66 places**, confirming the build was run with the wrong `REACT_APP_BACKEND_URL`:
   ```
   $ curl -s https://craftersmarket.org/static/js/main.bbc0492a.js \
       | grep -oE "active-project-[0-9]+" | sort | uniq -c
       66 active-project-4
   ```
2. Frontend source code has **zero hardcoded references** to that host — every API call respects `REACT_APP_BACKEND_URL`. So this is purely a build-time env-var misconfiguration, not a code bug.
3. The production backend is fully reachable on the canonical domain:
   ```
   $ curl -s -o /dev/null -w "HTTP %{http_code}  ttfb=%{time_starttransfer}s\n" \
       https://craftersmarket.org/api/settings
   HTTP 200  ttfb=0.133s
   ```
4. Payloads are byte-identical between the two routes (same backend pod, same DB), confirming the fix is a pure URL change with no behavioral risk:
   ```
   $ diff <(curl -s https://craftersmarket.org/api/settings) \
          <(curl -s https://active-project-4.emergent.host/api/settings)
   (no output → identical)
   ```
5. No `api.craftersmarket.org` subdomain exists — the API is mounted at `/api/*` on the same apex domain.

## Recommended fix

Update the **production** deployment environment variable:

| Variable                | Current (wrong)                              | Target (correct)               |
|-------------------------|----------------------------------------------|--------------------------------|
| `REACT_APP_BACKEND_URL` | `https://active-project-4.emergent.host`     | `https://craftersmarket.org`   |

Then redeploy production.

**Do NOT change anything in the preview pod's `/app/frontend/.env`** — that one (`https://active-project-4.preview.emergentagent.com`) is correct for the preview environment and must stay as-is.

## How to apply (project owner action)

This is a platform-level environment variable, not in any file on the pod. To change it:

1. Open the Emergent project dashboard for `craftersmarket.org`.
2. Go to the deployment / environment-variables section for the **production** environment (not preview).
3. Locate `REACT_APP_BACKEND_URL` and change the value to `https://craftersmarket.org`.
4. Trigger a production redeploy (Save to GitHub → Deploy, or whatever Emergent's prod-deploy button is labeled).
5. After deploy, verify with:
   ```
   curl -s https://craftersmarket.org/static/js/main.<new-hash>.js \
     | grep -oE "active-project-[0-9]+" | sort | uniq -c
   ```
   Expected: empty output (zero references to the preview host).

If the environment-variable editor is not self-service, raise a ticket with **Emergent Support** referencing this file.

## What this fix is NOT

- ❌ Not a perf optimization (though it incidentally removes the 2,033 ms cold-pod TTFB Lighthouse measured to `active-project-4`).
- ❌ Not a product feature, not new code, not a new admin surface.
- ❌ Not one of the 13 items in `/app/memory/phase-d-audits/2026-06-28-perf-baseline.md` — that audit is parked for Week 4.
- ❌ Does NOT touch any of the pod-level `.env` files or any source code.

## Risk

- **Risk of applying the fix:** very low. Same backend pod, byte-identical responses, fewer hops.
- **Risk of NOT applying the fix:** preview pod outage / re-issue = production homepage stops working. Probability low per day, impact catastrophic when it hits.

## Acceptance criteria

- ✅ `grep -c "active-project-4"` against the deployed prod JS bundle returns `0`.
- ✅ Network waterfall on `https://craftersmarket.org` shows all `/api/*` calls going to `craftersmarket.org` (same origin).
- ✅ No regression in `/api/settings`, `/api/products?featured=true`, or `/api/makers` response shape.

## Status

- [ ] Owner verifies preview env-var stays as `https://active-project-4.preview.emergentagent.com`
- [ ] Owner updates prod env-var to `https://craftersmarket.org`
- [ ] Owner triggers prod redeploy
- [ ] Owner runs the verification curl above
- [ ] Ticket closed
