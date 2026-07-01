# Policy Consistency Audit — 2026-06-30 (Trust & Policy Center v1)

**Status:** Completed
**Reviewer:** Emergent build agent (automated) + human sign-off pending
**Scope:** All policies rendered under `/policies` and `/trust` as of 2026-06-30.

---

## 1. Purpose

This audit verifies that the Crafters Market Trust & Policy Center v1 policy suite is internally consistent — same terminology, same policy hierarchy, matching cross-references, uniform metadata — before human sign-off and publication.

The audit does not evaluate legal sufficiency. Those items are captured in each policy's **Appendix A — Attorney Review Notes**.

---

## 2. Documents Audited

| Slug | Title | Version | Category |
| --- | --- | --- | --- |
| `terms` | Terms of Service | 2.0 | Core |
| `privacy` | Privacy Policy | 3.0 | Core |
| `cookies` | Cookie Policy | 3.0 | Core |
| `maker-agreement` | Maker Agreement | 3.0 | Core |
| `buyer-protection` | Buyer Protection Policy | 1.0 | Core |
| `returns` | Returns & Refunds Policy | 3.0 | Core |
| `shipping` | Shipping & Logistics Policy | 3.0 | Core |
| `prohibited-items` | Prohibited Items Policy | 3.0 | Core |
| `community-guidelines` | Community Guidelines | 3.0 | Core |
| `ip-dmca` | Intellectual Property & DMCA Policy | 1.0 | Operational |
| `marketplace-promise` | Our Marketplace Promise | 1.0 | Trust |
| `privacy-at-a-glance` | Privacy at a Glance | 1.0 | Trust |

---

## 3. Terminology Consistency

Terms enforced across all documents (source of truth: `src/data/policies/glossary.js`):

- ✓ **Maker** — used consistently; "seller" only used where legally required (e.g., "seller of record").
- ✓ **Buyer** — used consistently.
- ✓ **Platform** — used consistently for Crafters Market as the marketplace operator.
- ✓ **Listing** — used consistently for published sale items.
- ✓ **Order** — used consistently for completed purchase transactions.
- ✓ **Shop Policies** — used consistently for Maker-published policies.
- ✓ **User Content** — used consistently for uploaded content.
- ✓ **Digital Product**, **Custom Order** — used consistently.
- ✓ **Marketplace Assistance** — reserved for Buyer Protection Policy scope only.
- ⚠ Legacy sections in `PolicyPage.jsx` (`payment`, `marketplace`, `custom`, `fulfillment`, `seller-misconduct`, `buyer-misconduct`) still use some legacy retail terminology. Kept for `/policy` backward compatibility. **Deferred**: not migrated to `/policies/:slug` in v1. Recommended: separate audit + rewrite in a future patch pass.

---

## 4. Policy Hierarchy References

Every core policy references the same hierarchy (see `src/data/policies/hierarchy.js`):

1. Applicable Law → 2. Terms of Service → 3. Marketplace Policies → 4. Maker Agreement → 5. Maker Shop Policies → 6. Order-Specific Agreements.

Rendered on `/policies/:slug` via the `PolicyHierarchyBlock` component. Consistency: ✓

---

## 5. Cross-Reference Integrity

Each policy's `related` array in `manifest.js` was resolved against known slugs:

- `terms` → `maker-agreement`, `buyer-protection`, `privacy`, `prohibited-items`, `fee-pricing` (⚠ not yet published), `ip-dmca` ✓
- `privacy` → `cookies`, `terms`, `maker-agreement`, `buyer-protection` ✓
- `cookies` → `privacy`, `terms` ✓
- `maker-agreement` → `terms`, `prohibited-items`, `buyer-protection`, `shipping`, `returns`, `ip-dmca`, `fee-pricing` (⚠) ✓
- `buyer-protection` → `returns`, `shipping`, `terms`, `maker-agreement`, `community-guidelines` ✓
- `returns` → `buyer-protection`, `shipping`, `maker-agreement`, `terms` ✓
- `shipping` → `returns`, `buyer-protection`, `maker-agreement`, `terms` ✓
- `prohibited-items` → `terms`, `maker-agreement`, `community-guidelines`, `ip-dmca` ✓
- `community-guidelines` → `terms`, `maker-agreement`, `prohibited-items`, `buyer-protection` ✓
- `ip-dmca` → `terms`, `maker-agreement`, `prohibited-items`, `community-guidelines` ✓
- `marketplace-promise` → `terms`, `buyer-protection`, `community-guidelines` ✓
- `privacy-at-a-glance` → `privacy`, `cookies` ✓

**Broken references:** `fee-pricing` (slug not yet in manifest). Two policies (Terms, Maker Agreement) list it. **Action:** Create the Fee & Pricing Policy in the next patch pass, or remove the reference in the meantime. Currently displayed as a text reference in prose (not as a dead link), so no user-facing breakage.

---

## 6. Metadata Completeness

Every published policy has:

- ✓ `slug`
- ✓ `title`, `short_title`
- ✓ `version`
- ✓ `effective_date` (Terms shows "Pending legal sign-off" — intentional)
- ✓ `last_updated`
- ✓ `revision_history` with at least one entry
- ✓ `related` array
- ✓ `keywords` array for search
- ✓ `attorney_notes`, `implementation_notes`, `cross_ref_checklist` (Appendices A/B/C)

---

## 7. Appendices Present

All 12 published policies include Appendix A (Attorney Review Notes) with at least one item. The appendices are rendered inside a yellow "Internal · Remove Before Publication" callout via the `AttorneyReviewAppendices` component. Publication step: clear the appendix arrays once items are closed.

---

## 8. Deferred to Post-Phase D (Backlog)

- Fee & Pricing Policy — publish as a dedicated policy at `/policies/fee-pricing`.
- Cookie Preference Center — user-facing opt-in/opt-out UI.
- Seller Verification public page — expand into a dedicated `/policies/seller-verification` doc once the verification program is formalized.
- Security Center, Accessibility Statement, Marketplace Transparency Report — Trust Center expansion docs.
- Maker Shop Policy Builder — configurable defaults in the seller dashboard (Phase-freeze restricted).
- Public Product Review Matrix visibility — Public-safe summary of the internal matrix.

---

## 9. Sign-Off Checklist for Publication

- [ ] Legal counsel reviews each policy's Appendix A and returns tracked edits.
- [ ] Founder signs off on major version numbers.
- [ ] Fee & Pricing Policy published (or cross-references removed).
- [ ] Effective dates set on all policies (Terms currently marked "Pending legal sign-off").
- [ ] Appendices cleared (items moved to internal tickets).
- [ ] Active Makers notified of major version changes; re-acceptance flow triggered where required.
- [ ] Redirect `/policy` → keep for backward compatibility; verify all `/policy#anchor` links still resolve.
- [ ] Post-publication spot-check the following week.

---

## 10. Audit History

- **2026-06-30** — First full audit for Trust & Policy Center v1 launch.
