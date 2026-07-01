# Legal Launch Checklist — Crafters Market

**Purpose:** Single source of truth for launch-blocking legal items. Every row is either counsel-approved, engineering-default-pending-reconfirmation, or an operational task. Update this file before publication and at each quarterly review.

**Owner:** Founder + Legal Lead
**Last updated:** 2026-06-30 (iter413ef · Final Legal Hardening Pass)
**First legal review:** Rocket Lawyer, 2026-06-30 (first-pass complete)
**Final hardening:** 2026-06-30 (Rocket Lawyer Priority 1 + Priority 3 complete)

---

## Legend

- **✅ Implemented** — code + policy text in place.
- **🟡 Engineering default — reconfirm with counsel** — a defensible choice was implemented from Rocket Lawyer's directional guidance; counsel must confirm the specific selection before publication.
- **🔴 Operational task** — not code; must be completed by a human before launch.
- **⏳ Post-launch** — deliberately deferred; tracked in ROADMAP.md.

---

## Launch-Blocker Items (from Rocket Lawyer's 2026-06-30 review)

### 1. Dispute Resolution

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Add mandatory arbitration + class-action waiver + small-claims carve-out |
| Implementation decision | 🟡 **Two-tier: 30-day informal → AAA Consumer Arbitration Rules + class-action waiver + small-claims carve-out + injunctive-relief carve-out + 30-day opt-out** |
| Where implemented | `PolicyPage.jsx` Terms §12; `manifest.js` Terms v2.2 |
| Status | 🟡 Engineering default — RECONFIRM WITH COUNSEL on: AAA (vs. JAMS), Consumer Rules (vs. Commercial), King County WA seat, 30-day opt-out window |
| Approved by | Pending final counsel sign-off |
| Approval date | — |

### 2. Payout Hold Language

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Limit to defined triggers; tie duration to Stripe lifecycle; clarify release |
| Implementation decision | ✅ Payout holds limited to: (a) Stripe risk/compliance/reserve, (b) fraud investigations, (c) active chargeback/dispute, (d) Maker identity-verification review, (e) legal/tax/regulatory inquiry. Duration = "only as long as reasonably necessary" including Stripe timelines / card-network dispute lifecycle / regulatory-inquiry timeline. |
| Where implemented | `PolicyPage.jsx` Terms §5 + Maker Agreement §14; `manifest.js` Terms v2.2 + Maker Agreement v3.2 |
| Status | ✅ Implemented per counsel guidance |
| Approved by | Pending final counsel sign-off |
| Approval date | — |

### 3. Indemnification

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Add carve-out for gross negligence + willful misconduct by Crafters Market |
| Implementation decision | ✅ Terms §11 second bullet: "This indemnification obligation does not apply to claims arising from Crafters Market's own (i) gross negligence or (ii) willful misconduct." |
| Where implemented | `PolicyPage.jsx` Terms §11; `manifest.js` Terms v2.2 |
| Status | ✅ Implemented per counsel guidance |
| Approved by | Pending final counsel sign-off |
| Approval date | — |

### 4. Privacy Roles (Platform vs. Maker)

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Clarify Crafters Market as Platform operator / payment facilitator / order administrator; Maker as independent seller responsible for Buyer info received for fulfillment |
| Implementation decision | ✅ Maker Agreement §19 opens with the role split ("Crafters Market operates the Platform … acts as data controller for those functions. You, the Maker, are an independent seller and act as an independent data controller for Buyer information you receive to fulfill Orders you accept."); Terms §5/§6 and Privacy Policy §2 already frame Platform-vs-Maker consistently. |
| Where implemented | `PolicyPage.jsx` Maker Agreement §19; Privacy Policy §2/§4; Terms §3/§6 |
| Status | ✅ Implemented |
| Approved by | Pending final counsel sign-off |
| Approval date | — |

