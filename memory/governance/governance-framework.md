# Governance Framework — Crafters Market Trust & Policy Center

**Version:** 1.0
**Status:** Internal reference. Not published.
**Owner:** Marketplace Operations
**Last updated:** 2026-06-30

---

## Purpose

This document is the single source of truth for **how the Crafters Market policy ecosystem is governed**. It describes what each policy is for, which document governs which situation, how policy updates are managed, and who reviews them.

As the marketplace grows, this framework enables:

- Consistent onboarding for new team members and legal counsel
- Predictable versioning and approval workflows
- Fast conflict-resolution ("which policy controls?")
- Auditable revision history

---

## 1. Policy Hierarchy (Order of Precedence)

When two documents appear to conflict, the higher-numbered level below wins for the topic it covers.

1. **Applicable Law** — Federal, state, and local law of the User's jurisdiction or the Order's fulfillment jurisdiction.
2. **Terms of Service** (`/policies/terms`) — Foundational contract with every User.
3. **Marketplace Policies** — Topic-specific policies (Buyer Protection, Returns, Shipping, Privacy, Cookies, Prohibited Items, Community Guidelines, IP/DMCA, Fee & Pricing). Within its topic, a topic-specific policy controls over the Terms of Service.
4. **Maker Agreement** (`/policies/maker-agreement`) — Seller contract.
5. **Maker Shop Policies** — A Maker's own published Shop Policies. Must not conflict with the marketplace policies above; where they do, marketplace policies win.
6. **Order-Specific Agreements** — Terms agreed at checkout or in messaging for a specific Order.

Every published policy references this same hierarchy.

---

## 2. Document Ownership

Each policy has a designated internal owner responsible for keeping it current.

| Policy | Primary Owner | Reviewers |
| --- | --- | --- |
| Terms of Service | Legal Lead | Founder, Operations |
| Privacy Policy | Legal Lead + Data Officer | Founder, Engineering |
| Cookie Policy | Data Officer | Legal, Engineering |
| Maker Agreement | Operations Lead | Legal, Founder |
| Buyer Protection Policy | Operations Lead | Legal, Support |
| Returns & Refunds Policy | Operations Lead | Support |
| Shipping & Logistics Policy | Operations Lead | Support |
| Prohibited Items Policy | Trust & Safety Lead | Legal, Operations |
| Community Guidelines | Trust & Safety Lead | Support |
| IP & DMCA Policy | Legal Lead | Trust & Safety |
| Fee & Pricing Policy | Founder | Operations, Finance |
| Marketplace Promise | Founder | Operations |

Until dedicated roles are staffed, the Founder holds all owner slots and is responsible for delegating.

---

## 3. Policy Categories

- **Core Marketplace Policies** — Bind every Buyer and Maker.
- **Operational Policies** — Bind Users when a specific process is invoked (IP takedown, appeal, fee change).
- **Trust Center Documents** — Values, summaries, and plain-language explainers. Non-binding; the underlying core policy controls.
- **Internal Governance** — This document and its siblings. Not published.

---

## 4. Versioning Rules

- **Major version (X.0)** — Substantive change to rights, obligations, fees, or dispute resolution. Requires attorney review. All active Users notified. New effective date. For Makers, may require re-acceptance.
- **Minor version (X.Y)** — Clarifications, additions of related-policy references, expanded examples. Attorney review recommended. In-app notice.
- **Patch (X.Y.Z)** — Typo fixes, formatting, non-substantive edits. No user notice required.

Every version bump appends a new row to the Revision History block in the policy manifest (`src/data/policies/manifest.js`) with `version`, `date`, and `summary`.

---

## 5. Change Management Workflow

1. **Draft** — Owner drafts changes in a working branch. All internal appendices (Attorney Review, Implementation Notes, Cross-Reference Checklist) updated.
2. **Cross-Reference Audit** — Owner runs the consistency audit checklist (see `policy-consistency-audit-2026-06-30.md`) to confirm terminology, related-policy links, and hierarchy references are consistent.
3. **Attorney Review** — For major/minor versions, counsel reviews the Attorney Review Notes appendix and returns tracked edits.
4. **Founder Sign-Off** — Final approval by Founder (or delegate). Effective date set.
5. **Publication** — Merge to main. Effective date recorded. If major, notify active Users (email + in-app banner). Force re-acceptance for Makers where required.
6. **Post-Publication Audit** — Owner runs a spot-check the following week to confirm no broken links, inconsistent references, or downstream policy conflicts.

---

## 6. Approval Requirements

- **Terms of Service, Maker Agreement, Buyer Protection, Privacy Policy:** Major version requires attorney review + Founder sign-off.
- **Other core policies:** Major version requires Founder sign-off; attorney review recommended.
- **Operational policies (IP/DMCA, Fee & Pricing, Appeals):** Legal Lead sign-off + Founder sign-off.
- **Trust Center documents:** Founder sign-off only.
- **Patch versions on any policy:** Owner may commit directly. Note the change in the next weekly ops digest.

---

## 7. Cross-Reference Discipline

Whenever a policy references another policy by name (e.g., "see the Buyer Protection Policy"), the reference must:

1. Match the canonical policy title exactly.
2. Not create obligations that conflict with the referenced policy.
3. Be listed in the referring policy's `related` array in `manifest.js`.
4. Be validated in the `cross_ref_checklist` appendix.

The `policy-consistency-audit` document tracks the results of the most recent full audit.

---

## 8. Publication Removal (Appendices)

Every policy carries three internal appendices:

- **Appendix A — Attorney Review Notes**
- **Appendix B — Implementation Notes**
- **Appendix C — Cross-Reference Checklist**

These are rendered inside a yellow warning box on the site during development and are **automatically stripped** by the `AttorneyReviewAppendices` component if we set `policy.attorney_notes = []` for any given policy before publication. The recommended pre-publication step is to move outstanding items from the appendices into internal tickets and clear the arrays.

Do **not** delete the appendix arrays from the manifest before this action — the appendices are the audit trail. Clear them only when their items are closed.

---

## 9. Governance of This Document

This document is itself governed. Changes to the governance framework require Founder sign-off. Version bumps use the same major/minor/patch rules as marketplace policies.

**Revision history:**

- **v1.0** — 2026-06-30 — Initial framework covering hierarchy, versioning, ownership, change management, cross-reference discipline, and appendix handling.

---

## 10. Related Internal Documents

- `content-moderation-policy.md` — How the moderation team enforces the Prohibited Items Policy and Community Guidelines.
- `product-review-matrix.md` — Classification matrix for Listings (Allowed / Allowed with Conditions / Manual Review / Prohibited).
- `enforcement-guide.md` — Warnings, listing removal, suspension, appeals.
- `policy-consistency-audit-2026-06-30.md` — Most recent full audit.
