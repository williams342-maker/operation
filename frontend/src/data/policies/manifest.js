// ============================================================
//  Policy Manifest — Crafters Market Trust & Policy Center v1
//
//  This manifest describes every policy in the Trust & Policy
//  Center. It is the single source of truth for:
//   - Slugs and URL paths (/policies/:slug)
//   - Version numbers, effective/updated dates
//   - Revision history
//   - Related policies (cross-references)
//   - Attorney Review Notes, Implementation Notes,
//     Cross-Reference Checklist (internal appendices)
//   - Search keywords for the /trust search index
//
//  The full body text of each policy remains in
//  src/pages/PolicyPage.jsx (SECTIONS array) and is referenced
//  here by section_id. This keeps the legacy /policy#anchor
//  URLs working while enabling per-doc /policies/:slug pages.
//
//  Version 1.0 · 2026-06-30
// ============================================================

export const POLICY_CATEGORIES = {
  core: "Core Marketplace Policies",
  trust: "Marketplace Trust Pages",
  operational: "Operational Policies",
};

export const POLICIES = [
  // ---------------------- CORE POLICIES ----------------------
  {
    slug: "terms",
    section_id: "terms",
    title: "Terms of Service",
    short_title: "Terms",
    category: "core",
    version: "2.0",
    effective_date: "Pending legal sign-off",
    last_updated: "2026-06-30",
    description:
      "The foundational contract between every User and Crafters Market. Governs eligibility, accounts, fees, prohibited uses, moderation, disclaimers, liability, disputes.",
    related: ["maker-agreement", "buyer-protection", "privacy", "prohibited-items", "fee-pricing", "ip-dmca"],
    revision_history: [
      { version: "2.0", date: "2026-06-30", summary: "Marketplace-model rewrite. Adds Maker/Buyer split, marketplace-facilitator tax section, expanded moderation & appeals references, limitation of liability, indemnity, dispute-resolution framework." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Terms (short-form, retail framing)." },
    ],
    keywords: ["terms", "tos", "agreement", "eligibility", "accounts", "liability", "arbitration", "governing law", "washington", "moderation", "termination", "indemnify", "taxes", "marketplace facilitator"],
    attorney_notes: [
      { section: "Section 5 — Fees, Payments & Payouts", note: "Confirm Stripe Connected Account references and any hold/reserve language matches current Stripe Services Agreement." },
      { section: "Section 8 — Moderation, Suspension & Termination", note: "Confirm 'reasonable notice' standard is appropriate; consider carve-outs for emergency action." },
      { section: "Section 10 — Limitation of Liability", note: "Review liability cap ($100 or 12-mo commission floor). Confirm enforceability under Washington law and applicable consumer-protection statutes." },
      { section: "Section 11 — Indemnification", note: "Confirm mutuality expectations; consider carve-out for gross negligence or willful misconduct by Platform." },
      { section: "Section 12 — Dispute Resolution", note: "Decide whether to add mandatory arbitration + class-action waiver. Confirm King County, WA venue selection is defensible." },
      { section: "Section 13 — Marketplace-Facilitator Taxes", note: "Confirm current marketplace-facilitator obligations across state/VAT/GST regimes; align with Fee & Pricing Policy." },
    ],
    implementation_notes: [
      "Replace 'Pending legal sign-off' effective date once counsel approves.",
      "Wire link to Fee & Pricing Policy once that page is published.",
      "Verify Stripe Connected Account Agreement URL still resolves.",
    ],
    cross_ref_checklist: [
      "Maker Agreement",
      "Buyer Protection Policy",
      "Returns & Refunds Policy",
      "Shipping & Logistics Policy",
      "Prohibited Items Policy",
      "Community Guidelines",
      "Privacy Policy",
      "Cookie Policy",
      "Intellectual Property & DMCA Policy",
      "Fee & Pricing Policy",
    ],
  },

  {
    slug: "privacy",
    section_id: "privacy",
    title: "Privacy Policy",
    short_title: "Privacy",
    category: "core",
    version: "3.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "How Crafters Market collects, uses, shares, and protects personal information across Buyer, Maker, and visitor interactions.",
    related: ["cookies", "terms", "maker-agreement", "buyer-protection"],
    revision_history: [
      { version: "3.0", date: "2026-06-30", summary: "Marketplace rewrite. Adds data-role split (Platform vs. Maker as controller), cross-border transfers, rights request workflow, retention schedule, vendor list appendix." },
      { version: "2.0", date: "2026-02-15", summary: "GA4 + GSC vendor additions." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Privacy Policy." },
    ],
    keywords: ["privacy", "data", "personal information", "gdpr", "ccpa", "cookies", "tracking", "retention", "rights", "opt out", "data subject", "cross border"],
    attorney_notes: [
      { section: "Data Roles", note: "Confirm the Platform-as-controller vs. Maker-as-controller split for Order data. Consider a joint-controller disclosure if applicable." },
      { section: "State Privacy Rights", note: "Confirm applicability of CCPA/CPRA, VCDPA, CPA, CTDPA, UCPA and add state-specific disclosures if audience expands." },
      { section: "International Transfers", note: "If EU/UK users become material, add SCCs / UK IDTA disclosure and EU representative." },
      { section: "Children's Privacy", note: "Confirm COPPA compliance; consider explicit age gate on account creation." },
    ],
    implementation_notes: [
      "Wire Privacy at a Glance summary page from the Trust Center.",
      "Publish DSAR intake path (email + form) and document SLAs internally.",
      "Confirm vendor list is current (Stripe, Google, Meta, Pinterest, TikTok, Sentry, etc.).",
    ],
    cross_ref_checklist: [
      "Cookie Policy",
      "Terms of Service",
      "Maker Agreement",
      "Buyer Protection Policy",
    ],
  },

  {
    slug: "cookies",
    section_id: "cookies",
    title: "Cookie Policy",
    short_title: "Cookies",
    category: "core",
    version: "3.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "What cookies and similar technologies Crafters Market uses, why, and how you can control them.",
    related: ["privacy", "terms"],
    revision_history: [
      { version: "3.0", date: "2026-06-30", summary: "Marketplace rewrite. Adds category tables (strictly necessary, functional, analytics, advertising), retention windows, vendor mapping." },
      { version: "2.0", date: "2026-02-15", summary: "Added GA4 + Meta Pixel + TikTok Pixel disclosures." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Cookie Policy." },
    ],
    keywords: ["cookies", "tracking", "pixels", "analytics", "advertising", "opt out", "preferences", "consent", "beacon", "local storage"],
    attorney_notes: [
      { section: "Consent Model", note: "Confirm consent model matches jurisdictions with strict consent regimes (EU, UK). If launching in EU, ban prior-consent cookies until Preference Center opt-in exists." },
      { section: "Retention", note: "Confirm retention windows per cookie category are accurate and align with vendor defaults." },
    ],
    implementation_notes: [
      "Build Cookie Preference Center (P1 backlog, post-Phase D).",
      "Verify each vendor listed in the policy still fires and is documented.",
    ],
    cross_ref_checklist: [
      "Privacy Policy",
      "Terms of Service",
    ],
  },

  {
    slug: "maker-agreement",
    section_id: "maker-agreement",
    title: "Maker Agreement",
    short_title: "Maker Agreement",
    category: "core",
    version: "3.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "The seller contract between each Maker and Crafters Market. Covers eligibility, listings, IP, fees, Stripe payouts, exclusivity, moderation, appeals, and termination.",
    related: ["terms", "prohibited-items", "buyer-protection", "shipping", "returns", "ip-dmca", "fee-pricing"],
    revision_history: [
      { version: "3.0", date: "2026-06-30", summary: "Comprehensive expansion. Adds Stripe Connected Account terms, exclusivity clarifications, IP licensing, appeals process reference, marketplace-facilitator tax reference." },
      { version: "2.0", date: "2026-02-01", summary: "Added Stripe onboarding and payout schedule." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Maker Agreement." },
    ],
    keywords: ["maker", "seller", "agreement", "listings", "fees", "commission", "stripe", "payout", "exclusivity", "handmade", "ip", "content license", "onboarding", "verification"],
    attorney_notes: [
      { section: "Content License", note: "Confirm scope of Platform license to use Maker photos across connected surfaces (Google, Meta, Pinterest, TikTok). Consider survival-on-termination language." },
      { section: "Exclusivity", note: "Confirm non-exclusivity is preserved; add clarification that Makers may sell elsewhere but must not link off-platform inside Listings." },
      { section: "Stripe Terms", note: "Confirm current Stripe Services Agreement + Connected Account Agreement references." },
      { section: "Termination & Payout Holds", note: "Confirm right to hold funds pending dispute resolution; align with Buyer Protection Policy." },
    ],
    implementation_notes: [
      "Add opt-in checkbox capture (P5 backlog): DB record {maker_id, agreement_version, accepted_at}.",
      "Ensure version bumps re-prompt Makers for acceptance.",
    ],
    cross_ref_checklist: [
      "Terms of Service",
      "Prohibited Items Policy",
      "Buyer Protection Policy",
      "Shipping & Logistics Policy",
      "Returns & Refunds Policy",
      "Intellectual Property & DMCA Policy",
      "Fee & Pricing Policy",
    ],
  },

  {
    slug: "buyer-protection",
    section_id: "buyer-protection",
    title: "Buyer Protection Policy",
    short_title: "Buyer Protection",
    category: "core",
    version: "1.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "When and how Crafters Market steps in to protect Buyers if an Order does not arrive, arrives significantly not as described, or a Maker becomes unresponsive.",
    related: ["returns", "shipping", "terms", "maker-agreement", "community-guidelines"],
    revision_history: [
      { version: "1.0", date: "2026-06-30", summary: "Initial policy establishing Marketplace Assistance framework, eligibility windows, escalation path, and marketplace-funded refunds where appropriate." },
    ],
    keywords: ["buyer protection", "refund", "not received", "not as described", "unresponsive maker", "dispute", "marketplace assistance", "escalation", "chargeback"],
    attorney_notes: [
      { section: "Marketplace-Funded Refunds", note: "Confirm accounting treatment and disclosure of when the Platform funds a refund vs. recovering from the Maker." },
      { section: "Coverage Exclusions", note: "Confirm exclusion list (buyer's remorse, address errors, custom orders per spec) is defensible; align with Returns & Refunds Policy." },
      { section: "Chargeback Interaction", note: "Confirm interaction with card-network chargebacks and Stripe dispute flow; policy should not conflict with cardholder rights." },
    ],
    implementation_notes: [
      "Publish escalation email path (support@ or protection@).",
      "Internal SLA for first response (target: 1 business day).",
      "Build case portal (post-Phase D backlog).",
    ],
    cross_ref_checklist: [
      "Returns & Refunds Policy",
      "Shipping & Logistics Policy",
      "Terms of Service",
      "Maker Agreement",
      "Community Guidelines",
    ],
  },

  {
    slug: "returns",
    section_id: "returns",
    title: "Returns & Refunds Policy",
    short_title: "Returns & Refunds",
    category: "core",
    version: "3.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "How returns, exchanges, and refunds work on Crafters Market. Sets marketplace floors and defines when Marketplace Assistance applies.",
    related: ["buyer-protection", "shipping", "maker-agreement", "terms"],
    revision_history: [
      { version: "3.0", date: "2026-06-30", summary: "Marketplace-perspective rewrite. Removes retail assumptions; adds Maker Shop Policy floors, digital-product exceptions, custom-order exceptions." },
      { version: "2.0", date: "2026-02-01", summary: "Added digital download handling." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Returns Policy." },
    ],
    keywords: ["returns", "refunds", "exchanges", "damaged", "not as described", "custom orders", "digital downloads", "return window", "restocking"],
    attorney_notes: [
      { section: "Consumer-Right Overrides", note: "Confirm jurisdictions with mandatory return rights (EU distance-selling, UK Consumer Rights Act) if audience expands." },
      { section: "Digital Products", note: "Confirm no-return default for digital downloads once accessed; consider limited exceptions." },
      { section: "Custom Orders", note: "Confirm no-return default when Order is fulfilled to Buyer's spec; align with Buyer Protection exclusions." },
    ],
    implementation_notes: [
      "Ensure Maker Shop Policy Builder (post-Phase D) enforces marketplace floors.",
      "Add Return Merchandise Authorization (RMA) workflow when case portal is built.",
    ],
    cross_ref_checklist: [
      "Buyer Protection Policy",
      "Shipping & Logistics Policy",
      "Maker Agreement",
      "Terms of Service",
    ],
  },

  {
    slug: "shipping",
    section_id: "shipping",
    title: "Shipping & Logistics Policy",
    short_title: "Shipping",
    category: "core",
    version: "3.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "How shipping works on Crafters Market. Makers ship their own Orders; the Platform is not a carrier, warehouse, or fulfillment company.",
    related: ["returns", "buyer-protection", "maker-agreement", "terms"],
    revision_history: [
      { version: "3.0", date: "2026-06-30", summary: "Marketplace-perspective rewrite. Removes retail warehouse framing; adds carrier neutrality, risk-of-loss allocation, international shipping & customs, lost/damaged handling." },
      { version: "2.0", date: "2026-02-01", summary: "Added international shipping guidance." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Shipping Policy." },
    ],
    keywords: ["shipping", "carrier", "usps", "ups", "fedex", "international", "customs", "duties", "risk of loss", "processing time", "tracking", "lost", "damaged"],
    attorney_notes: [
      { section: "Risk of Loss", note: "Confirm risk-of-loss transfer at carrier acceptance vs. delivery; consumer-law overrides in some jurisdictions." },
      { section: "International & Customs", note: "Confirm Buyer-of-record for import duties; disclose potential customs seizure risk for restricted materials." },
    ],
    implementation_notes: [
      "Wire Shipping Profile Manager to enforce processing-time floors (post-Phase D).",
      "Consider carrier integrations for label purchase (post-Phase D).",
    ],
    cross_ref_checklist: [
      "Returns & Refunds Policy",
      "Buyer Protection Policy",
      "Maker Agreement",
      "Terms of Service",
    ],
  },

  {
    slug: "prohibited-items",
    section_id: "prohibited",
    title: "Prohibited Items Policy",
    short_title: "Prohibited Items",
    category: "core",
    version: "3.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "What may not be sold on Crafters Market. Categories are original to Crafters Market and reflect our curated-marketplace values.",
    related: ["terms", "maker-agreement", "community-guidelines", "ip-dmca"],
    revision_history: [
      { version: "3.0", date: "2026-06-30", summary: "Original policy rewrite (not modeled on Etsy). Adds AI-generated content rules, resale/drop-ship prohibitions, safety-regulated categories." },
      { version: "2.0", date: "2026-02-01", summary: "Added counterfeit + IP enforcement language." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Prohibited Items list." },
    ],
    keywords: ["prohibited", "banned", "counterfeit", "weapons", "drugs", "hazardous", "regulated", "resale", "drop shipping", "ai generated", "mass produced", "recall"],
    attorney_notes: [
      { section: "Regulated Categories", note: "Confirm compliance approach for food/consumables, cosmetics, CBD, batteries, and other regulated items if the marketplace expands into them." },
      { section: "AI-Generated Content", note: "Confirm disclosure requirements and whether AI-only listings are prohibited or merely disclosed." },
    ],
    implementation_notes: [
      "Wire Product Review Matrix (internal, post-Phase D) to categorize each item as Allowed / Allowed with Conditions / Manual Review / Prohibited.",
    ],
    cross_ref_checklist: [
      "Terms of Service",
      "Maker Agreement",
      "Community Guidelines",
      "Intellectual Property & DMCA Policy",
    ],
  },

  {
    slug: "community-guidelines",
    section_id: "community-guidelines",
    title: "Community Guidelines",
    short_title: "Community",
    category: "core",
    version: "3.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "Conduct standards for messaging, reviews, journals, and community spaces on Crafters Market.",
    related: ["terms", "maker-agreement", "prohibited-items", "buyer-protection"],
    revision_history: [
      { version: "3.0", date: "2026-06-30", summary: "Original policy expressing Crafters Market values (not adapted from another marketplace). Adds review authenticity rules, harassment & discrimination protections, dispute-etiquette guidance." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Community Guidelines." },
    ],
    keywords: ["community", "conduct", "harassment", "discrimination", "reviews", "messages", "showcase", "spam", "safety", "reporting"],
    attorney_notes: [
      { section: "Review Authenticity", note: "Confirm review-manipulation language aligns with FTC endorsement guides." },
      { section: "Protected Classes", note: "Confirm the enumerated list matches applicable federal and state civil-rights protections." },
    ],
    implementation_notes: [
      "Wire report-content flow to internal moderation queue.",
      "Ensure Community Guidelines link is present in messaging UI and review submission UI.",
    ],
    cross_ref_checklist: [
      "Terms of Service",
      "Maker Agreement",
      "Prohibited Items Policy",
      "Buyer Protection Policy",
    ],
  },

  // ---------------------- OPERATIONAL POLICIES ----------------------
  {
    slug: "ip-dmca",
    section_id: "ip",
    title: "Intellectual Property & DMCA Policy",
    short_title: "IP & DMCA",
    category: "operational",
    version: "1.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "How to report infringement, how counter-notices work, and how repeat-infringer accounts are handled on Crafters Market.",
    related: ["terms", "maker-agreement", "prohibited-items", "community-guidelines"],
    revision_history: [
      { version: "1.0", date: "2026-06-30", summary: "Initial published DMCA framework including designated agent, notice/counter-notice, repeat-infringer policy." },
    ],
    keywords: ["dmca", "copyright", "trademark", "infringement", "takedown", "counter notice", "designated agent", "repeat infringer"],
    attorney_notes: [
      { section: "Designated Agent", note: "Confirm designated DMCA agent registration with U.S. Copyright Office; publish agent contact." },
      { section: "Counter-Notice Procedure", note: "Confirm 10–14 business day put-back window aligns with 17 U.S.C. § 512." },
      { section: "Trademark", note: "Confirm parallel-but-distinct trademark takedown process (DMCA covers copyright only)." },
    ],
    implementation_notes: [
      "Register DMCA agent at U.S. Copyright Office.",
      "Publish designated-agent contact on the policy page.",
    ],
    cross_ref_checklist: [
      "Terms of Service",
      "Maker Agreement",
      "Prohibited Items Policy",
      "Community Guidelines",
    ],
  },

  // ---------------------- TRUST / VALUES DOCUMENTS ----------------------
  {
    slug: "marketplace-promise",
    section_id: "marketplace-promise",
    title: "Our Marketplace Promise",
    short_title: "Marketplace Promise",
    category: "trust",
    policy_type: "values",
    version: "1.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "Plain-language values statement describing what Buyers and Makers can expect from Crafters Market.",
    related: ["terms", "buyer-protection", "community-guidelines"],
    revision_history: [
      { version: "1.0", date: "2026-06-30", summary: "Initial values statement (non-legal)." },
    ],
    keywords: ["promise", "values", "trust", "handmade", "curated", "founding", "commitment"],
    attorney_notes: [
      { section: "Overall", note: "Non-legal values document. Confirm no promissory or warranty language that could create legal obligations beyond the Buyer Protection Policy." },
    ],
    implementation_notes: [
      "Featured prominently on /trust hub.",
    ],
    cross_ref_checklist: [
      "Terms of Service",
      "Buyer Protection Policy",
      "Community Guidelines",
    ],
  },

  {
    slug: "privacy-at-a-glance",
    section_id: "privacy-at-a-glance",
    title: "Privacy at a Glance",
    short_title: "Privacy Summary",
    category: "trust",
    policy_type: "summary",
    version: "1.0",
    effective_date: "2026-06-30",
    last_updated: "2026-06-30",
    description:
      "A plain-English summary of the Privacy Policy. The full Privacy Policy controls if there is any conflict.",
    related: ["privacy", "cookies"],
    revision_history: [
      { version: "1.0", date: "2026-06-30", summary: "Initial summary companion to Privacy Policy v3.0." },
    ],
    keywords: ["privacy", "summary", "at a glance", "quick", "plain english"],
    attorney_notes: [
      { section: "Overall", note: "Ensure the summary does not contradict the full Privacy Policy; include a 'Policy controls if conflict' disclaimer at the top of the doc." },
    ],
    implementation_notes: [
      "Link prominently from Trust Center and from account creation.",
    ],
    cross_ref_checklist: [
      "Privacy Policy",
      "Cookie Policy",
    ],
  },
];

// -------- Utility lookups --------
export function findPolicyBySlug(slug) {
  return POLICIES.find((p) => p.slug === slug) || null;
}

export function findPolicyBySectionId(id) {
  return POLICIES.find((p) => p.section_id === id) || null;
}

export function policiesByCategory(cat) {
  return POLICIES.filter((p) => p.category === cat);
}

export const CORE_POLICIES = policiesByCategory("core");
export const OPERATIONAL_POLICIES = policiesByCategory("operational");
export const TRUST_DOCUMENTS = policiesByCategory("trust");