### 5. AI Policy Clarification (Creator-Owned AI Policy)

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Distinguish Operational AI (permitted under license) from AI Model Training (opt-in only); no penalty for declining |
| Implementation decision | ✅ Terms §6a + Maker Agreement §10a + Privacy Policy §11 all describe the split with matching cross-references. Trust Center adds a dedicated "AI Promise · Creator-Owned AI Policy" pillar with the same principle in plain language. |
| Where implemented | `PolicyPage.jsx` Terms §6a; Maker Agreement §10a; Privacy Policy §11. `TrustCenterPage.jsx` "AI Promise" pillar (`data-testid="pillar-ai-promise"`). |
| Status | ✅ Implemented — matches company philosophy |
| Approved by | Founder + Rocket Lawyer directional |
| Approval date | 2026-06-30 (directional); final sign-off pending |

### 6. DMCA Safe Harbor

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Confirm designated agent, notice procedure, counter-notice, repeat infringer, copyright reporting workflow |
| Implementation decision | ✅ IP & DMCA Policy expanded to full safe-harbor policy: Designated DMCA Agent section (dmca@craftersmarket.org), § 512 notice requirements, counter-notice with 10-14 business day put-back window, § 512(i) repeat-infringer policy (3 substantiated notices / 12 months → permanent removal), parallel trademark process, rights-holder cooperation clause. |
| Where implemented | `PolicyPage.jsx` IP section; `manifest.js` IP & DMCA v2.0 |
| Status | ✅ Policy text implemented |
| Approved by | Pending final counsel sign-off |
| Approval date | — |

### 6a. DMCA Agent Registration (COMPLETED)

| Field | Value |
| --- | --- |
| Task | ✅ **Register Crafters Market's Designated DMCA Agent with the U.S. Copyright Office before public launch.** |
| Where | https://dmca.copyright.gov/osp/ |
| Registration Number | **DMCA-1074892** · Active · Effective 2026-06-30 |
| Designated Agent | Micheal Williams · 1864 North Cutter Place, Oak Harbor, WA 98277 · williams342@gmail.com · (360) 507-6178 |
| Deliverable | ✅ (a) DMCA Agent registered; ✅ (b) Postal address + email + phone published on the IP & DMCA Policy page (§2); ✅ (c) Attorney note cleared and implementation note updated. |
| Status | ✅ Complete |
| Owner | Founder |
| Completion date | 2026-06-30 |
| Renewal reminder | U.S. Copyright Office DMCA registrations must be renewed every 3 years — next renewal due 2029-06. Add to quarterly-review cadence tracking. |

### 7. FTC Marketplace Language

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Makers responsible for product accuracy, Made in USA claims, origin claims, truthful advertising, review disclosures. Prohibit fake reviews + undisclosed-incentivized reviews. |
| Implementation decision | ✅ Maker Agreement §19a "Truthful Advertising, Product Claims & Reviews (FTC Compliance)" — covers product-claim accuracy, Made-in-USA "all or virtually all" standard, truthful advertising, review authenticity, material-connection disclosure, no fake or AI-generated reviews, health/therapeutic-claim substantiation, regulated claims (organic/fair-trade/etc.). Community Guidelines §5 rewritten with matching FTC language. |
| Where implemented | `PolicyPage.jsx` Maker Agreement §19a + Community Guidelines §5; `manifest.js` Maker Agreement v3.2 + Community Guidelines v3.1 |
| Status | ✅ Implemented |
| Approved by | Pending final counsel sign-off |
| Approval date | — |

### 8. Accessibility Statement

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Add Accessibility Statement with commitment, contact, ongoing WCAG improvements; link from Trust Center |
| Implementation decision | ✅ New policy at `/policies/accessibility`. Includes: commitment, WCAG 2.1 Level AA target, known limitations, barrier-report path (accessibility@craftersmarket.org), ongoing improvements, formal-legal-frameworks note (ADA / Section 508). Linked from Trust Center (implicit via Trust category in `/policies` index). |
| Where implemented | `PolicyPage.jsx` new accessibility section; `manifest.js` accessibility v1.0 |
| Status | ✅ Policy text implemented |
| Approved by | Pending final counsel sign-off |
| Approval date | — |

