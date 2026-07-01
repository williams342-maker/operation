# Crafters Market — Policy Consistency Audit (v3.0 wave)

**Audit date:** 2026-06-30
**Auditor:** Emergent agent (automated review; NOT legal review)
**Scope:** Policy documents in `/app/frontend/src/pages/PolicyPage.jsx` after the v3.0 expansion wave (Maker Agreement, Returns & Refunds, Shipping & Logistics, Privacy Policy, Privacy at a Glance, Cookie Policy).
**Purpose:** Flag terminology drift, undefined terms, cross-reference gaps, fee/timeline inconsistencies, and hierarchy conflicts BEFORE the suite is sent for attorney review. This audit is evidence, not action.

---

## 1. Canonical vocabulary (defined once, used everywhere)

| Term | Definition | Consistency status |
|---|---|---|
| **Maker** | Approved individual or business selling handmade / handcrafted items on the Platform. | ✅ Used consistently across all v3.0 sections. Note: Terms of Service section (untouched) still uses **"Seller"** in the "For Sellers" heading and bullets — see item 4a below. |
| **Buyer** | End customer purchasing from a Maker via the Platform. | ✅ Consistent. |
| **Platform** | The Crafters Market marketplace, tools, and web presence at `craftersmarket.org`. | ✅ Consistent. |
| **Listing** | An item posted by a Maker for sale on the Platform. | ✅ Consistent. |
| **Order** | A purchase transaction placed by a Buyer against one or more Listings. | ✅ Consistent. |
| **Shop Policy** | A Maker's individual, published policies (returns, custom-order, shipping, etc.). | ✅ Consistent. |
| **Digital Product** | Non-physical deliverable (SVG, DXF, STL, pattern, etc.) delivered electronically. | ✅ Consistent (Maker Agreement §17, Returns §5, Shipping §11, Cookie §n/a). |
| **Custom Order** | Made-to-order or personalized item requiring proof/approval flow. | ✅ Consistent. |
| **User Content** | Maker-uploaded photos, videos, descriptions, logos, digital files. | ✅ Consistent across Maker Agreement §10 and Privacy Policy §2. |
| **Founding Seller** | Approved Maker in the inaugural cohort with a permanent badge. | ✅ Referenced in Maker Agreement §4 and §21 (revocation on enforcement). |
| **Marketplace Assistance** | Crafters Market's dispute-facilitation role. | ✅ Defined in Returns & Refunds §13; referenced from Shipping §9 and the outro of Shipping. |

## 2. Cross-references between documents

| From → To | Reference intact? |
|---|---|
| Maker Agreement §14 → Marketplace fees table | ✅ "The current fee schedule is set out in the Marketplace section above and is incorporated into this Agreement by reference." |
| Maker Agreement §15 → Returns & Refunds Policy | ✅ Explicit. |
| Maker Agreement §19 → Privacy Policy | ✅ Explicit. |
| Maker Agreement §21 → Enforcement mechanics | ✅ Self-contained + refs Founding Seller §4. |
| Returns & Refunds §2 → Policy Hierarchy | ✅ Six-level hierarchy defined explicitly. |
| Returns & Refunds §13 → Terms of Service + Maker Agreement | ✅ Explicit. |
| Shipping §9 → Returns & Refunds §13 | ✅ Explicit ("Marketplace Assistance per the Returns & Refunds Policy"). |
| Shipping §11 → Returns & Refunds Digital Products section | ✅ Explicit. |
| Privacy at a Glance → Privacy & Data Policy anchor | ✅ Inline link (`#privacy`). |
| Privacy §7 → Cookie Policy | ✅ Referenced. |
| Cookie §11 → Privacy Policy anchor | ✅ Inline link (`#privacy`). |

## 3. Fee / commission language

Referenced in three places. All defer to a single source of truth (Marketplace section) to prevent drift:

- **Marketplace section (canonical fee schedule)** — 5% commission (Free tier), 4% (Plus), 3% processing, 12% off-site ad fee, listing fees.
- **Maker Agreement §14** — "The current fee schedule is set out in the Marketplace section above and is incorporated into this Agreement by reference." ✅ No duplication of numbers.
- **Returns & Refunds §10** — "Platform commission on a refunded amount is refunded to the Maker per the Maker Agreement." ✅ No duplication of numbers.

**Verdict:** ✅ Single source of truth. If fees change, only the Marketplace section needs editing.

## 4. Items flagged for owner action (not legal review)

### 4a. Terms of Service still says "For Sellers" (not "For Makers")
- **Where:** `PolicyPage.jsx:31-38` — the untouched top-of-page Terms of Service uses the heading "For Sellers" and refers to "you must sell only items you make yourself…".
- **Impact:** Minor terminology drift. Every v3.0 section standardises on **Maker**, but the ToS still uses **Seller** in one heading. Not a legal problem — the two terms are interchangeable and both are defined — but a plain-language reader may bounce between them.
- **Fix:** One-line edit if desired (change heading to "For Makers"). Not blocking legal review.

### 4b. Effective Date is `[Insert Date — to be set on legal sign-off]` in six places
- Maker Agreement §1 + outro, Returns & Refunds §1 + outro, Shipping §1 + outro, Privacy §1 + outro, Cookie §1 + outro.
- **Action:** Once legal review is complete, do a single find/replace on `[Insert Date — to be set on legal sign-off]` and the count should be six.

