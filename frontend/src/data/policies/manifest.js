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
    version: "2.6",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "The foundational contract between every User and Crafters Market. Governs eligibility, accounts, fees, prohibited uses, moderation, disclaimers, liability, disputes, AI use, dispute resolution, and electronic signatures.",
    related: ["maker-agreement", "buyer-protection", "privacy", "prohibited-items", "fee-pricing", "ip-dmca"],
    revision_history: [
      { version: "2.6", date: "2026-06-30", summary: "Final Legal Consistency Audit (v4): §5 broadens payout-hold disclosure — 'Certain payout holds may be imposed directly by Stripe, payment networks, financial institutions, or regulatory authorities'; §12 opt-out language references the internal ledger while retaining email as the authoritative legal submission method. Cross-document policy hierarchy audit: Maker Agreement elevated above Marketplace Policies for seller-specific issues (canonical hierarchy in hierarchy.js updated to v1.1)." },
      { version: "2.5", date: "2026-06-30", summary: "Final legal-hardening pass (v3): §5 adds Communication-during-holds language (reasonable-efforts obligation subject to law/card-network/fraud/regulatory carve-outs); §12 Governing Law adds explicit non-waivable-rights carve-out; §14 clarifies material-change notice — 30 days for material fees/user-obligation changes; immediate effectiveness for security, legal, fraud-prevention, or urgent technical/operational changes; fee changes deferred to Fee & Pricing Policy §12 (60-day rule)." },
      { version: "2.4", date: "2026-06-30", summary: "Second-round legal-review pass: (a) §4 adds Maker responsibility for origin claims (Made in USA / Handmade / etc.) with Platform reservation of moderation authority; (b) §5 adds explicit clarification that some payout holds are Stripe- or card-network-controlled and Crafters Market cannot override or accelerate those; (c) §6a clarifies that the Operational AI license does NOT authorize the Platform or any third-party advertising provider to train commercial foundation models on Maker Content; (d) §12 adds remote-first arbitration language (video conference or written submissions by default; in-person hearing only if the arbitrator determines it necessary), while retaining King County, WA as the legal seat." },
      { version: "2.3", date: "2026-06-30", summary: "Legal-hardening pass: added §14a Electronic Signatures & Acceptance (E-SIGN / UETA). Deployed effective-date deployment hook — the effective date is now sourced from REACT_APP_POLICY_EFFECTIVE_DATE at build time rather than hardcoded per policy." },
      { version: "2.2", date: "2026-06-30", summary: "Legal-review pass (Rocket Lawyer): §5 payout holds tied to Stripe lifecycle + limited operational triggers; §11 adds gross-negligence + willful-misconduct carve-out; §12 replaced placeholder with two-tier informal-then-arbitration structure (30-day informal + AAA arbitration + class-action waiver + small-claims carve-out + 30-day opt-out)." },
      { version: "2.1", date: "2026-06-30", summary: "Added §6a AI Use (Creator-Owned AI Policy): Operational AI (search, recommendations, ads, SEO, translations, listing optimization) is allowed under the content license; AI Model Training on Maker Content is opt-in only, never a condition of marketplace access." },
      { version: "2.0", date: "2026-06-30", summary: "Marketplace-model rewrite. Adds Maker/Buyer split, marketplace-facilitator tax section, expanded moderation & appeals references, limitation of liability, indemnity, dispute-resolution framework." },
      { version: "1.0", date: "2025-12-01", summary: "Initial Beta Terms (short-form, retail framing)." },
    ],
    keywords: ["terms", "tos", "agreement", "eligibility", "accounts", "liability", "arbitration", "class action", "small claims", "opt out", "governing law", "washington", "king county", "moderation", "termination", "indemnify", "gross negligence", "willful misconduct", "taxes", "marketplace facilitator", "ai", "artificial intelligence", "creator-owned ai", "ai training", "operational ai", "payout hold", "stripe"],
    attorney_notes: [
      { section: "Section 5 — Fees, Payments & Payouts", note: "IMPLEMENTED per Rocket Lawyer + second-round review: payout holds tied to Stripe lifecycle + limited operational triggers (fraud, chargeback, identity verification, legal compliance, active investigation), plus explicit clarification that Stripe- and card-network-controlled holds cannot be overridden by Crafters Market." },
      { section: "Section 6a — AI Use (Creator-Owned AI Policy)", note: "IMPLEMENTED per Rocket Lawyer + second-round review: Operational AI vs. AI Model Training split, plus explicit statement that the Operational AI license does NOT authorize the Platform or any third-party advertising provider to train commercial foundation models on Maker Content." },
      { section: "Section 4 — Origin Claims (Made in USA / Handmade)", note: "IMPLEMENTED per second-round review: Makers are solely responsible for origin claims; Platform reserves moderation authority but does not independently verify every claim before publication. Cross-referenced to Maker Agreement §19a (FTC 'all or virtually all' standard)." },
      { section: "Section 8 — Moderation, Suspension & Termination", note: "Confirm 'reasonable notice' standard is appropriate; consider carve-outs for emergency action." },
      { section: "Section 10 — Limitation of Liability", note: "Second-round review recommends leaving the current cap in place ($100 or 12-mo commission floor). Confirm enforceability under Washington law and applicable consumer-protection statutes." },
      { section: "Section 11 — Indemnification", note: "IMPLEMENTED gross-negligence + willful-misconduct carve-out per Rocket Lawyer." },
      { section: "Section 12 — Dispute Resolution", note: "IMPLEMENTED per second-round review: two-tier 30-day informal → AAA mandatory arbitration + class-action waiver + small-claims carve-out + injunctive-relief carve-out + 30-day opt-out, PLUS remote-first arbitration (video / written submissions by default; in-person only if the arbitrator determines it necessary). King County WA remains the legal seat. Confirm AAA (vs JAMS), Consumer Arbitration Rules (vs Commercial), and 30-day opt-out window are counsel-approved before publication." },
      { section: "Section 13 — Marketplace-Facilitator Taxes", note: "Confirm current marketplace-facilitator obligations across state/VAT/GST regimes; align with Fee & Pricing Policy. Operational verification with payment processor tracked separately." },
      { section: "Effective Date", note: "ENGINEERING DEFAULT — set to actual production go-live date at deployment. Do not use a pre-baked calendar date." },
    ],
    implementation_notes: [
      "Effective date will be set at production launch — do not hardcode a specific date until deployment.",
      "Fee & Pricing Policy published at /policies/fee-pricing (v1.0, 2026-06-30) — the cross-reference in Terms §5 now resolves to the standalone document.",
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
    version: "3.4",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "How Crafters Market collects, uses, shares, and protects personal information across Buyer, Maker, and visitor interactions — including our Creator-Owned AI Policy, California Privacy Rights (CCPA / CPRA), and the current Third-Party Service Providers vendor inventory.",
    related: ["cookies", "terms", "maker-agreement", "buyer-protection"],
    revision_history: [
      { version: "3.4", date: "2026-06-30", summary: "Final Legal Consistency Audit (v4): §4a adds a concrete Third-Party Service Providers (Vendor Inventory) enumerating every production vendor — Stripe, Cloudflare, GA4, Google Ads, Google Search Console, Meta Ads/CAPI, Pinterest, TikTok, Sentry, Mailgun, Shippo, AI service providers (OpenAI/Anthropic/Google Gemini), and the Emergent Universal Key aggregator. Replaces the previous generic 'service providers' category with a named list that matches production." },
      { version: "3.3", date: "2026-06-30", summary: "Second-round legal-review pass: §10 International Transfers rewritten from EU/UK placeholder to U.S.-focused language (with forward-looking commitment to SCCs / equivalent safeguards before EEA/UK expansion); §11 clarifies that Operational AI does NOT authorize the Platform or any third-party advertising provider to train commercial foundation models on Maker Content." },
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
    version: "3.6",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "The seller contract between each Maker and Crafters Market. Covers eligibility, listings, IP, AI, fees, Stripe payouts (with limited payout-hold triggers), privacy roles, FTC compliance for reviews and product claims, exclusivity, moderation, appeals, termination, dispute resolution (mirrors Terms §12), survival, and electronic signatures.",
    related: ["terms", "prohibited-items", "buyer-protection", "shipping", "returns", "ip-dmca", "fee-pricing", "community-guidelines"],
    revision_history: [
      { version: "3.6", date: "2026-06-30", summary: "Final Legal Consistency Audit (v4): §10 User Content License rewritten to state (a) content ownership always remains with the Maker; (b) purpose limitation — operational license exists solely for operating and promoting the marketplace and does not authorize AI Model Training; (c) explicit license-termination-on-account-closure clause with limited carve-outs (legal compliance, completed transactions, archived backups, previously published marketing, cached third-party systems). §14 broadens payout-hold disclosure to include payment networks, financial institutions, and regulatory authorities. §27 opt-out language references the internal ledger while retaining email as the authoritative legal submission method." },
      { version: "3.5", date: "2026-06-30", summary: "Final legal-hardening pass (v3): §14 adds Communication-during-holds language (reasonable-efforts obligation subject to law/card-network/fraud/regulatory carve-outs); §27 Governing Law adds explicit non-waivable-rights carve-out (including any mandatory seller-protection statute in the Maker's home jurisdiction)." },
      { version: "3.4", date: "2026-06-30", summary: "Second-round legal-review pass: §10a clarifies that Operational AI does NOT authorize the Platform or any third-party advertising provider to train commercial foundation models on Maker Content; §14 adds explicit clarification that some payout holds are Stripe- or card-network-controlled and Crafters Market cannot override or accelerate those; §27 adds remote-first arbitration (video conference or written submissions by default), King County WA remains the legal seat." },
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
    version: "1.1",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "When and how Crafters Market steps in to protect Buyers if an Order does not arrive, arrives significantly not as described, or a Maker becomes unresponsive.",
    related: ["returns", "shipping", "terms", "maker-agreement", "community-guidelines"],
    revision_history: [
      { version: "1.1", date: "2026-06-30", summary: "Final legal-hardening pass (v3): §15 Limitations adds explicit non-waivable-rights carve-out — nothing in this Policy limits any mandatory consumer-protection right that cannot be waived by contract." },
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
    version: "3.4",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "How returns, exchanges, and refunds work on Crafters Market. Sets marketplace floors (Shop Policies cannot override the Buyer Protection Policy) and defines when Marketplace Assistance applies.",
    related: ["buyer-protection", "shipping", "maker-agreement", "terms"],
    revision_history: [
      { version: "3.4", date: "2026-06-30", summary: "Final Legal Consistency Audit (v4): §2 Policy Hierarchy updated to align with the canonical hierarchy in hierarchy.js v1.1 — Maker Agreement (seller-specific issues only) now sits between Terms of Service and Marketplace Policies." },
      { version: "3.3", date: "2026-06-30", summary: "Final legal-hardening pass (v3): §16 Policy Updates adds explicit non-waivable-rights carve-out — nothing in this Policy limits any mandatory consumer-protection right that cannot be waived by contract." },
      { version: "3.2", date: "2026-06-30", summary: "Second-round legal-review pass: §6 rewritten to distinguish transit-damage reporting (7-day recommendation, aids carrier investigation) from applicable return windows and Buyer Protection rights. Reporting recommendations do not shorten any return window or Buyer Protection entitlement." },
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
    version: "3.1",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "How shipping works on Crafters Market. Makers ship their own Orders; the Platform is not a carrier, warehouse, or fulfillment company.",
    related: ["returns", "buyer-protection", "maker-agreement", "terms"],
    revision_history: [
      { version: "3.1", date: "2026-06-30", summary: "Final legal-hardening pass (v3): §15 Shipping Policy Changes adds explicit non-waivable-rights carve-out — nothing in this Policy limits any mandatory consumer-protection right that cannot be waived by contract." },
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
    version: "3.3",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "What may not be sold on Crafters Market. Categories are original to Crafters Market and reflect our curated-marketplace values.",
    related: ["terms", "maker-agreement", "community-guidelines", "ip-dmca"],
    revision_history: [
      { version: "3.3", date: "2026-06-30", summary: "Final Legal Consistency Audit (v4): §14 AI-Generated Content re-scoped to replace subjective wording with concrete example lists — AI-assisted examples (grammar correction, SEO keyword suggestions, background removal, image cleanup, translation, title generation) and materially-AI-generated examples (AI-created artwork, AI-generated product images, AI-generated printable designs, AI-generated digital downloads). Examples replace numeric thresholds." },
      { version: "3.2", date: "2026-06-30", summary: "Final legal-hardening pass (v3): §14 AI-Generated Content rewritten to codify the AI-Assisted vs. Materially-AI-Generated distinction (no numeric percentage threshold — the test is whether the primary artistic expression or final product was substantially created by AI or by the Maker). Adds concrete examples and a required-disclosure rule for materially AI-generated Listings." },
      { version: "3.1", date: "2026-06-30", summary: "Second-round legal-review pass: §12 Fraud & Deceptive Listings adds an explicit responsibility-allocation clause — Makers are solely responsible for origin claims (Made in USA / Handmade / Handcrafted / Small-batch, etc.); Crafters Market may moderate but does not independently verify every claim before publication. Non-enforcement is not an endorsement of any specific claim." },
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
    slug: "fee-pricing",
    section_id: "fee-pricing",
    title: "Fee & Pricing Policy",
    short_title: "Fee & Pricing",
    category: "operational",
    version: "1.3",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "The single source of truth for Crafters Market commercial terms: commissions, listing fees, Crafters Plus subscription, payment-processing fees, off-site advertising fees, Promoted Listings, refund/chargeback handling, payout timing, and marketplace-facilitator sales tax. Prospective-only fee changes with 60-day advance notice for increases; reductions may take effect on a shorter window.",
    related: ["terms", "maker-agreement", "returns", "buyer-protection", "shipping"],
    revision_history: [
      { version: "1.3", date: "2026-06-30", summary: "Final Legal Consistency Audit (v4): §9 broadens payout-hold disclosure to include payment networks, financial institutions, and regulatory authorities (matches Terms §5 and Maker Agreement §14)." },
      { version: "1.2", date: "2026-06-30", summary: "Final legal-hardening pass (v3): §8 Refunds rewritten to expressly state that Stripe payment-processing fees are governed by the processor and may not be recoverable; the non-refundable Stripe portion is not credited back to the Maker balance. §9 adds Communication-during-holds language (reasonable-efforts obligation, subject to law/card-network/fraud/regulatory carve-outs). §12 adds Click-Acceptance for material fee increases — Makers may be required to click-accept the updated Policy before creating new Listings or receiving payouts on or after the effective date." },
      { version: "1.1", date: "2026-06-30", summary: "Second-round legal-review pass: §9 Payout Timing adds explicit clarification that some payout holds are Stripe- or card-network-controlled and Crafters Market cannot override or accelerate those; §12 Changes to This Policy updated — fee increases and new fees now require sixty (60) days' advance notice (was 30 days), and fee reductions / promotional pricing may take effect immediately or on a shorter window at Crafters Market's discretion." },
      { version: "1.0", date: "2026-06-30", summary: "Initial standalone Fee & Pricing Policy. Extracted from the legacy 'Makers Market — Fee & Commission Policy' block and consolidated with previously-scattered fee language from Terms §5 and Maker Agreement §14. Adds explicit refund/chargeback handling, payout-timing references, marketplace-facilitator tax section, prospective-change clause (30-day advance notice), currency/FX section, and Founding-Seller-benefits-as-discount-on-tier framing." },
    ],
    keywords: ["fees", "pricing", "commission", "listing fee", "subscription", "crafters plus", "founding seller", "stripe", "payment processing", "off-site ad fee", "off-site advertising", "promoted listing", "refund", "chargeback", "adjustment", "payout", "payout timing", "marketplace facilitator", "sales tax", "prospective change", "notice", "usd", "currency", "fx"],
    attorney_notes: [
      { section: "Section 2 — Fee Schedule", note: "Confirm the disclosed fee schedule (5%/4% commission, 3% processing, $0.20 listing fee, $12/mo Crafters Plus, 12% off-site ad fee, $5/week Promoted Listing) matches the operational rates configured in Stripe and the Maker Dashboard before launch." },
      { section: "Section 3 — Founding Seller Program", note: "Confirm the 'benefits as discount on top of the tier' framing. If a Founding Seller cohort receives a specific fixed commission percentage, add that to §3 explicitly for that cohort." },
      { section: "Section 6 — Off-Site Advertising Fee", note: "Confirm the 12% off-site-ad fee replaces (not stacks on) the tier commission on attributed sales. Confirm the attribution window language should be more specific (e.g., '30-day click attribution')." },
      { section: "Section 8 — Refunds, Chargebacks & Adjustments", note: "Confirm the retention of the Off-Site Advertising Fee on refunded attributed sales when the advertising cost has already been paid to the network. Confirm the 60-day Maker fee-dispute window." },
      { section: "Section 9 — Payout Timing", note: "IMPLEMENTED per second-round review: explicit statement that Stripe- and card-network-controlled holds cannot be overridden or accelerated by Crafters Market." },
      { section: "Section 10 — Marketplace-Facilitator Sales Tax", note: "Confirm marketplace-facilitator obligations across active state/VAT/GST regimes and align with Terms §13. Operational verification with the payment processor is tracked separately." },
      { section: "Section 12 — Changes to This Policy", note: "IMPLEMENTED per second-round review: 60-day advance notice for fee increases and new fees; fee reductions and promotional pricing may take effect immediately or on a shorter window. Confirm the 'continued use = acceptance' framing is enforceable in the jurisdictions where Makers reside." },
    ],
    implementation_notes: [
      "Effective date will be set at production launch — do not hardcode a specific date until deployment.",
      "Wire the Maker Dashboard 'Payout & Fees statement' referenced in Section 8 to the actual statement UI once built (post-Phase D backlog).",
      "Wire a Maker-facing notification hook that pushes any fee-increase or new-fee change to email and Maker Dashboard 60 days before the effective date (post-Phase D backlog). Fee reductions may be pushed on a shorter window (or immediately) without the 60-day gate.",
      "Ensure the 'first 10 free lifetime Listings' counter in the Maker Dashboard does not refresh when Listings are deleted (Free tier).",
      "Ensure the 'first 15 free monthly new Listings' counter resets on the 1st of each calendar month (Crafters Plus tier) and does not roll over.",
    ],
    cross_ref_checklist: [
      "Terms of Service",
      "Maker Agreement",
      "Buyer Protection Policy",
      "Returns & Refunds Policy",
      "Shipping & Logistics Policy",
    ],
  },

  {
    slug: "ip-dmca",
    section_id: "ip",
    title: "Intellectual Property & DMCA Policy",
    short_title: "IP & DMCA",
    category: "operational",
    version: "2.1",
    effective_date: POLICY_EFFECTIVE_DATE,
    last_updated: "2026-06-30",
    description:
      "How to report copyright infringement (DMCA), how counter-notices work, how trademark and other IP claims are handled, and how repeat-infringer accounts are handled on Crafters Market. Designated Agent registered with the U.S. Copyright Office (Registration DMCA-1074892).",
    related: ["terms", "maker-agreement", "prohibited-items", "community-guidelines"],
    revision_history: [
      { version: "2.1", date: "2026-06-30", summary: "Designated DMCA Agent registration with the U.S. Copyright Office confirmed (Registration DMCA-1074892, effective 2026-06-30). §2 updated with registered agent contact information. Cleared the pending-registration attorney note and implementation note." },
      { version: "2.0", date: "2026-06-30", summary: "Legal-review pass: expanded from stub to full DMCA safe-harbor policy. Added Designated DMCA Agent section, formal notice requirements per 17 U.S.C. § 512, counter-notice procedure with 10-14 business day window, § 512(i) repeat-infringer policy (3 substantiated notices / 12 months → permanent removal), parallel trademark process, rights-holder cooperation clause." },
      { version: "1.0", date: "2026-06-30", summary: "Initial published DMCA framework (stub)." },
    ],
    keywords: ["dmca", "copyright", "trademark", "infringement", "takedown", "counter notice", "designated agent", "repeat infringer", "safe harbor", "512", "u.s. copyright office"],
    attorney_notes: [
      { section: "Counter-Notice Procedure", note: "IMPLEMENTED 10–14 business day put-back window per 17 U.S.C. § 512." },
      { section: "Repeat-Infringer Threshold", note: "IMPLEMENTED 3 substantiated notices / 12 months → permanent removal. Confirm counsel is comfortable with the threshold." },
      { section: "Trademark", note: "IMPLEMENTED parallel-but-distinct trademark takedown process. DMCA covers copyright only." },
    ],
    implementation_notes: [
      "Route incoming email/postal DMCA notices to the Designated Agent (Micheal Williams) and to Legal/Trust & Safety.",
      "Maintain the U.S. Copyright Office registration renewal (3-year cycle) — next renewal due 2029.",
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