### 8a. Accessibility Inbox (OPERATIONAL)

| Task | Provision accessibility@craftersmarket.org and route to Engineering + Support before public launch. |
| Status | 🔴 Not started |
| Owner | Engineering |
| Completion date | — |

### 9. Effective Dates

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Replace every "Pending Legal Sign-off" / "Insert Date" placeholder with one consistent effective date |
| Implementation decision | ✅ **Effective-date deployment hook implemented (iter413ef).** All 13 policies read from a single constant `POLICY_EFFECTIVE_DATE` in `src/data/policies/effectiveDate.js`, which is sourced from `REACT_APP_POLICY_EFFECTIVE_DATE` at build time. When the env variable is set to `YYYY-MM-DD`, every policy displays the injected date. When unset, all policies display the parked label "On production launch (date set at go-live)" as a defense-in-depth guard. |
| Where | `src/data/policies/effectiveDate.js` (new) + `manifest.js` + `PolicyPage.jsx` (all inline placeholders removed) |
| Deployment step | Before deploying to production, set `REACT_APP_POLICY_EFFECTIVE_DATE=YYYY-MM-DD` in the build environment. Verify on the preview build that the date renders correctly before pushing to production. |
| Status | ✅ Deployment hook implemented; date substitution pending go-live |
| Owner | Engineering (env var set at deploy) + Founder (date sign-off) |
| Completion date | — |

### 9a. Additional Legal-Hardening Items (Rocket Lawyer Priority 1, iter413ef)

| # | Item | Where | Status |
| --- | --- | --- | --- |
| 9a.1 | Maker Agreement mirror of ToS §12 dispute resolution — Governing Law, King County venue, 30-day informal, AAA arbitration, class-action waiver, small-claims carve-out, injunctive relief carve-out, 30-day arbitration opt-out | Maker Agreement §27 (new); manifest v3.3 | ✅ Implemented |
| 9a.2 | Electronic Signatures clause (E-SIGN / UETA) added to both ToS and Maker Agreement | ToS §14a; Maker Agreement §28; manifest ToS v2.3 + Maker Agreement v3.3 | ✅ Implemented |
| 9a.3 | Survival clause added to Maker Agreement — payment/license/IP/confidentiality/liability/indemnification/dispute-resolution/other by-nature-surviving obligations survive termination | Maker Agreement §26 (new); manifest v3.3 | ✅ Implemented |
| 9a.4 | Shipping / Risk-of-Loss review — Shop Policies may not override the Buyer Protection Policy | Returns Policy §7 (marketplace-floor bullet); manifest returns v3.1 | ✅ Implemented |
| 9a.5 | Priority 3 — California Privacy Rights (CCPA/CPRA) — right to know/delete/correct/limit SPI/opt-out of sharing/non-discrimination/agent-authorization/appeals | Privacy Policy §6a (new); manifest privacy v3.2 | ✅ Implemented |

### 10. Remove Internal Material (Appendix A/B/C)

| Field | Value |
| --- | --- |
| Rocket Lawyer recommendation | Remove attorney notes, implementation notes, cross-reference checklists from production |
| Implementation decision | ⏳ **Do NOT remove yet.** Workflow (confirmed by Founder 2026-06-30): (1) implement all counsel revisions [in progress]; (2) regenerate updated counsel packet PDF; (3) send to Rocket Lawyer for final sign-off; (4) clear Appendix A/B/C arrays in `manifest.js`; (5) publish. Defense-in-depth: `AttorneyReviewAppendices` component already gates render on `craftersmarket.org` hostname. |
| Where | `manifest.js` — clear `attorney_notes[]`, `implementation_notes[]`, `cross_ref_checklist[]` on each policy |
| Status | ⏳ Held until final counsel sign-off |
| Owner | Engineering |
| Completion date | — |

