// ============================================================
//  Policy Hierarchy — Order of Precedence (canonical)
//
//  Every Crafters Market policy references this same hierarchy.
//  Locked as canonical in iter413v4 (Final Legal Consistency
//  Audit, 2026-06-30). This is the single source of truth for
//  precedence ordering across every document in the Trust &
//  Policy Center.
//
//  Reading rules:
//   - Applicable Law always trumps every contract term.
//   - The Terms of Service is the foundational contract that
//     every User accepts.
//   - The Maker Agreement is inserted between the Terms and the
//     other Marketplace Policies only for seller-specific
//     issues. For non-seller (Buyer / general) issues, the
//     Marketplace Policies control.
//   - Marketplace Policies (Buyer Protection, Returns, Shipping,
//     Privacy, Cookies, Prohibited Items, Community Guidelines,
//     IP/DMCA, Fee & Pricing, Accessibility) are the topic-
//     specific rules. Where a topic-specific policy provides
//     more detail, that detail controls within its topic.
//   - Maker Shop Policies must not conflict with anything above.
//   - Order-specific agreements bind only that Order.
//
//  Version 1.1 · 2026-06-30
// ============================================================

export const POLICY_HIERARCHY = [
  {
    level: 1,
    label: "Applicable Law",
    note: "Federal, state, and local law of the jurisdiction where the User resides or where the Order is fulfilled. Non-waivable consumer-protection rights always govern.",
  },
  {
    level: 2,
    label: "Terms of Service",
    slug: "terms",
    note: "The foundational contract between every User and the Platform.",
  },
  {
    level: 3,
    label: "Maker Agreement (seller-specific issues only)",
    slug: "maker-agreement",
    note: "For issues relating to Maker activity (listings, payouts, seller conduct, seller-side IP, exclusivity, taxes), the Maker Agreement is more specific than the topic-level Marketplace Policies and controls within its subject-matter scope. For non-seller (Buyer or general) issues, the Marketplace Policies control.",
  },
  {
    level: 4,
    label: "Marketplace Policies",
    note: "Topic-specific policies: Buyer Protection, Returns & Refunds, Shipping & Logistics, Privacy, Cookies, Prohibited Items, Community Guidelines, Intellectual Property & DMCA, Fee & Pricing, Accessibility Statement.",
  },
  {
    level: 5,
    label: "Maker Shop Policies",
    note: "A Maker's own published Shop Policies for their Listings. Must not conflict with anything above; conflicts are unenforceable to the extent of the conflict.",
  },
  {
    level: 6,
    label: "Order-Specific Agreements",
    note: "Terms agreed to at checkout or in messaging for a specific Order (e.g., custom order specifications, agreed processing time). Bind only that Order.",
  },
];
