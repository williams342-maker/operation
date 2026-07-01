# Maker Agreement Versioned Acceptance — Design Spec (Post-Phase-D · P3)

**Status:** Design locked (2026-06-30). Implementation deferred until steps 1–7 of the post-launch release sequence are complete.
**Owner:** Engineering.
**Related policy:** `/policies/maker-agreement` (v3.0, versioned in `manifest.js`).

---

## Purpose

Give Crafters Market a **defensible audit record** of exactly which version of the Maker Agreement each Maker accepted, when they accepted it, and the technical context of that acceptance. This record protects the marketplace if a Maker later disputes which agreement they were bound by.

---

## Data Model

Collection: `maker_agreement_acceptances`

```jsonc
{
  "id": "PyObjectId",                          // ObjectId → string
  "maker_id": "PyObjectId",                    // FK → makers._id
  "agreement_version": "3.0",                  // matches manifest.js POLICIES[maker-agreement].version
  "accepted_at": "2026-06-30T18:04:22.913Z",   // UTC ISO-8601 (datetime.now(timezone.utc))
  "ip_address": "203.0.113.42",                // requester IP (see PII note below)
  "user_agent": "Mozilla/5.0 (…)",             // full UA string at acceptance
  "context": "maker_application_submit",       // enum — see Contexts section
  "policy_snapshot_hash": "sha256:…"           // optional — see Snapshot Hash section
}
```

Indexes:

- `{ maker_id: 1, agreement_version: 1 }` — unique. One acceptance per Maker per version.
- `{ maker_id: 1, accepted_at: -1 }` — recent-first history queries.

---

## PII Notes

`ip_address` and `user_agent` are personally identifying under most privacy regimes.

- **Retention:** 7 years or the longest applicable limitation period, whichever is longer. Justification: contract-formation evidence.
- **Access:** Read access restricted to Trust & Safety and Legal roles.
- **Deletion requests:** if a Maker requests deletion under CCPA/CPRA/GDPR, retain the acceptance record (agreement_version + accepted_at) but **redact** ip_address and user_agent. The record itself is contract-formation evidence and can be preserved on legitimate-interest grounds.
- **Privacy Policy update required:** disclose that we record acceptance metadata (IP, UA) at signup and on each re-acceptance. Add to the vendor/data-collection appendix.

---

## Contexts

Enum of acceptance triggers:

- `maker_application_submit` — first-time acceptance during application flow.
- `maker_application_reaccept` — Maker re-accepts an updated agreement after version bump.
- `admin_backfill` — administrative record for pre-existing Makers when the acceptance system launches. Include reviewer name in a `notes` field.

---

## Snapshot Hash (Optional but Recommended)

Store a `policy_snapshot_hash` = SHA-256 of the exact Maker Agreement text the Maker viewed at acceptance. This defends against a claim that "the site showed me different text" — the hash proves what was on the page.

Implementation:

1. On the Maker application page, compute a hash of the rendered Maker Agreement text (server-side) at page-load time.
2. Include the hash in the acceptance POST body.
3. Server verifies the hash matches the current published text (or a recent published text within a small tolerance window) before recording.

If not implemented at launch, defer to a v2 of this design. The `policy_snapshot_hash` field is optional in the collection schema.

---

## Re-Acceptance Flow

Triggered by: version bump in `POLICIES[maker-agreement].version` inside `manifest.js`.

1. On every authenticated Maker Dashboard page load, compare the current agreement version against the latest `accepted` row for that Maker.
2. If the current version is newer than the accepted version, block the dashboard behind a full-screen re-acceptance modal:
   - Displays the new Maker Agreement text (loaded from the same `/policies/maker-agreement` source of truth).
   - Highlights the changes since the previously-accepted version (using `revision_history` from the manifest).
   - Requires explicit checkbox + button click to accept. No implicit / silent acceptance.
3. On accept, POST to `/api/maker/agreement/accept` with `{ agreement_version, policy_snapshot_hash (optional) }`.
4. Server records the new acceptance and returns 200. Client removes the modal and resumes normal flow.
5. If Maker refuses, they can log out — but cannot create new Listings, accept new Orders, or withdraw payouts until they re-accept.

Exception: existing Orders can be fulfilled (Buyer-side commitments are honored).

---

## API Surface

Suggested endpoints (implementation deferred).

```
POST /api/maker/agreement/accept
     { agreement_version: string, policy_snapshot_hash?: string }
     → 200 { acceptance_id, accepted_at, agreement_version }

GET  /api/maker/agreement/status
     → 200 { current_version, accepted_version, needs_reacceptance: bool }

GET  /api/admin/maker/:id/agreement-history      (admin only)
     → 200 { acceptances: [ {version, accepted_at, ip, ua, context, ...}, ... ] }
```

All endpoints require authenticated Maker (or admin for the history query). All must be under `/api/` prefix per project routing convention.

---

## Frontend Wiring

- Add explicit consent checkbox to the Maker Application component. The checkbox label reads: **"I have read and agree to the Maker Agreement (version [N])."** Version number is read from the manifest.
- On submit, capture the current version and POST alongside the application.
- Add a re-acceptance modal component that mounts on the Maker Dashboard root.
- The re-acceptance modal uses the same `PolicyDocument` renderer as `/policies/maker-agreement` so text is guaranteed to match.

---

## Migration Plan (When Launched)

For Makers who signed up before this system exists:

1. On first Dashboard visit after launch, treat their status as "no accepted version on record."
2. Show the re-acceptance modal with a "First-time acknowledgement" banner explaining that we're formalizing acceptance records.
3. Record the acceptance as `context: "maker_application_reaccept"` with a note field.

Do not silently backfill acceptances on their behalf — the whole point of the collection is that the Maker explicitly acknowledged.

---

## Rollout & Risk

- **P3** priority in the locked release sequence.
- Ships after: (1) Trust Center is live, (2) Google Ads labels are wired, (3) `/policies/fee-pricing` is published, (4) Cookie Preference Center is live.
- Low product risk (additive feature, no existing behavior changes).
- Requires a Privacy Policy update **before** launch to disclose the new data collection.
- Requires legal review of the acceptance modal copy and the re-acceptance blocking behavior.

---

## Design Log

- **2026-06-30** — Initial design locked based on user requirements: `agreement_version`, `accepted_at (UTC)`, `ip_address`, `user_agent`, re-acceptance on version bump.
