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

import { POLICY_EFFECTIVE_DATE } from "./effectiveDate";

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
    version: "2.3",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "The foundational contract between every User and Crafters Market. Governs eligibility, accounts, fees, prohibited uses, moderation, disclaimers, liability, disputes, AI use, dispute resolution, and electronic signatures.",
    related: ["maker-agreement", "buyer-protection", "privacy", "prohibited-items", "fee-pricing", "ip-dmca"],
    revision_history: [
      { version: "2.3", date: "2026-06-30", summary: "Legal-hardening pass: added §14a Electronic Signatures & Acceptance (E-SIGN / UETA). Deployed effective-date deployment hook — the effective date is now sourced from REACT_APP_POLICY_EFFECTIVE_DATE at build time rather than hardcoded per policy." },
      { version: "2.2", date: "2026-06-30", summary: "Legal-review pass (Rocket Lawyer): §5 payout holds tied to Stripe lifecycle + limited operational triggers; §11 adds gross-negligence + willful-misconduct carve-out; §12 replaced placeholder with two-tier informal-then-arbitration structure (30-day informal + AAA arbitration + class-action waiver + small-claims carve-out + 30-day opt-out)." },
      { version: "2.1", date: "2026-06-30", summary: "Added §6a AI Use (Creator-Owned AI Policy): Operational AI (search, recommendations, ads, SEO, translations, listing optimization) is allowed under the content license; AI Model Training on Maker Content is opt-in only, never a condition of marketplace access." },
      { version: "2.0", date: "2026-06-30", summary: "Marketplace-model rewrite. Adds Maker/Buyer split, marketplace-facilitator tax section, expanded moderation & appeals references, limitation of liability, indemnity, dispute-resolution framework." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Terms (short-form, retail framing)." },
    ],
    keywords: ["terms", "tos", "agreement", "eligibility", "accounts", "liability", "arbitration", "class action", "small claims", "opt out", "governing law", "washington", "king county", "moderation", "termination", "indemnify", "gross negligence", "willful misconduct", "taxes", "marketplace facilitator", "ai", "artificial intelligence", "creator-owned ai", "ai training", "operational ai", "payout hold", "stripe"],
    attorney_notes: [
      { section: "Section 5 — Fees, Payments & Payouts", note: "IMPLEMENTED per Rocket Lawyer: payout holds now tied to Stripe lifecycle + limited operational triggers (fraud, chargeback, identity verification, legal compliance, active investigation). Confirm on final sign-off." },
      { section: "Section 6a — AI Use (Creator-Owned AI Policy)", note: "IMPLEMENTED. Confirm the Operational AI vs. AI Model Training split reads correctly and aligns with company philosophy." },
      { section: "Section 8 — Moderation, Suspension & Termination", note: "Confirm 'reasonable notice' standard is appropriate; consider carve-outs for emergency action." },
      { section: "Section 10 — Limitation of Liability", note: "Review liability cap ($100 or 12-mo commission floor). Confirm enforceability under Washington law and applicable consumer-protection statutes." },
      { section: "Section 11 — Indemnification", note: "IMPLEMENTED gross-negligence + willful-misconduct carve-out per Rocket Lawyer." },
      { section: "Section 12 — Dispute Resolution", note: "ENGINEERING DEFAULT — RECONFIRM WITH COUNSEL. Implemented two-tier: 30-day informal → AAA mandatory arbitration + class-action waiver + small-claims carve-out + injunctive-relief carve-out + 30-day opt-out. Confirm AAA (vs JAMS), Consumer Arbitration Rules (vs Commercial), King County WA seat, and 30-day opt-out window are all counsel-approved before publication." },
      { section: "Section 13 — Marketplace-Facilitator Taxes", note: "Confirm current marketplace-facilitator obligations across state/VAT/GST regimes; align with Fee & Pricing Policy. Operational verification with payment processor tracked separately." },
      { section: "Effective Date", note: "ENGINEERING DEFAULT — set to actual production go-live date at deployment. Do not use a pre-baked calendar date." },
    ],
    implementation_notes: [
      "Effective date will be set at production launch — do not hardcode a specific date until deployment.",
      "Wire link to Fee & Pricing Policy once that page is published.",
      "Verify Stripe Connected Account Agreement URL still resolves.",
      "Section 6a AI Use cross-references Maker Agreement §10a and Privacy Policy §11 — verify anchors match after any future renumbering.",
      "Section 12 opt-out inbox (policy@craftersmarket.org) must be provisioned before launch and monitored during the opt-out window.",
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
      "Accessibility Statement",
    ],
  },

  {
    slug: "privacy",
    section_id: "privacy",
    title: "Privacy Policy",
    short_title: "Privacy",
    category: "core",
    version: "3.2",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "How Crafters Market collects, uses, shares, and protects personal information across Buyer, Maker, and visitor interactions — including our Creator-Owned AI Policy and California Privacy Rights (CCPA / CPRA).",
    related: ["cookies", "terms", "maker-agreement", "buyer-protection"],
    revision_history: [
      { version: "3.2", date: "2026-06-30", summary: "Legal-hardening pass: added §6a California Privacy Rights (CCPA/CPRA) — right to know/delete/correct/limit SPI/opt-out of sharing/non-discrimination/agent-authorization/appeals. Wired effective_date through the effective-date deployment hook." },
      { version: "3.1", date: "2026-06-30", summary: "Rewrote §11 as the Creator-Owned AI Policy. Distinguishes Operational AI (allowed under license) from AI Model Training (opt-in only, never a condition of marketplace access). Cross-references ToS §6a and Maker Agreement §10a." },
      { version: "3.0", date: "2026-06-30", summary: "Marketplace rewrite. Adds data-role split (Platform vs. Maker as controller), cross-border transfers, rights request workflow, retention schedule, vendor list appendix." },
      { version: "2.0", date: "2026-02-15", summary: "GA4 + GSC vendor additions." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Privacy Policy." },
    ],
    keywords: ["privacy", "data", "personal information", "gdpr", "ccpa", "cookies", "tracking", "retention", "rights", "opt out", "data subject", "cross border", "ai", "artificial intelligence", "creator-owned ai", "ai training", "operational ai", "machine learning"],
    attorney_notes: [
      { section: "Data Roles", note: "Confirm the Platform-as-controller vs. Maker-as-controller split for Order data. Consider a joint-controller disclosure if applicable." },
      { section: "§11 AI & Automated Services (Creator-Owned AI Policy)", note: "NEW — confirm the plain-English description of Operational AI vs. AI Model Training aligns with GDPR Art. 22 (automated decision-making) disclosure requirements if EU/UK audience opens. Confirm the aggregated/de-identified-data carve-out is defensible." },
      { section: "State Privacy Rights", note: "Confirm applicability of CCPA/CPRA, VCDPA, CPA, CTDPA, UCPA and add state-specific disclosures if audience expands." },
      { section: "International Transfers", note: "If EU/UK users become material, add SCCs / UK IDTA disclosure and EU representative." },
      { section: "Children's Privacy", note: "Confirm COPPA compliance; consider explicit age gate on account creation." },
    ],
    implementation_notes: [
      "Wire Privacy at a Glance summary page from the Trust Center.",
      "Publish DSAR intake path (email + form) and document SLAs internally.",
      "Confirm vendor list is current (Stripe, Google, Meta, Pinterest, TikTok, Sentry, etc.).",
      "Coordinate §11 wording with any future opt-in UI for an AI Training Program.",
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
    effective_date: POLICY_EFFECTIVE_DATE,
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
    version: "3.3",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "The seller contract between each Maker and Crafters Market. Covers eligibility, listings, IP, AI, fees, Stripe payouts (with limited payout-hold triggers), privacy roles, FTC compliance for reviews and product claims, exclusivity, moderation, appeals, termination, dispute resolution (mirrors Terms §12), survival, and electronic signatures.",
    related: ["terms", "prohibited-items", "buyer-protection", "shipping", "returns", "ip-dmca", "fee-pricing", "community-guidelines"],
    revision_history: [
      { version: "3.3", date: "2026-06-30", summary: "Legal-hardening pass: fully populated §25 Standard Contract Provisions (severability, waiver, assignment, notices, entire agreement); added §26 Survival; added §27 Maker-specific Governing Law & Dispute Resolution mirroring ToS §12 (30-day informal → AAA arbitration + class-action waiver + small-claims carve-out + injunctive-relief carve-out + 30-day opt-out); added §28 Electronic Signatures & Acceptance (E-SIGN / UETA). Maker Agreement now stands on its own without requiring incorporation-by-reference of ToS §12." },
      { version: "3.2", date: "2026-06-30", summary: "Legal-review pass (Rocket Lawyer): §14 payout holds tied to Stripe lifecycle + limited operational triggers; §19 clarified Platform-vs-Maker data-controller role split; added §19a Truthful Advertising, Product Claims & Reviews (FTC Compliance — Made in USA, no fake or undisclosed-incentivized reviews, health-claim substantiation)." },
      { version: "3.1", date: "2026-06-30", summary: "Added §10a AI Use (Creator-Owned AI Policy). Distinguishes Operational AI (allowed under §10 content license) from AI Model Training (opt-in only, never a condition of marketplace access)." },
      { version: "3.0", date: "2026-06-30", summary: "Comprehensive expansion. Adds Stripe Connected Account terms, exclusivity clarifications, IP licensing, appeals process reference, marketplace-facilitator tax reference." },
      { version: "2.0", date: "2026-02-01", summary: "Added Stripe onboarding and payout schedule." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Maker Agreement." },
    ],
    keywords: ["maker", "seller", "agreement", "listings", "fees", "commission", "stripe", "payout", "payout hold", "exclusivity", "handmade", "ip", "content license", "onboarding", "verification", "ai", "creator-owned ai", "ftc", "made in usa", "reviews", "fake reviews", "endorsement", "product claims", "data controller", "buyer data"],
    attorney_notes: [
      { section: "Content License (§10)", note: "Confirm scope of Platform license to use Maker photos across connected surfaces (Google, Meta, Pinterest, TikTok). Consider survival-on-termination language." },
      { section: "AI Use (§10a — Creator-Owned AI Policy)", note: "IMPLEMENTED. Confirm the Operational AI vs. AI Model Training split reads correctly and that opt-in-only + no-penalty-for-declining meet counsel's requirements." },
      { section: "Exclusivity", note: "Confirm non-exclusivity is preserved; add clarification that Makers may sell elsewhere but must not link off-platform inside Listings." },
      { section: "Payments & Stripe Connect (§14)", note: "IMPLEMENTED per Rocket Lawyer: payout holds now tied to Stripe lifecycle + limited operational triggers." },
      { section: "Privacy Roles (§19)", note: "IMPLEMENTED clarified Platform-vs-Maker data-controller split. Confirm this matches the framing in the Privacy Policy §2 and Terms §6." },
      { section: "Truthful Advertising, Product Claims & Reviews (§19a — FTC)", note: "IMPLEMENTED. Confirm the Made-in-USA standard, endorsement/incentivized-review disclosures, and health-claim substantiation language track current FTC guidance." },
      { section: "Termination & Payout Holds", note: "Confirm right to hold funds pending dispute resolution; align with Buyer Protection Policy." },
    ],
    implementation_notes: [
      "Add opt-in checkbox capture (P3 post-launch backlog): DB record {maker_id, agreement_version, accepted_at, ip_address, user_agent}. Design locked in maker-agreement-acceptance-design.md.",
      "Ensure version bumps re-prompt Makers for acceptance.",
      "Effective date will be set at production launch — do not hardcode a specific date until deployment.",
    ],
    cross_ref_checklist: [
      "Terms of Service",
      "Prohibited Items Policy",
      "Buyer Protection Policy",
      "Shipping & Logistics Policy",
      "Returns & Refunds Policy",
      "Intellectual Property & DMCA Policy",
      "Fee & Pricing Policy",
      "Community Guidelines",
      "Privacy Policy",
    ],
  },

  {
    slug: "buyer-protection",
    section_id: "buyer-protection",
    title: "Buyer Protection Policy",
    short_title: "Buyer Protection",
    category: "core",
    version: "1.0",
    effective_date: POLICY_EFFECTIVE_DATE,
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
    version: "3.1",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "How returns, exchanges, and refunds work on Crafters Market. Sets marketplace floors (Shop Policies cannot override the Buyer Protection Policy) and defines when Marketplace Assistance applies.",
    related: ["buyer-protection", "shipping", "maker-agreement", "terms"],
    revision_history: [
      { version: "3.1", date: "2026-06-30", summary: "Legal-hardening pass: §7 Lost Shipments — added marketplace floor clarifying Shop Policies may not override the Buyer Protection Policy for non-delivery, materially-not-as-described, or damage in transit." },
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
    effective_date: POLICY_EFFECTIVE_DATE,
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
    effective_date: POLICY_EFFECTIVE_DATE,
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
    version: "3.1",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "Conduct standards for messaging, reviews, journals, and community spaces on Crafters Market. Includes FTC-aligned rules for review authenticity and endorsement disclosure.",
    related: ["terms", "maker-agreement", "prohibited-items", "buyer-protection"],
    revision_history: [
      { version: "3.1", date: "2026-06-30", summary: "Legal-review pass: rewrote §5 Reviews with FTC compliance rules (no fake reviews, no undisclosed incentivized reviews, material-connection disclosure, no AI-generated reviews)." },
      { version: "3.0", date: "2026-06-30", summary: "Original policy expressing Crafters Market values (not adapted from another marketplace). Adds review authenticity rules, harassment & discrimination protections, dispute-etiquette guidance." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Community Guidelines." },
    ],
    keywords: ["community", "conduct", "harassment", "discrimination", "reviews", "fake reviews", "endorsement", "incentivized reviews", "ftc", "messages", "showcase", "spam", "safety", "reporting"],
    attorney_notes: [
      { section: "Review Authenticity (§5, FTC)", note: "IMPLEMENTED per Rocket Lawyer: fake reviews, undisclosed-incentivized reviews, material-connection disclosure, and AI-generated review rules. Confirm alignment with current FTC endorsement guides." },
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
    version: "2.0",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "How to report copyright infringement (DMCA), how counter-notices work, how trademark and other IP claims are handled, and how repeat-infringer accounts are handled on Crafters Market.",
    related: ["terms", "maker-agreement", "prohibited-items", "community-guidelines"],
    revision_history: [
      { version: "2.0", date: "2026-06-30", summary: "Legal-review pass: expanded from stub to full DMCA safe-harbor policy. Added Designated DMCA Agent contact, formal notice requirements per 17 U.S.C. § 512, counter-notice procedure with 10-14 business day window, § 512(i) repeat-infringer policy (3 substantiated notices / 12 months → permanent removal), parallel trademark process, rights-holder cooperation clause." },
      { version: "1.0", date: "2026-06-30", summary: "Initial published DMCA framework (stub)." },
    ],
    keywords: ["dmca", "copyright", "trademark", "infringement", "takedown", "counter notice", "designated agent", "repeat infringer", "safe harbor", "512", "u.s. copyright office"],
    attorney_notes: [
      { section: "Designated Agent Registration", note: "OPERATIONAL BLOCKER — Register Crafters Market's Designated DMCA Agent with the U.S. Copyright Office before public launch. Cost: ~$6 (3-year filing). Publish postal address on the policy page once registered." },
      { section: "Counter-Notice Procedure", note: "IMPLEMENTED 10–14 business day put-back window per 17 U.S.C. § 512." },
      { section: "Repeat-Infringer Threshold", note: "IMPLEMENTED 3 substantiated notices / 12 months → permanent removal. Confirm counsel is comfortable with the threshold." },
      { section: "Trademark", note: "IMPLEMENTED parallel-but-distinct trademark takedown process. DMCA covers copyright only." },
    ],
    implementation_notes: [
      "Register Designated DMCA Agent with U.S. Copyright Office (dmca.copyright.gov/osp) before launch — this is an operational task, not just documentation.",
      "Provision dmca@craftersmarket.org inbox and route to Legal/Trust & Safety.",
      "Publish designated-agent postal address on the policy page once registration is complete.",
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
    slug: "accessibility",
    section_id: "accessibility",
    title: "Accessibility Statement",
    short_title: "Accessibility",
    category: "trust",
    policy_type: "commitment",
    version: "1.0",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "Crafters Market's commitment to accessibility, the WCAG 2.1 Level AA standards we aim for, known limitations, how to report a barrier, and our approach to ongoing improvement.",
    related: ["terms", "privacy", "buyer-protection"],
    revision_history: [
      { version: "1.0", date: "2026-06-30", summary: "Initial Accessibility Statement per legal-review guidance. Includes commitment, WCAG 2.1 AA target, known limitations, barrier-report path (accessibility@craftersmarket.org), ongoing-improvement pledge, and formal-legal-frameworks note." },
    ],
    keywords: ["accessibility", "wcag", "ada", "section 508", "screen reader", "keyboard", "contrast", "alt text", "captions", "disability", "accommodation"],
    attorney_notes: [
      { section: "Framework References (ADA, Section 508)", note: "Confirm the statement's non-warranty framing is defensible. Confirm we should not commit to a specific WCAG 2.1 AA conformance level (vs. 'aim for') in this Founding Access v1 phase." },
    ],
    implementation_notes: [
      "Provision accessibility@craftersmarket.org inbox and route to Engineering + Support before launch.",
      "Add Accessibility link to Trust Center + Legal Library nav.",
      "Add annual accessibility review to the quarterly-review cadence.",
    ],
    cross_ref_checklist: [
      "Terms of Service",
      "Privacy Policy",
      "Trust Center",
    ],
  },
  {
    slug: "marketplace-promise",
    section_id: "marketplace-promise",
    title: "Our Marketplace Promise",
    short_title: "Marketplace Promise",
    category: "trust",
    policy_type: "values",
    version: "1.0",
    effective_date: POLICY_EFFECTIVE_DATE,
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
    effective_date: POLICY_EFFECTIVE_DATE,
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