### 11. Final Consistency Audit

| Field | Value |
| --- | --- |
| Task | Before production: verify no placeholders, no broken links, no internal notes, policy hierarchy consistent, cross-references correct, versions correct, effective dates identical |
| Deliverable | Updated `/app/memory/governance/policy-consistency-audit-{date}.md` with new audit results |
| Status | ⏳ Pending — run after counsel's final sign-off and before deployment |
| Owner | Engineering |
| Completion date | — |

### 12. Production Gate

**Production release is blocked until:**

- [ ] Item 1 (Dispute Resolution) counsel-confirmed
- [ ] Item 9 (Effective Dates) hardcoded to go-live date
- [ ] Item 6a (DMCA Agent Registration) complete
- [ ] Item 8a (Accessibility inbox) provisioned
- [ ] Item 10 (Appendices cleared)
- [ ] Item 11 (Final Consistency Audit) passes
- [ ] Smoke test on preview passes

---

## Post-Launch Roadmap (locked order — see ROADMAP.md)

1. ✅ Publish `/policies/fee-pricing` — completed 2026-06-30. Standalone Fee & Pricing Policy v1.0 published; extracted from Terms §5 and Maker Agreement §14 into a single source of truth. See PolicyPage.jsx `fee-pricing` section and manifest entry.
2. ⏳ Cookie Preference Center
3. ⏳ Maker Agreement versioned acceptance (with IP + UA audit trail — design locked in `maker-agreement-acceptance-design.md`)
4. ⏳ **INFORM Consumers Act automation** — auto-comply once sellers cross the threshold (200+ new sellers or $5k+ gross revenue in continuous 12 months). New backlog item as of 2026-06-30.
5. ⏳ **Marketplace Facilitator Tax operational verification** — confirm with payment processor before launch; not a policy rewrite. New backlog item as of 2026-06-30.
6. ⏳ Accessibility enhancements — WCAG 2.1 AA conformance testing, alt-text tooling, keyboard-nav audit, focus-indicator sweep.

---

## Engineering Defaults — Reconfirm With Counsel

Per Founder's 2026-06-30 direction, flag these to counsel in the final sign-off packet:

1. **Arbitration structure** (Item 1). AAA + Consumer Rules + King County WA + 30-day opt-out. Alternatives available: JAMS, Commercial Rules, elsewhere-seated arbitration.
2. **30-day informal-resolution period** (Item 2). Industry standard. Confirm this is the right duration for Crafters Market's scale.
3. **Effective date label** (Item 9). Currently "On production launch (date set at go-live)". Confirm counsel is comfortable with this parked language, or provide a specific effective date.

Everything else is direct implementation of Rocket Lawyer's directional guidance.

---

## Sign-Off Log

Append rows as items are completed and approved.