### 4c. Founding Seller program details in Maker Agreement §4 are described but not enumerated
- **Where:** §4 says "Founding Sellers receive a permanent founder badge… and any benefits announced for that cohort (which may include preferred placement, reduced fees, or inaugural perks)."
- **Rationale:** Kept intentionally general to avoid contradicting the Marketplace fee table if program mechanics evolve.
- **Fix (optional):** If your inaugural cohort has locked-in benefits (e.g. permanent 1% commission discount), consider expanding §4 to say so explicitly. Keep the fee-schedule detail out of the Agreement (Marketplace section is canonical) but the *entitlement* can be enumerated.

### 4d. Cookie Preference Center is described but not implemented
- **Where:** Cookie Policy §7 and "Future: Cookie Preference Center" block explicitly say "[PLANNED — implementation pending Phase-D exit]".
- **Impact:** None so long as the Platform is not marketing to consent-required jurisdictions (EU/UK/EEA/CA under CPRA/etc.). If the Platform is already collecting non-essential cookies from those jurisdictions today, this is a real gap.
- **Recommendation:** Confirm with your analytics setup whether GA4 is loading before an accept action for consent-required-jurisdiction visitors. If yes, gate GA4 behind a consent banner before public launch to those markets.

## 5. Items flagged for **attorney** review (surface only; do not edit)

- **Maker Agreement §25** — Standard Contract Provisions: severability, waiver, assignment, survival, governing law, dispute resolution (arbitration / class-action waiver / small-claims carve-out), entire agreement.
- **Maker Agreement §14** — Stripe Connect Connected Account Agreement incorporation language (verify with Stripe's current template).
- **Maker Agreement §18** — Tax / marketplace-facilitator responsibility split (state-by-state variation).
- **Maker Agreement §10** — Indemnification scope + carve-outs.
- **Returns & Refunds §2** — Policy hierarchy (confirm consumer-protection primacy language for target states).
- **Returns & Refunds §4** — Custom Order non-returnability (some states require statutory cancellation windows regardless).
- **Returns & Refunds §5** — Digital Product non-returnability (EU consumer-protection distance-selling rules if international expansion).
- **Returns & Refunds §14–15** — Chargeback + fraud investigation authority.
- **Shipping §10** — International shipping (confirm no import into consent-required jurisdictions without proper disclosures).
- **Shipping §14** — Force Majeure scope.
- **Privacy §10** — International transfers (SCC or other mechanism if EU/UK visitors).
- **Privacy §6** — User Rights (state-by-state CPRA, VCDPA, CTDPA, UCPA, TDPSA variations).
- **Cookie §7** — Consent-mechanism language (ePrivacy, GDPR, LGPD, CPRA).

## 6. What is NOT covered by this policy suite yet

Nothing critical. The following are additive, not blocking:

- **Seller Misconduct / Buyer Misconduct** — exist as sections; not part of v3.0 wave; keep as-is until Maker Agreement §21 language is legally finalized, then align.
- **Intellectual Property Policy (DMCA)** — exists as its own section; adequate today, but note that Prohibited Items §4 and Maker Agreement §9 both point to it, so DMCA text should be reviewed by counsel in the next audit pass.

*Previously flagged gap now CLOSED:* Community Guidelines — dedicated section added at `#community-guidelines` in this wave. The ToS + Maker Agreement references now resolve to a real section.

## 7. Version-history footprint (added in this wave)

| Section | Version | Revision-history block present? |
|---|---|---|
| Our Marketplace Promise | (no version — values statement) | N/A (non-legal) |
| Maker Agreement | 3.0 | ✅ |
| Returns & Refunds | 3.0 | ✅ |
| Shipping & Logistics | 3.0 | ✅ |
| Community Guidelines | 3.0 | ✅ |
| Privacy at a Glance | (no version — plain-language summary) | N/A (non-legal) |
| Privacy & Data | 3.0 | ✅ |
| Cookie Policy | 3.0 | ✅ |
| Prohibited Items Policy | 3.0 | ✅ |

Total sections on `/policy` page: **17**, in this narrative order:
Marketplace Promise → Terms of Service → Shipping → Returns → Custom → Fulfillment → Payment → Makers Market (fees) → Maker Agreement → Community Guidelines → Privacy at a Glance → Privacy & Data → Cookies → Prohibited Items → Intellectual Property → Seller Misconduct → Buyer Misconduct.

Each block includes a version-history footer that lists v3.0's landing date and briefly summarizes the change from the prior version.

## 8. Recommended next actions

1. **Send this audit + the v3.0 policy pages to your attorney.** Focus their attention on the items flagged in §5 above.
2. **Decide on item 4a** (unify Terms of Service "For Sellers" → "For Makers"). One-line edit if you want to.
3. **Decide on item 4c** (Founding Seller entitlement enumeration).
4. **Confirm item 4d** (GA4 consent gating for consent-required jurisdictions) with your analytics team, or accept the limitation until Phase D ends.
5. **Do NOT rush the "Maker Shop Policy Template" build** that ChatGPT/Grok recommended — that is a new product feature that violates the Phase D freeze. Log it in the backlog and reconsider after Phase D exit.
6. **Once counsel returns edits**, do a single find/replace on the six `[Insert Date …]` placeholders to publish the effective date across the suite.

---

**End of audit.**
