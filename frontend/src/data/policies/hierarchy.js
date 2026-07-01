// ============================================================
//  Policy Hierarchy — Order of Precedence
//  Every Crafters Market policy references this same hierarchy.
//  Version 1.0 · 2026-06-30
// ============================================================

export const POLICY_HIERARCHY = [
  {
    level: 1,
    label: "Applicable Law",
    note: "Federal, state, and local law of the jurisdiction where the User resides or where the Order is fulfilled.",
  },
  {
    level: 2,
    label: "Terms of Service",
    slug: "terms",
    note: "The foundational contract between every User and the Platform.",
  },
  {
    level: 3,
    label: "Marketplace Policies",
    note: "Topic-specific policies (Buyer Protection, Returns, Shipping, Privacy, Cookies, Prohibited Items, Community Guidelines, IP/DMCA, Fee & Pricing, etc.).",
  },
  {
    level: 4,
    label: "Maker Agreement",
    slug: "maker-agreement",
    note: "The seller contract between each Maker and the Platform.",
  },
  {
    level: 5,
    label: "Maker Shop Policies",
    note: "A Maker's own published Shop Policies for their Listings. Must not conflict with the marketplace policies above.",
  },
  {
    level: 6,
    label: "Order-Specific Agreements",
    note: "Terms agreed to at checkout or in messaging for a specific Order (e.g., custom order specifications, agreed processing time).",
  },
];