| Date | Item | Approved by | Notes |
| --- | --- | --- | --- |
| 2026-06-30 | First-pass legal review | Rocket Lawyer | 12-doc bundled packet reviewed; directional guidance received |
| 2026-06-30 | AI Policy Clarification (Item 5) | Founder | Company philosophy confirmed |
| 2026-06-30 | Legal Launch Checklist created | Founder + Emergent | This document |
| 2026-06-30 | Fee & Pricing Policy v1.0 published | Founder + Emergent | Standalone `/policies/fee-pricing` — extracted from Terms §5 and Maker Agreement §14; added refund/chargeback/adjustments, payout timing, prospective-change clause, marketplace-facilitator tax section |
| 2026-06-30 | Second-round legal-review pass (iter413fr) | Founder + Emergent | 7 refinements: (1) Privacy §10 rewritten U.S.-focused with forward-looking EEA/UK SCC commitment; (2) Terms §6a + Maker §10a + Privacy §11 clarify Operational AI does NOT authorize Platform or third-party ad providers to train commercial foundation models; (3) Returns §6 separates 7-day transit-damage reporting recommendation from return window / Buyer Protection rights; (4) Terms §5 + Maker §14 + Fee-Pricing §9 add Stripe/card-network-controlled hold language; (5) Terms §12 + Maker §27 add remote-first arbitration (video/written by default), King County WA retained as legal seat; (6) Fee & Pricing §12 → 60-day notice for increases, immediate/shorter for reductions; (7) Terms §4 + Prohibited Items §12 add Maker-responsibility allocation for origin claims (Made in USA / Handmade). Counsel Review Packet regenerated. |
| 2026-06-30 | Final legal-hardening pass v3 (iter413v3) | Founder + Emergent | 6 refinements: (P1-1) Non-waivable-rights carve-out added to Returns §16, Shipping §15, Buyer Protection §15, Terms §12 Governing Law, and Maker §27 Governing Law; (P1-2) Terms §14 Changes to Terms adds 30-day notice for material fees/user-obligation changes and immediate effectiveness for security/legal/fraud/technical changes; (P1-3) Prohibited Items §14 rewritten to codify AI-assisted vs. materially-AI-generated distinction (no percentage threshold; required disclosure for materially AI-generated); (P1-4) Fee & Pricing §8 clarifies Stripe payment-processing fees are governed by the processor and may not be recoverable; (P2-5) Terms §5 + Maker §14 + Fee-Pricing §9 add Communication-during-holds reasonable-efforts language with law/card-network/fraud/regulatory carve-outs; (P2-6) Fee & Pricing §12 adds Click-Acceptance for material fee increases. Counsel Review Packet regenerated. |
| 2026-06-30 | Final Legal Consistency Audit v4 + Launch Readiness Pass (iter413v4) | Founder + Emergent | 6 items: (1) Policy hierarchy canonicalized in hierarchy.js v1.1 — Maker Agreement (seller-specific only) now sits between Terms and Marketplace Policies; Returns §2 updated to match; (2) Privacy Policy §4a added a concrete Third-Party Service Providers (Vendor Inventory) enumerating every production vendor — Stripe, Cloudflare, GA4, Google Ads, Google Search Console, Meta Ads/CAPI, Pinterest, TikTok, Sentry, Mailgun, Shippo, AI service providers (OpenAI/Anthropic/Google Gemini), Emergent Universal Key aggregator; (3) Arbitration opt-out internal ledger — new backend endpoints POST/GET /api/legal/arbitration-opt-outs (super-admin only), MongoDB collection `arbitration_opt_outs` with account_email, legal_name, role, opt_out_received_at, terms_first_accepted_at, within_window, processed_by, processed_at, verification_notes; Terms §12 and Maker §27 opt-out language updated to reference the internal ledger while retaining email as the authoritative legal submission method; (4) Prohibited Items §14 AI-Generated Content re-scoped to replace subjective wording with concrete example lists (AI-assisted: grammar/SEO/background removal/image cleanup/translation/title generation; materially-AI-generated: AI-created artwork/AI-generated product images/AI-generated printable designs/AI-generated digital downloads); (5) Maker Agreement §10 User Content License rewritten with purpose limitation, explicit ownership retention, and license-termination-on-account-closure with limited carve-outs (legal compliance, completed transactions, archived backups, previously published marketing, cached third-party systems); (6) Terms §5 + Maker §14 + Fee-Pricing §9 broaden payout-hold disclosure to include payment networks, financial institutions, and regulatory authorities. Placeholder scrub — 2 live [LEGAL REVIEW: ...] fragments removed from Shipping §10 and Cookie §7 and replaced with forward-looking safeguards language. Counsel Review Packet regenerated (139 pages, 599 KB). |
| 2026-06-30 | Two-packet split — Internal / Attorney (iter413v4-split) | Founder + Emergent | Split the counsel PDF into two artifacts. **Internal Counsel Packet** (`/counsel-packet` → `counsel-review-packet-2026-06-30.pdf`, 139 pp, 599 KB) — includes Appendix A (attorney notes), Appendix B (implementation notes), Appendix C (cross-reference checklist), engineering revision-history detail, and the cover-sheet "Post-Review Process on Our Side" section. **Attorney Review Packet** (`/attorney-packet` → `attorney-review-packet-2026-06-30.pdf`, 134 pp, 577 KB) — strips Appendices B and C, "Post-Review Process on Our Side", "ENGINEERING DEFAULT" notes, and rewrites revision-history summaries to remove internal file references (manifest.js, hierarchy.js, REACT_APP_POLICY_EFFECTIVE_DATE). Also sanitizes Emergent dev-inspector HTML attributes (`x-source-*`, `x-file-*`, `x-line-number`, `x-array-var`) from the extracted HTML before WeasyPrint rendering. The `render-counsel-packet-pdf.py` script is now parametrized via `IN_FILE`, `OUT_FILE`, `PACKET_TITLE`, `FOOTER_LABEL` env vars; a single `PrintBundlePage.jsx` renders both modes based on the URL path (`/counsel-packet` = internal, `/attorney-packet` = attorney). |
| _pending_ | Final counsel sign-off (all items) | _(counsel)_ | _blocked on updated packet PDF regen_ |
| _pending_ | DMCA Agent registration (Item 6a) | Founder | _operational task before launch_ |
| _pending_ | Effective date substitution (Item 9) | Engineering + Founder | _at deployment_ |
| _pending_ | Appendix removal (Item 10) | Engineering | _after counsel sign-off_ |
| _pending_ | Final Consistency Audit (Item 11) | Engineering | _before deployment_ |
| _pending_ | Production Gate (Item 12) | Founder | _final go/no-go_ |


