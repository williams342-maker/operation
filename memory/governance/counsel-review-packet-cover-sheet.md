# Counsel Review Packet — Cover Sheet

**Date sent:** _[fill in on send]_
**Bundle version:** Trust & Policy Center v1
**Contact:** _[fill in]_
**Response requested by:** _[fill in — recommend 2 weeks]_

---

## Purpose

Crafters Market is a curated multi-vendor marketplace connecting independent Makers with Buyers. This packet contains **twelve (12) policy documents** that comprise our Trust & Policy Center v1, prepared for a single-pass legal review before public launch.

We chose to send all twelve documents together (rather than piecemeal) so that counsel can catch inconsistencies **between** documents — for example, Terms vs Returns vs Privacy — that would be invisible in a document-by-document review.

Every document carries an internal **Appendix A — Attorney Review Notes** with the specific items we know need your input. Those Appendix A items are our best guess at what needs legal attention; please treat them as a **starting list, not a limit**. If you spot additional legal risks or improvements, flag them.

## Documents Included (in the order they appear in the manifest)

| # | Title | Slug | Version | Category |
| --- | --- | --- | --- | --- |
| 1 | Terms of Service | `terms` | 2.0 | Core |
| 2 | Privacy Policy | `privacy` | 3.0 | Core |
| 3 | Cookie Policy | `cookies` | 3.0 | Core |
| 4 | Maker Agreement | `maker-agreement` | 3.0 | Core |
| 5 | Buyer Protection Policy | `buyer-protection` | 1.0 | Core |
| 6 | Returns & Refunds Policy | `returns` | 3.0 | Core |
| 7 | Shipping & Logistics Policy | `shipping` | 3.0 | Core |
| 8 | Prohibited Items Policy | `prohibited-items` | 3.0 | Core |
| 9 | Community Guidelines | `community-guidelines` | 3.0 | Core |
| 10 | Intellectual Property & DMCA Policy | `ip-dmca` | 1.0 | Operational |
| 11 | Our Marketplace Promise | `marketplace-promise` | 1.0 | Trust / values |
| 12 | Privacy at a Glance | `privacy-at-a-glance` | 1.0 | Trust / summary |

Preview URL: [insert preview URL] — the documents are also readable at `/policies/:slug` and gathered at `/policies`. Every document displays a "Founding Access v1 · Pending legal review" notice above its Table of Contents.

## Nine Focus Areas — Please Review Specifically

1. **Consistency across all policies.** Where do the twelve documents disagree with each other on any material term, definition, hierarchy, or obligation?
2. **Marketplace-facilitator responsibilities.** Does our marketplace-model framing (Platform vs. Maker vs. Buyer) hold up legally, including for marketplace-facilitator sales-tax purposes?
3. **Washington State considerations.** We designate King County, WA as the primary venue and Washington law as governing. Please confirm this framework is defensible and identify any Washington-specific consumer-protection or business-license provisions we should add.
4. **Privacy disclosures.** Does the Privacy Policy (v3.0) meet current state-privacy-law standards (CCPA/CPRA, VCDPA, CPA, CTDPA, UCPA)? If we open to EU/UK, what needs to change?
5. **Payment / fee language.** Do the Fee & Commission clauses (currently within `/policy#marketplace`, moving to `/policies/fee-pricing` post-launch) accurately describe our commission structure and Stripe-facilitated payments? Any exposure around off-site ad fees or promoted-listing fees?
6. **Seller obligations.** Does the Maker Agreement adequately protect the Platform while remaining enforceable against independent-contractor Makers? Please review the content-license grant, exclusivity clarifications, and payout hold provisions.
7. **Dispute resolution.** We currently point disputes to Washington courts. Should we adopt mandatory arbitration with a class-action waiver? What are the trade-offs for a Version-1 curated marketplace of our size?
8. **Required consumer disclosures.** Are we missing any mandatory disclosures for a U.S. e-commerce marketplace (e.g., FTC endorsement guides for reviews, Made in USA claims, subscription auto-renewal disclosures for Crafters Plus at $12/month)?
9. **Substantive changes flagged in Appendix A.** For each Appendix A item across the twelve documents, please confirm whether it requires substantive legal changes or can be resolved with a clarifying edit.

## What We Need Back

- Tracked edits or comments on each document.
- Any items in Appendix A that are OK as-is (so we can clear those first).
- Any additional legal issues you identify that are not in Appendix A.
- Sign-off (or conditional sign-off with a list of blockers) so we can trigger the pre-publication process on our end.

## Post-Review Process on Our Side

1. Apply your edits in a working branch.
2. Clear the Appendix A / B / C arrays in `manifest.js` once each item is closed.
3. Re-run our internal Policy Consistency Audit (`policy-consistency-audit-*.md`).
4. Publish.

We will also engage you on a **standing quarterly review cadence** going forward (see `quarterly-review-cadence.md` in our governance folder). This packet is the launch review; future reviews will be light-touch.

---

_Prepared by Crafters Market operations. Please direct clarifying questions to team@craftersmarket.org or the contact listed above._