---

## Operational Verification Checklist (non-code — confirm before Version 1.0 Launch)

The following operational items require human confirmation. They are not code changes; they are the operational counterparts to the legal documents now published.

- [ ] **policy@craftersmarket.org** — mailbox is provisioned, active, and monitored (used for DMCA notices, arbitration opt-outs, privacy requests, and general policy correspondence).
- [ ] **DMCA notice workflow** — an intake path exists (email or ticket queue) for takedown notices to the Designated Agent Micheal Williams; every accepted notice is logged and forwarded to the affected Maker.
- [ ] **Repeat-infringer policy** — internal enforcement doc exists (three-strike or equivalent). Reference: `/app/memory/governance/enforcement-guide.md`.
- [ ] **Arbitration opt-out ledger** — Legal / Compliance records every accepted opt-out via `POST /api/legal/arbitration-opt-outs` (super-admin only). Email remains the authoritative legal submission method; the ledger is the internal source of truth.
- [ ] **Privacy request workflow** — an operational process exists for CCPA/CPRA access, correction, deletion, and opt-out-of-sharing requests within the statutory timelines.
- [ ] **Stripe integration** — Connected Account Agreement URL, Payments Agreement URL, and payment-processor terms links resolve; test-mode webhook signing secret is rotated to live mode at go-live.
- [ ] **Trust Center smoke test** — every card on `/trust` resolves to a live policy; every card in `/policies` resolves; deep-links (`#toc-*`) route to the correct section.
- [ ] **Google Ads Conversion Labels** — real conversion IDs (Signup / Application / Purchase) provided by the marketer and wired into `googleAdsConversions.js`.

Once every item above is confirmed, the legal documents can be locked at **Version 1.0 Launch**.

## Post-Launch Roadmap (resume after Version 1.0 lock)

1. Cookie Preference Center
2. Maker Agreement DB versioned acceptance (with IP + UA audit trail — design in `maker-agreement-acceptance-design.md`)
3. INFORM Consumers Act automation
4. Marketplace Facilitator Tax operational verification with the payment processor
5. Accessibility enhancements — WCAG 2.1 AA conformance testing, alt-text tooling, keyboard-nav audit, focus-indicator sweep
6. **Refactor** — decompose `PolicyPage.jsx` (currently ~3.1k lines) into per-policy markdown/component files

