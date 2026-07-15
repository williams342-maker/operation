import React from "react";
import {
  FileText, Truck, RotateCcw, Wand2, Boxes, CreditCard, ShieldCheck,
  Lock, Ban, Copyright, AlertTriangle, UserX, Handshake, Users, Receipt,
} from "lucide-react";
import { POLICY_EFFECTIVE_DATE } from "./effectiveDate";

export const SUPPORT_EMAIL = "team@craftersmarket.org";

// ============================================================
//  Policy sections — every clause is written to be enforceable
//  AND protective: clear timelines, named parties, explicit
//  liability boundaries. Mirrors the structure in the user's
//  reference mockup (11 sections), wired to current site config.
// ============================================================
export const SECTIONS = [
  // iter413dl — "Our Marketplace Promise". Plain-language values
  // statement, sits above the legal documents. Non-legal.
  {
    id: "marketplace-promise",
    icon: Handshake,
    title: "Our Marketplace Promise",
    intro: "Crafters Market is a curated home for independent Makers and the people who love their work. This is our promise — the values you can expect from us, whether you\u2019re here to buy or to sell.",
    blocks: [
      {
        heading: "For Buyers",
        bullets: [
          "Discover original, handmade work from independent Makers.",
          "Clear Shop Policies published up front on every Maker\u2019s page.",
          "Transparent communication about processing times, custom work, and shipping.",
          "A marketplace committed to trust \u2014 no counterfeits, no drop-shipped mass-produced goods, no misleading Listings.",
          "Support when things go wrong through Marketplace Assistance (see the Returns & Refunds Policy).",
        ],
      },
      {
        heading: "For Makers",
        bullets: [
          "Fair marketplace rules that treat Makers as the independent businesses they are.",
          "Respect for your creativity and intellectual property. Your content stays yours.",
          "Transparent fees \u2014 published in the Marketplace section, with no hidden or surprise deductions.",
          "Tools designed to help your business grow (listings, catalogs to Google/Meta/Pinterest/TikTok, coaching, analytics).",
          "A supportive community of fellow Makers.",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "This is a statement of values, not a legal document. The binding rules live in the sections below \u2014 Terms of Service, Maker Agreement, Community Guidelines, and the rest of the policy suite.",
    },
  },
  {
    id: "terms",
    icon: FileText,
    title: "Terms of Service",
    intro: "These Terms of Service (\u201cTerms\u201d) govern your use of Crafters Market (\u201cthe Platform,\u201d \u201cwe,\u201d \u201cus\u201d) as a curated multi-vendor marketplace connecting independent Makers with Buyers. By accessing, browsing, purchasing, listing, or otherwise using the Platform you agree to be bound by these Terms, the Maker Agreement (if you sell), and every policy referenced below. If you do not agree, do not use the Platform.",
    blocks: [
      {
        heading: "1. Introduction",
        bullets: [
          `Effective date: ${POLICY_EFFECTIVE_DATE}. Version 2.0. Last updated 2026-06-30.`,
          "Purpose: define the rights, responsibilities, and boundaries that apply to everyone who uses Crafters Market.",
          "Marketplace model: Crafters Market is a Platform. Contracts of sale are between Buyers and Makers. We are not a party to those contracts and do not take title to Listings or Orders.",
          "Relationship to other policies: these Terms sit at the top of the marketplace policy hierarchy (below applicable law). Where a topic-specific policy provides more detail, that detail controls within its topic.",
        ],
      },
      {
        heading: "2. Eligibility & Accounts",
        bullets: [
          "You must be at least 18 years old (or the age of majority in your jurisdiction) to create an account, list items, or complete a purchase requiring a payment method.",
          "You are responsible for the accuracy of your account information and for maintaining the security of your login credentials.",
          "One account per person or business entity. You may not create duplicate accounts to evade suspension, fee obligations, or Platform enforcement.",
          "You are responsible for all activity that occurs under your account.",
        ],
      },
      {
        heading: "3. Buyers \u2014 Your Agreement With the Maker",
        bullets: [
          "When you place an Order, the contract of sale is between you (the Buyer) and the individual Maker who created the Listing.",
          "The Maker is responsible for describing the Listing accurately, fulfilling the Order, and providing customer service (including questions about materials, sizing, timing, and customization).",
          "Crafters Market facilitates the transaction, hosts the Listing, and provides Buyer Protection as described in the Buyer Protection Policy \u2014 but is not the seller of record.",
          "For questions about your Order, contact the Maker first through the on-platform messaging tools. If the issue is not resolved, follow the Buyer Protection Policy escalation process.",
        ],
      },
      {
        heading: "4. Makers \u2014 Your Agreement With the Platform and With Buyers",
        bullets: [
          "You may list only original items you personally make, design, or hand-finish. No reselling, no drop-shipping, no mass-produced or wholesale goods, and no counterfeit or infringing items.",
          "You are responsible for accurate Listings (materials, dimensions, processing times, shipping options, care instructions, and any customization details).",
          "You are responsible for shipping Orders within your stated processing time and for reasonable customer service.",
          "You agree to the Maker Agreement, the Prohibited Items Policy, and every marketplace policy referenced in this document.",
          "You are responsible for your own taxes, business licensing, and legal compliance in your jurisdiction. Crafters Market may collect and remit marketplace-facilitator sales tax where required by law.",
          "Origin claims (\u201cMade in USA,\u201d \u201cHandmade,\u201d and similar representations). Makers are solely responsible for the accuracy of any origin claim (including \u201cMade in USA,\u201d \u201cHandmade,\u201d \u201cHandcrafted,\u201d \u201cSmall-batch,\u201d or any similar representation) appearing on their Listings, Shop pages, packaging, or marketing. Crafters Market may review or remove Listings that appear misleading, apply enforcement under the Prohibited Items Policy, and cooperate with regulators, but does not independently verify every claim before it is published. See the Maker Agreement §19a for the substantive standards (including FTC \u201call or virtually all\u201d).",
        ],
      },
      {
        heading: "5. Fees, Payments & Payouts",
        bullets: [
          "Crafters Market charges a marketplace commission on each sale. Exact rates and any listing/renewal or subscription fees are published in the Fee & Pricing Policy and in the Makers Market section of the site.",
          "Payments are processed by Stripe (and any successor processor). By accepting Orders you agree to Stripe\u2019s Connected Account Agreement and Services Agreement.",
          "Makers must complete Stripe onboarding (identity verification, payout account) before withdrawing funds. Stripe may hold, reserve, or freeze funds as required by its risk and compliance programs.",
          "Payout holds initiated by Crafters Market are limited to legitimate operational triggers: (a) Stripe risk, compliance, or reserve requirements; (b) fraud investigations opened by Crafters Market or a card network; (c) active chargeback or dispute proceedings; (d) Maker identity-verification review; (e) an active legal, tax, or regulatory-compliance inquiry.",
          "A payout hold under this Section lasts only as long as reasonably necessary to resolve the underlying issue \u2014 including any applicable Stripe timelines, the card network's dispute lifecycle, or the timeline of a legal/regulatory inquiry. Funds not subject to a legitimate hold trigger will be released on the normal payout cadence.",
          "Some payout holds are imposed directly by third parties \u2014 including Stripe, card networks, payment networks, financial institutions, or regulatory authorities \u2014 pursuant to their own compliance, risk, or reserve obligations. Crafters Market cannot override or accelerate those holds where it does not control fund release. In those cases, resolution is governed by Stripe's Connected Account Agreement and the applicable card-network or regulatory rules.",
          "Communication during holds. Crafters Market will make reasonable efforts to inform the affected Maker of the general reason for a payout hold, unless prohibited by law, card-network rules, an ongoing fraud investigation, or a regulatory requirement. Crafters Market does not commit to any specific evidence, documentation, or notice threshold beyond what is reasonably practical under the circumstances.",
          "Crafters Market may deduct fees, refunds, chargebacks, and any amounts owed under these Terms, the Maker Agreement, or applicable policies from Maker balances or future payouts.",
          "Refunds and reversals are governed by the Returns & Refunds Policy and the Buyer Protection Policy.",
        ],
      },
      {
        heading: "6. Listings, User Content & Intellectual Property",
        bullets: [
          "You retain ownership of the copyrights, trademarks, and other rights you already hold in the content you upload (photos, descriptions, Listings, journal posts, messages, reviews, and other \u201cUser Content\u201d).",
          "You grant Crafters Market a worldwide, non-exclusive, royalty-free license to host, display, reproduce, adapt for format/size, and promote your User Content on the Platform and through connected surfaces (Google, Meta, Pinterest, TikTok, email, and other channels) for the purpose of operating and marketing the marketplace. This license also covers AI-assisted operational and marketing use as defined in Section 6a below.",
          "You represent that you have all rights necessary to upload and license your User Content and that it does not infringe any third-party rights.",
          "You may not use another Maker\u2019s User Content, brand assets, or Listings without written permission. The Intellectual Property & DMCA Policy explains how to report infringement and how repeat-infringer accounts are handled.",
        ],
      },
      {
        heading: "6a. AI Use \u2014 Creator-Owned AI Policy",
        bullets: [
          "Operational AI (allowed under the license in Section 6): Crafters Market may use AI-powered tools to operate and market the marketplace \u2014 including search, recommendations, fraud and spam detection, translations, accessibility, customer support, Listing optimization, SEO metadata, and the use of third-party advertising platforms (Google, Meta, Pinterest, TikTok, Reddit, and similar surfaces) solely to generate, optimize, target, and deliver advertisements that promote Maker Listings. Operational AI also includes email campaigns, blog articles, product-description assistance, video scripts, and social captions used to promote the Platform. Operational AI is considered part of running and promoting the Platform.",
          "AI model training (NOT covered by the license in Section 6): Crafters Market will not use Maker Content to train image-generation models, large language models, recommendation foundation models, or other commercial AI systems, and will not license or otherwise permit Maker Content to be used by any third-party (including any third-party advertising provider) to train commercial foundation models, unless the Maker has provided explicit, affirmative, opt-in consent through a separate AI Training Program. The Operational AI license above does not authorize the Platform or any third-party advertising provider to train commercial foundation models on Maker Content.",
          "If we ever launch an AI Training Program it will be opt-in only, with a separate consent step, a clear explanation of intended use, the ability to opt out later (subject to reasonable technical limitations for previously-trained models), and no reduction in visibility, ranking, payouts, or marketplace access for Makers who decline.",
          "Full details are in the Maker Agreement (AI Use \u2014 Creator-Owned AI Policy) and the Privacy Policy (How We Use AI).",
        ],
      },
      {
        heading: "7. Prohibited Uses",
        bullets: [
          "You may not use the Platform to violate any law, infringe intellectual property, or list items forbidden by the Prohibited Items Policy.",
          "You may not attempt to circumvent marketplace fees, direct Buyers off-platform for the same transaction, or use the messaging system to solicit off-platform payment for on-platform Listings.",
          "You may not scrape, mirror, or reverse-engineer the Platform, or interfere with its normal operation (rate-limiting evasion, denial-of-service behavior, malicious code, credential stuffing, etc.).",
          "You may not use the Platform to harass, threaten, defraud, or discriminate against other users. Conduct standards are described in the Community Guidelines.",
        ],
      },
      {
        heading: "8. Moderation, Suspension & Termination",
        bullets: [
          "Crafters Market may remove Listings, restrict features, freeze payouts, suspend, or terminate accounts that violate these Terms, the Maker Agreement, or any marketplace policy.",
          "We will use reasonable efforts to notify affected users, but immediate action may be taken where there is evidence of fraud, safety risk, IP infringement, or legal exposure to other users.",
          "Makers may appeal enforcement actions through the Appeals Process. Buyers may appeal Order-level decisions through the Buyer Protection escalation flow.",
          "Termination does not extinguish obligations that by their nature survive \u2014 including confidentiality, indemnity, tax and fee obligations, and IP licenses granted for content that remains publicly accessible.",
        ],
      },
      {
        heading: "9. Disclaimers",
        bullets: [
          "The Platform is provided \u201cas is\u201d and \u201cas available\u201d without warranties of any kind, express or implied, to the fullest extent permitted by law.",
          "Crafters Market does not warrant the quality, safety, legality, or accuracy of Listings, User Content, or Maker-provided information. Buyer Protection provides a marketplace-level safety net but is not a warranty of the product itself.",
          "The Platform is not a party to Buyer\u2013Maker contracts and does not guarantee performance by either party beyond what is expressly stated in the Buyer Protection Policy.",
        ],
      },
      {
        heading: "10. Limitation of Liability",
        bullets: [
          "To the maximum extent permitted by law, Crafters Market\u2019s aggregate liability arising out of or relating to these Terms or your use of the Platform is limited to the greater of (a) the marketplace commission we actually received from your Orders in the 12 months preceding the claim or (b) USD $100.",
          "Crafters Market is not liable for indirect, incidental, consequential, special, exemplary, or punitive damages, including lost profits, lost goodwill, or lost data, even if advised of the possibility.",
          "Nothing in this section limits liability that cannot be limited under applicable law (for example, fraud, willful misconduct, or certain consumer-protection rights).",
        ],
      },
      {
        heading: "11. Indemnification",
        bullets: [
          "You agree to indemnify and hold Crafters Market and its officers, directors, employees, and agents harmless from any claim, loss, cost, or expense (including reasonable attorneys\u2019 fees) arising from (a) your Listings, User Content, or Orders, (b) your breach of these Terms or any marketplace policy, (c) your violation of applicable law, or (d) your infringement of a third party\u2019s rights.",
          "Carve-out. This indemnification obligation does not apply to claims arising from Crafters Market\u2019s own (i) gross negligence or (ii) willful misconduct.",
          "Crafters Market may participate in the defense of any such claim at its own expense and reserves the right to assume the exclusive defense and control of any matter for which you are required to indemnify us.",
        ],
      },
      {
        heading: "12. Dispute Resolution & Governing Law",
        bullets: [
          "Step 1 \u2014 Informal Resolution (30 days). Before initiating any formal proceeding against Crafters Market, you agree to first send a written description of your dispute to policy@craftersmarket.org and give Crafters Market 30 days to attempt an informal resolution. Buyers and Makers should first attempt to resolve Order-related disputes with each other via on-platform messaging and, if that fails, through the Buyer Protection Policy escalation flow.",
          "Step 2 \u2014 Mandatory, Individual Arbitration. If a dispute against Crafters Market is not resolved within the 30-day informal period, it will be resolved by binding, individual arbitration administered by the American Arbitration Association (AAA) under its Consumer Arbitration Rules (or its Commercial Arbitration Rules where those apply). The arbitration will be seated in King County, Washington, and conducted in English. Arbitration will be administered remotely by default (video conference or written submissions) unless the arbitrator determines that an in-person hearing is necessary. Judgment on the award may be entered in any court of competent jurisdiction.",
          "Class-Action Waiver. You and Crafters Market each agree to bring claims only in an individual capacity, and not as a plaintiff or class member in any purported class, collective, consolidated, mass, or representative proceeding. The arbitrator has no authority to conduct any class, collective, or representative proceeding.",
          "Small-Claims Carve-Out. Either party may bring an individual claim that qualifies for the small-claims court of the party's home jurisdiction in that court instead of in arbitration. Filing a small-claims action does not waive the mandatory-arbitration or class-waiver provisions above with respect to any other dispute.",
          "Injunctive Relief. Nothing in this Section prevents either party from seeking injunctive or equitable relief in a court of competent jurisdiction to protect intellectual property, confidential information, or Platform integrity.",
          "Governing Law. These Terms are governed by the laws of the State of Washington, USA, without regard to conflict-of-law rules. For any dispute that is not subject to arbitration under this Section (for example, small-claims actions and requests for injunctive relief), the exclusive venue is the state or federal courts located in King County, Washington. Nothing in this Section limits any non-waivable rights or protections provided under applicable law, including any mandatory consumer-protection statutes in the User's home jurisdiction.",
          "Opt-Out of Arbitration. You may opt out of the arbitration agreement in this Section by sending a written notice to policy@craftersmarket.org within 30 days of first accepting these Terms. A valid opt-out notice must include your legal name, the account email address, and a clear statement that you decline to arbitrate. Email to policy@craftersmarket.org is the authoritative legal submission method; accepted opt-out notices are recorded in an internal ledger maintained by Crafters Market Legal / Compliance for future reference. Opting out does not affect any other provision of these Terms.",
        ],
      },
      {
        heading: "13. Marketplace-Facilitator Taxes & International Users",
        bullets: [
          "Where required by law, Crafters Market may collect and remit sales, use, VAT, GST, or similar transactional taxes as a marketplace facilitator.",
          "Makers remain responsible for their own income taxes, self-employment taxes, and any taxes not collected by the Platform.",
          "The Platform is currently operated from the United States. If you access the Platform from outside the U.S., you are responsible for compliance with local laws. Cross-border shipping is subject to Buyer duties and customs charges as described in the Shipping & Logistics Policy.",
        ],
      },
      {
        heading: "14. Changes to These Terms",
        bullets: [
          "We may update these Terms as the Platform evolves. When we make material changes we will post the new version with a new effective date and, where practical, notify active users by email or in-app notice.",
          "Notice period. Material changes to fees or user obligations will take effect no earlier than thirty (30) days after we post the updated Terms and notify active users. Changes required for security, legal or regulatory compliance, fraud prevention, or urgent technical or operational reasons may take effect immediately or on a shorter notice window; we will explain the reason for the accelerated timing where practical.",
          "Fee changes specifically are governed by the notice window in the Fee & Pricing Policy §12 (60 days for fee increases and new fees; reductions and promotional pricing may take effect immediately).",
          "Continued use of the Platform after the effective date constitutes acceptance of the updated Terms. Prior versions are preserved in the Revision History (below) and available on request.",
        ],
      },
      {
        heading: "14a. Electronic Signatures & Acceptance",
        bullets: [
          "By creating an account, checking any acceptance box, clicking \u201cI Agree,\u201d listing products, or otherwise using the Platform, you agree that these actions constitute your electronic signature and your acceptance of these Terms of Service and any Platform policies referenced here \u2014 under the U.S. Electronic Signatures in Global and National Commerce Act (E-SIGN), the Uniform Electronic Transactions Act (UETA), and any applicable state law.",
          "You may withdraw your consent to transact electronically by closing your account and ceasing to use the Platform. Consent may not be withdrawn retroactively \u2014 electronic signatures already made remain valid and enforceable.",
          "You are responsible for keeping the email address on your account current so you receive electronic notices about these Terms and any updates.",
        ],
      },
      {
        heading: "15. Miscellaneous",
        bullets: [
          "Entire agreement: these Terms, the Maker Agreement (where applicable), and the marketplace policies referenced here are the entire agreement between you and Crafters Market regarding the Platform.",
          "Severability: if any provision is unenforceable, the remaining provisions remain in effect.",
          "No waiver: our failure to enforce a provision is not a waiver of the right to do so later.",
          "Assignment: you may not assign these Terms without our consent. We may assign these Terms in connection with a merger, acquisition, or sale of assets.",
          "Contact: policy@craftersmarket.org for legal notices; team@craftersmarket.org for general support.",
        ],
      },
      {
        heading: "Revision History",
        bullets: [
          "v2.6 \u2014 2026-06-30 \u2014 Final Legal Consistency Audit (v4): §5 broadens payout-hold disclosure to include payment networks, financial institutions, and regulatory authorities; §12 opt-out references the internal ledger while retaining email as the authoritative legal submission method. Cross-document policy hierarchy audit — Maker Agreement now sits between Terms and Marketplace Policies for seller-specific issues.",
          "v2.5 \u2014 2026-06-30 \u2014 Final legal-hardening pass (v3): §5 Communication-during-holds (reasonable-efforts obligation subject to law / card-network / fraud / regulatory carve-outs); §12 Governing Law adds explicit non-waivable-rights carve-out; §14 clarifies material-change notice — 30 days for material fees/user-obligation changes; immediate effectiveness for security, legal, fraud-prevention, or urgent technical/operational changes; fee changes deferred to Fee & Pricing Policy §12 (60-day rule).",
          "v2.4 \u2014 2026-06-30 \u2014 Second-round legal-review pass: §4 adds Maker responsibility for origin claims (Made in USA / Handmade / etc.); §5 clarifies that some payout holds are Stripe- or card-network-controlled; §6a clarifies that Operational AI does not authorize the Platform or any third-party ad provider to train commercial foundation models on Maker Content; §12 adds remote-first arbitration (video conference or written submissions by default), King County WA remains the legal seat.",
          "v2.3 \u2014 2026-06-30 \u2014 Legal-hardening pass: added §14a Electronic Signatures & Acceptance (E-SIGN / UETA acknowledgment). Effective date is now maintained centrally and updated at deployment rather than manually placed in each policy.",
          "v2.2 \u2014 2026-06-30 \u2014 Legal-review pass: §5 payout holds tied to Stripe lifecycle + limited operational triggers; §11 adds gross-negligence + willful-misconduct carve-out; §12 replaced placeholder with two-tier informal-then-arbitration structure, class-action waiver, small-claims carve-out, 30-day opt-out.",
          "v2.1 \u2014 2026-06-30 \u2014 Added Section 6a AI Use (Creator-Owned AI Policy): distinguishes AI-for-operations (allowed under content license) from AI model training (opt-in only, never a condition of marketplace access).",
          "v2.0 \u2014 2026-06-30 \u2014 Marketplace-model rewrite. Adds Maker/Buyer role split, marketplace-facilitator tax section, expanded moderation & appeals references, limitation-of-liability and indemnity clauses, dispute-resolution framework.",
          "v1.0 \u2014 2025-12-01 \u2014 Initial Beta Terms (short-form, retail framing).",
        ],
      },
      {
        heading: "Related Policies",
        bullets: [
          "Maker Agreement \u2014 the full Maker contract, including exclusivity, taxes, and payout terms.",
          "Buyer Protection Policy \u2014 how disputes are handled and when the Platform intervenes.",
          "Returns & Refunds Policy \u2014 return windows, refund methods, damaged/lost items.",
          "Shipping & Logistics Policy \u2014 processing times, carriers, risk of loss, international shipping.",
          "Prohibited Items Policy \u2014 what may and may not be sold on the Platform.",
          "Community Guidelines \u2014 conduct standards for messaging, reviews, and community spaces.",
          "Privacy Policy & Cookie Policy \u2014 how we collect, use, and protect data.",
          "Intellectual Property & DMCA Policy \u2014 how to report infringement and how repeat-infringer accounts are handled.",
          "Fee & Pricing Policy \u2014 current commissions, listing fees, and payout schedule.",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "These Terms of Service sit at the top of the marketplace policy hierarchy \u2014 below applicable law and above the topic-specific policies. Where a topic-specific policy provides more detail (shipping, returns, buyer protection, etc.), that detail controls within its topic.",
    },
    outro: (
      <>
        <span className="text-ink-muted">Version:</span>{" "}
        <b className="text-ink">2.6</b>
        <span className="text-ink-muted"> · Last updated:</span>{" "}
        <b className="text-ink">2026-06-30</b>
        <span className="text-ink-muted"> · Effective:</span>{" "}
        <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
      </>
    ),
  },

  // iter413dl — Shipping & Logistics Policy v3.0 (2026-06-30). Marketplace-
  // specific rewrite per implementation brief. Replaces the prior corporate-
  // logistics framing — Crafters Market is NOT a fulfillment company,
  // warehouse, or carrier; independent Makers ship their own orders.
  {
    id: "shipping",
    icon: Truck,
    title: "Shipping & Logistics Policy",
    intro: "Crafters Market is a marketplace. Independent Makers prepare, package, and ship their own Orders. The Platform facilitates communication and order tracking where available but is not the shipping carrier, warehouse operator, or fulfillment company. This Policy defines how shipping works between Buyers, Makers, and the Platform.",
    blocks: [
      {
        heading: "1. Introduction",
        bullets: [
          `Effective date: ${POLICY_EFFECTIVE_DATE}.`,
          "Last updated: 2026-06-30. Version 3.0.",
          "Purpose: explain how shipping responsibilities are divided across the marketplace and what Buyers and Makers can expect.",
          "Relationship to other policies: this Policy supplements the Terms of Service and works alongside the Maker Agreement, Returns & Refunds Policy, Community Guidelines, and Prohibited Items Policy.",
        ],
      },
      {
        heading: "2. Marketplace Shipping Model",
        bullets: [
          "Makers fulfill Orders directly. Each Maker decides which carrier, packaging method, and shipping speed to use, within the rules of this Policy.",
          "Buyers purchase directly from Makers. The contract of sale is between Buyer and Maker.",
          "Crafters Market is not the shipping carrier and does not transport goods.",
          "Crafters Market does not warehouse products, take possession of inventory, or perform pick-and-pack operations, unless future fulfillment services are explicitly announced and accepted by the Maker.",
        ],
      },
      {
        heading: "3. Shipping Responsibilities",
        text: "Responsibilities are divided among Makers, Buyers, and Crafters Market as follows.",
        list: [
          ["Makers must:", "publish accurate processing times in their Shop Policy, package items appropriately, ship within the stated timeframe, provide tracking when practical, communicate delays promptly, and comply with all applicable shipping laws (including hazardous-material rules)."],
          ["Buyers must:", "provide accurate shipping information at checkout, monitor tracking notifications, inspect packages promptly upon delivery, and report shipping issues within a reasonable timeframe."],
          ["Crafters Market may:", "display shipping information, facilitate communication between Buyer and Maker, surface tracking updates where the Maker provides them, and assist with dispute resolution under the Returns & Refunds Policy."],
        ],
        bullets: [
          "Crafters Market does not guarantee delivery dates or carrier performance.",
        ],
      },
      {
        heading: "4. Processing Times",
        text: "Processing time is determined by each Maker and disclosed on the Listing or in their Shop Policy. Typical patterns:",
        bullets: [
          "Ready-to-ship items: usually 1\u20133 business days after payment.",
          "Made-to-order products: the production window stated on the Listing (often 1\u20134 weeks).",
          "Custom Orders: per the proof / approval / production workflow described in the Maker\u2019s Shop Policy and the Returns & Refunds Policy.",
          "Digital Products: delivered electronically after payment confirmation, typically immediately.",
          "Makers must publish realistic production timelines and update them when conditions change.",
        ],
      },
      {
        heading: "5. Shipping Methods",
        text: "Makers choose carriers appropriate for their products. Common examples:",
        bullets: [
          "USPS (First Class, Priority, Priority Express, Ground Advantage).",
          "UPS (Ground, 2nd Day Air, Next Day Air).",
          "FedEx (Ground, Express, Home Delivery).",
          "DHL (international or expedited).",
          "Regional carriers where appropriate.",
          "Crafters Market does not require a specific carrier. Makers may use the carrier that best fits the item\u2019s size, fragility, value, and destination.",
        ],
      },
      {
        heading: "6. Tracking",
        bullets: [
          "Makers are encouraged to provide tracking whenever practical.",
          "Where tracking is available, Buyers should receive shipment updates and tracking information should appear in the Order history.",
          "Where tracking is impractical (very small or low-value items shipped by lightweight envelope, for example), the Maker should disclose this on the Listing or in the Shop Policy.",
        ],
      },
      {
        heading: "7. Packaging Standards",
        bullets: [
          "Makers must package items so they arrive undamaged in normal handling.",
          "Fragile items should have adequate protective material (cushioning, double-boxing, structural inserts as appropriate).",
          "Weather-sensitive items (waxes, soaps, anything heat- or moisture-sensitive) should be packaged accordingly.",
          "Labels should be clear and secure; shipping documents required by carrier or jurisdiction should be attached.",
          "Environmentally responsible packaging is encouraged where practical (see Section 12).",
          "Crafters Market does not prescribe specific packaging brands or technologies.",
        ],
      },
      {
        heading: "8. Shipping Delays",
        text: "Delays may occur for reasons outside the Maker\u2019s and the Platform\u2019s control, including:",
        bullets: [
          "Severe weather.",
          "Carrier disruptions or service interruptions.",
          "Customs holds or inspection delays (for international shipments, if available).",
          "Natural disasters.",
          "Labor actions or strikes.",
          "Government actions or sanctions.",
          "Other events covered by the Force Majeure provision (Section 14).",
          "Makers should communicate significant delays promptly to affected Buyers; Crafters Market may assist with communication.",
        ],
      },
      {
        heading: "9. Lost or Damaged Shipments",
        text: "When a shipment is lost or arrives damaged, responsibilities are as follows.",
        list: [
          ["Maker:", "assist with carrier claims, provide shipment documentation, and work with the Buyer in good faith to resolve verified shipping issues per the Returns & Refunds Policy and the Maker\u2019s Shop Policy."],
          ["Buyer:", "verify the shipping address at checkout, inspect deliveries promptly, report damage or non-delivery within the Maker\u2019s published policy or marketplace requirements (whichever applies), and provide supporting photographs where appropriate."],
          ["Crafters Market:", "may facilitate communication, review evidence, and engage Marketplace Assistance per the Returns & Refunds Policy. We generally do not assume responsibility for carrier errors or shipping losses."],
        ],
      },
      {
        heading: "10. International Shipping",
        bullets: [
          "International shipping availability depends on the individual Maker. Some Makers ship internationally; many ship only within the United States.",
          "Customs duties, taxes, import fees, brokerage charges, and other border-related costs are the Buyer\u2019s responsibility unless the Listing or Shop Policy expressly states otherwise.",
          "Delivery times for international shipments may vary significantly because of customs processing.",
          "The Maker is responsible for completing customs documentation accurately.",
          "If Crafters Market expands services to jurisdictions with mandatory international-shipping consumer-protection regimes (EU Distance Selling, UK Consumer Rights Act, etc.), the applicable safeguards will be implemented before accepting Buyer orders from those jurisdictions. Nothing in this Policy limits any non-waivable consumer right that cannot be waived under applicable law.",
        ],
      },
      {
        heading: "11. Digital Products",
        text: "Digital Products are not physically shipped.",
        bullets: [
          "Digital Products are delivered electronically through the Platform after payment confirmation.",
          "Examples include SVG, DXF, STL, laser cut files, CNC files, downloadable patterns, print-at-home designs, and other non-physical deliverables.",
          "Refund eligibility for Digital Products is governed by the Digital Products provisions of the Returns & Refunds Policy.",
        ],
      },
      {
        heading: "12. Sustainability",
        bullets: [
          "Crafters Market encourages, but does not require, environmentally responsible shipping practices.",
          "Suggested practices include recyclable packaging, right-sized boxes, minimizing void fill and plastic, and reusable materials where practical.",
          "We do not currently make measurable corporate sustainability commitments on behalf of Makers.",
        ],
      },
      {
        heading: "13. Shipping Insurance",
        bullets: [
          "Shipping insurance may be offered by the Maker or by the shipping carrier.",
          "Where additional insurance is available or required (e.g. for high-value pieces), the Maker should clearly disclose its availability and cost.",
          "Not all shipments are automatically insured. Insurance terms and claim processes are governed by the chosen carrier and any third-party insurance provider.",
        ],
      },
      {
        heading: "14. Force Majeure",
        bullets: [
          "Neither Makers nor Crafters Market are liable for delays or failures in shipping caused by events outside reasonable control, including severe weather, natural disasters, pandemics, war or civil unrest, terrorist activity, carrier strikes or disruptions, government action or restriction, customs delays, labor disputes, supply-chain failures, internet outages, or hosting-provider failures.",
          "The affected party will give prompt notice of the event and make reasonable efforts to mitigate and resume performance.",
          "Force-majeure relief does not waive obligations to refund Buyers or honor consumer-protection rights.",
        ],
      },
      {
        heading: "15. Shipping Policy Changes",
        bullets: [
          "We may update this Policy from time to time. Material changes will be communicated by posting the updated Policy to the Platform, by email, and / or by in-product notice prior to taking effect.",
          "The Effective Date and Last Updated values reflect the current version.",
          "Continued use of the Platform after the effective date of an update constitutes acceptance.",
          "This Policy supplements and is incorporated into the Terms of Service.",
          "Non-waivable rights. Nothing in this Policy limits any non-waivable rights or protections provided under applicable law, including mandatory consumer-protection statutes in the Buyer's home jurisdiction. Where this Policy and applicable law conflict on a right that cannot be waived, the applicable law controls.",
        ],
      },
      {
        heading: "Future Marketplace Shipping Features",
        text: "Crafters Market reserves the right to introduce additional shipping-related services in the future, including but not limited to:",
        bullets: [
          "Discounted shipping labels purchased through the Platform.",
          "Integrated carrier purchasing.",
          "Optional shipping insurance offered through the Platform.",
          "Fulfillment partnerships with third-party warehouses.",
          "Crafters Market warehouse / 3PL services.",
          "International shipping tools and duties-and-taxes pre-collection.",
          "Estimated delivery dates and Maker shipping analytics.",
          "Participation in any new shipping service is optional unless we expressly indicate otherwise and may be subject to additional published terms.",
        ],
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: "Draft v3.0 for legal review. Sections 9 (Lost or Damaged Shipments), 10 (International Shipping), 13 (Shipping Insurance), and 14 (Force Majeure) should be reviewed by counsel licensed in your operating jurisdiction(s) before being treated as fully binding. Mandatory consumer-protection rights cannot be waived by this Policy.",
    },
    outro: (
      <>
        <p className="mb-3">
          Tracking information is provided by the Maker once the Order ships. If you
          haven\u2019t received tracking after the Maker\u2019s stated processing time, contact the
          Maker directly first; if you can\u2019t reach a resolution, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          and we will engage Marketplace Assistance under the Returns & Refunds Policy.
        </p>
        <p className="text-ink-muted text-sm">
          <span>Version:</span> <b className="text-ink">3.1</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
          <br />
          <span>v3.1 · 2026-06-30 — Final legal-hardening pass (v3): §15 adds explicit non-waivable-rights carve-out.</span>
          <br />
          <span>v3.0 · 2026-06-30 — Marketplace-specific rewrite. Removed assumption that Crafters Market is the carrier / warehouse. 15 numbered sections + future-shipping-features placeholder. Cross-referenced with ToS, Maker Agreement, Returns & Refunds, Privacy.</span>
          <br />
          <span>v1   · prior — Corporate logistics framing (assumed Crafters Market shipped direct).</span>
        </p>
      </>
    ),
  },

  // iter413dl — Returns & Refunds Policy v3.0. Marketplace-specific rewrite
  // per implementation brief (2026-06-30). Replaces the prior retail-style
  // policy that assumed Crafters Market was the seller of record — it isn't.
  // Hierarchy is explicit: Law > ToS > this Policy > Maker Agreement > Shop
  // Policy > Order-specific agreement. Sections marked LEGAL_REVIEW_REQUIRED
  // are placeholders pending counsel input.
  {
    id: "returns",
    icon: RotateCcw,
    title: "Returns & Refunds Policy",
    intro: "Crafters Market is a marketplace of independent Makers. When you purchase, you buy directly from the Maker — Crafters Market provides the platform and may facilitate dispute resolution but is generally not the seller of record. Each Maker generally sets their own returns, exchanges, cancellations, and processing times in their Shop Policy. This Policy establishes the baseline framework that applies across the marketplace.",
    blocks: [
      {
        heading: "1. Introduction",
        bullets: [
          `Effective date: ${POLICY_EFFECTIVE_DATE}.`,
          "Last updated: 2026-06-30. Version 3.0.",
          "This Policy describes how returns, refunds, exchanges, and cancellations work on Crafters Market.",
          "Purchases are made from independent Makers; Crafters Market provides the marketplace, payment-processing facilitation, and dispute-resolution assistance.",
          "This Policy supplements the Crafters Market Terms of Service and works alongside the Maker Agreement, Community Guidelines, Prohibited Items Policy, Privacy Policy, and each Maker's individual Shop Policy.",
        ],
      },
      {
        heading: "2. Policy Hierarchy",
        text: "When there is a conflict between rules, the following order of precedence applies (canonical order — matches the master hierarchy referenced across the Trust & Policy Center):",
        list: [
          ["1. Applicable Law —", "consumer-protection rights that cannot be waived by contract always govern."],
          ["2. Terms of Service —", "the master agreement between you and Crafters Market."],
          ["3. Maker Agreement (seller-specific issues only) —", "for issues relating to Maker activity (listings, payouts, seller-side IP, exclusivity, taxes), the Maker Agreement is more specific than this Policy and controls within its subject-matter scope. For non-seller (Buyer or general) issues, this Policy controls."],
          ["4. This Returns & Refunds Policy —", "the marketplace-wide baseline for returns, refunds, exchanges, and cancellations."],
          ["5. Individual Maker Shop Policy —", "Maker-specific returns, exchanges, cancellations, custom-order, and digital-product rules."],
          ["6. Order-specific written agreement —", "any specific arrangement agreed in writing for a particular Order (e.g. a Custom Order quote)."],
        ],
        bullets: [
          "Maker Shop Policies cannot override applicable law or mandatory marketplace rules. A Shop Policy that conflicts with this Policy or the Maker Agreement is unenforceable to the extent of the conflict.",
        ],
      },
      {
        heading: "3. Standard Products",
        bullets: [
          "Returns and exchanges for standard (non-custom, non-digital) products are governed primarily by the Maker\u2019s published Shop Policy.",
          "Each Maker must clearly disclose in their Shop Policy: return window, exchange eligibility, cancellation rules, restocking fees (if any), and shipping responsibilities for returns.",
          "Where a Maker\u2019s Shop Policy is silent on an issue, the default rules in this Policy apply.",
          "Default position when no Shop Policy is published: items that arrived damaged, defective, or materially different from the Listing description are eligible for return within 14 days of delivery. Items returned for any other reason are at the Maker\u2019s discretion.",
        ],
      },
      {
        heading: "4. Custom & Personalized Products",
        text: "Custom Orders (made-to-order, commissioned, monogrammed, engraved, sized-to-buyer, or otherwise personalized) are generally non-returnable once production has begun. Limited exceptions apply:",
        bullets: [
          "Required by applicable consumer-protection law.",
          "The delivered product is materially different from the proof or written specification you approved.",
          "The product is defective in workmanship or materials.",
          "The product was damaged in transit.",
          "The Maker shipped the wrong item.",
          "Makers must clearly state, before payment, the proof / approval workflow, the revision policy, the production timeline, and any non-refundability terms.",
          "Buyers must respond to proof or approval requests promptly. Production should not begin until any required approvals are received.",
        ],
      },
      {
        heading: "5. Digital Products",
        text: "Digital Products are generally non-refundable once delivered or downloaded. Examples include SVG, DXF, STL, laser cut files, CNC files, digital patterns, print-at-home designs, and other non-physical deliverables.",
        bullets: [
          "Exceptions: required by applicable law; the delivered file is defective or unusable; or the Maker\u2019s Shop Policy expressly offers refunds.",
          "Makers must clearly state on the Listing the license granted, commercial-use status, redistribution restrictions, and any non-refundability terms.",
          "Buyers are responsible for verifying that the file format and license are compatible with their intended use before purchase.",
        ],
      },
      {
        heading: "6. Damaged, Defective, or Incorrect Items",
        text: "When an item arrives damaged, defective, or is not what was ordered:",
        bullets: [
          "Buyer is encouraged to notify the Maker as soon as reasonably possible. For transit damage, a report within seven (7) days of delivery is recommended whenever reasonably possible to assist any investigation with the carrier. For latent defects (issues discovered later), a report within thirty (30) days of delivery is recommended.",
          "These are reporting recommendations, not a shortening of any applicable return window under Section 3, the Maker's Shop Policy, the Buyer Protection Policy, or applicable consumer-protection law. A late report may make a carrier claim harder to pursue but does not by itself extinguish Buyer Protection rights or return rights that are otherwise available.",
          "Buyer should provide clear photographs of the item, the packaging (for transit damage), and the shipping label.",
          "Buyer should cooperate with the Maker on resolution (replacement, repair, refund, or return).",
          "Maker should respond promptly and make reasonable efforts to resolve verified issues consistent with this Policy, the Maker Agreement, and the Maker\u2019s Shop Policy.",
          "Where the Maker and Buyer cannot reach a resolution, either party may request Marketplace Assistance (see Section 13).",
        ],
      },
      {
        heading: "7. Lost Shipments",
        text: "When a shipment fails to arrive, responsibilities are divided as follows:",
        bullets: [
          "Maker: ships the Order in line with the Listing and Shop Policy timelines, provides tracking where applicable, and assists with carrier claims.",
          "Buyer: provides an accurate shipping address at checkout, monitors carrier tracking notifications, and reports delivery issues promptly.",
          "Crafters Market: may facilitate communication and review evidence but is generally not responsible for carrier performance.",
          "For tracked shipments marked delivered but not received by the Buyer, the Maker should help investigate with the carrier; resolution (refund, replacement, or carrier claim) follows the Maker\u2019s Shop Policy and applicable law.",
          "For untracked or untraceable shipments, the Maker bears the risk of loss in transit unless the Shop Policy and the Listing made the absence of tracking clear before purchase.",
          "Marketplace floor \u2014 Shop Policies may not override the Buyer Protection Policy. A Shop Policy cannot disclaim marketplace protections for non-delivery, materially-not-as-described items, or damage in transit that would otherwise be covered under Buyer Protection. Where a Shop Policy conflicts with the Buyer Protection Policy or with applicable consumer-protection law, the Buyer Protection Policy or the applicable law controls.",
        ],
      },
      {
        heading: "8. Cancellations",
        text: "Cancellation eligibility depends on production status, the Maker\u2019s Shop Policy, and applicable law:",
        bullets: [
          "Standard Orders: cancellable by the Buyer before the Maker ships, subject to the Maker\u2019s Shop Policy. Once shipped, the Buyer cancels by initiating a return per Section 3.",
          "Custom Orders: cancellable before production begins; once materials are sourced or fabrication has started, cancellation is at the Maker\u2019s discretion and the Buyer may forfeit deposits as disclosed in the Shop Policy.",
          "Made-to-Order Products: same as Custom Orders.",
          "Digital Products: cancellable before download; not cancellable after download unless the Shop Policy provides otherwise.",
          "Where applicable consumer-protection law grants cancellation rights beyond those described above, those rights govern.",
        ],
      },
      {
        heading: "9. Exchanges",
        bullets: [
          "Exchange availability is determined by the individual Maker\u2019s Shop Policy unless otherwise required by law.",
          "Where exchanges are offered, the Maker may require the Buyer to return the original item before the exchange is shipped, and may set a reasonable timeframe and shipping-cost arrangement.",
          "Where exchanges are not offered, the Maker may instead offer a refund-and-repurchase path consistent with this Policy.",
        ],
      },
      {
        heading: "10. Refund Processing",
        bullets: [
          "Refunds are generally initiated by the Maker through the Platform\u2019s payment processor (Stripe).",
          "Approved refunds are returned to the original payment method, typically within 3 to 10 business days depending on the Buyer\u2019s bank and card issuer.",
          "Stripe\u2019s payment-processing fees are generally not refunded by Stripe and are therefore not refunded by Crafters Market or by the Maker.",
          "Platform commission on a refunded amount is refunded to the Maker per the Maker Agreement.",
          "Crafters Market may assist with payment-dispute escalation but does not guarantee any specific refund outcome.",
        ],
      },
      {
        heading: "11. Buyer Responsibilities",
        bullets: [
          "Review the Maker\u2019s Shop Policy before purchase \u2014 it controls the specifics of returns, exchanges, cancellations, and shipping.",
          "Provide accurate shipping information at checkout.",
          "Inspect items promptly upon delivery and report any issues to the Maker within the windows in this Policy or the Shop Policy, whichever is shorter where law permits.",
          "Communicate respectfully and in good faith during any dispute-resolution process.",
          "Do not initiate a chargeback before reasonable attempts to resolve the issue directly with the Maker have failed (see Section 14).",
        ],
      },
      {
        heading: "12. Maker Responsibilities",
        bullets: [
          "Publish a clear Shop Policy covering returns, exchanges, cancellations, custom-order rules, digital-product rules, and shipping responsibilities.",
          "Honor your published Shop Policy and the Maker Agreement.",
          "Communicate promptly with Buyers \u2014 generally within two (2) business days.",
          "Process approved refunds in a timely manner using the payment processor.",
          "Resolve verified defects and transit damage in good faith.",
          "Cooperate with Crafters Market when Marketplace Assistance is engaged (see Section 13) and with chargeback investigations (see Section 14).",
        ],
      },
      {
        heading: "13. Marketplace Assistance",
        text: "Crafters Market is not the seller of record but does provide assistance where a Buyer and Maker cannot resolve a dispute directly. Our role may include:",
        bullets: [
          "Facilitating communication between Buyer and Maker.",
          "Requesting documentation from both parties (photos, tracking, communication history).",
          "Reviewing evidence and recommending a resolution path.",
          "Assisting with Stripe-side payment disputes by gathering the evidence Stripe needs.",
          "Investigating policy violations and taking enforcement action under the Maker Agreement and the Terms of Service.",
          "Marketplace Assistance is not a guarantee of refund or replacement. Crafters Market is not obligated to resolve every dispute or to override the Maker\u2019s Shop Policy where it is consistent with this Policy and applicable law.",
        ],
      },
      {
        heading: "14. Chargebacks",
        bullets: [
          "Initiating a chargeback through your card issuer may pause Marketplace dispute handling while the payment processor investigates.",
          "Buyers should attempt to resolve issues directly with the Maker and through Marketplace Assistance before initiating a chargeback.",
          "Makers must cooperate during chargeback investigations and provide the evidence Crafters Market and Stripe request.",
          "Chargebacks lost by the Maker may result in the chargeback amount, plus any chargeback fees, being recovered from future payouts per the Maker Agreement.",
          "Fraudulent or bad-faith chargebacks may be reported to the payment processor and may result in restrictions on the Buyer\u2019s account.",
        ],
      },
      {
        heading: "15. Fraud Prevention",
        text: "Crafters Market reserves the right to investigate suspected fraud and abuse, including:",
        bullets: [
          "Fraudulent return claims (e.g. claiming non-receipt for delivered items).",
          "Return abuse (e.g. wardrobing, serial returns, swap-and-return schemes).",
          "False damage reports.",
          "Payment fraud (stolen-card purchases, identity fraud, chargeback fraud).",
          "Maker fraud (non-fulfillment, misrepresentation, IP infringement).",
          "Investigations may include reviewing account history, communication records, IP/device patterns, and external fraud signals. Confirmed abuse may result in account restriction, refund denial, payout hold, or referral to law enforcement.",
        ],
      },
      {
        heading: "16. Policy Updates",
        bullets: [
          "We may update this Policy from time to time. Material changes will be communicated by posting the updated Policy to the Platform, by email, and / or by in-product notice prior to taking effect.",
          "The Effective Date and Last Updated values at the top of this Policy reflect the current version.",
          "Continued use of the Platform after the effective date of an update constitutes acceptance.",
          "Where required by law, we will obtain affirmative re-acceptance for material changes.",
          "Non-waivable rights. Nothing in this Policy limits any non-waivable rights or protections provided under applicable law, including mandatory consumer-protection statutes in the Buyer's home jurisdiction. Where this Policy and applicable law conflict on a right that cannot be waived, the applicable law controls.",
        ],
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: "Draft v3.0 for legal review. Sections 2 (Policy Hierarchy), 4 (Custom & Personalized Products), 5 (Digital Products), 14 (Chargebacks), and 15 (Fraud Prevention) should be reviewed by counsel licensed in your operating jurisdiction(s) before being treated as fully binding. Mandatory consumer-protection rights cannot be waived by this Policy.",
    },
    outro: (
      <>
        <p className="mb-3">
          To start a return, exchange, or cancellation: contact the Maker directly
          through their shop on Crafters Market. If you can\u2019t reach a resolution,{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          can engage Marketplace Assistance per Section 13.
        </p>
        <p className="text-ink-muted text-sm">
          <span>Version:</span> <b className="text-ink">3.4</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
          <br />
          <span>v3.4 · 2026-06-30 — Final Legal Consistency Audit (v4): §2 Policy Hierarchy re-ordered to align with the canonical policy hierarchy — Maker Agreement (seller-specific issues only) now sits between Terms of Service and this Policy.</span>
          <br />
          <span>v3.3 · 2026-06-30 — Final legal-hardening pass (v3): §16 adds explicit non-waivable-rights carve-out.</span>
          <br />
          <span>v3.2 · 2026-06-30 — Second-round legal-review pass: §6 rewritten to separate 7-day transit-damage reporting recommendation from applicable return windows and Buyer Protection rights.</span>
          <br />
          <span>v3.0 · 2026-06-30 — Replaced retail-style policy with marketplace-specific framework. 16 numbered sections + Policy Hierarchy + Marketplace Assistance role clarified. Cross-referenced with ToS, Maker Agreement, Privacy Policy, Community Guidelines, Prohibited Items.</span>
          <br />
          <span>v1   · prior — Retail-style 14-day return window, assumed Crafters Market sold direct.</span>
        </p>
      </>
    ),
  },

  // iter413dl — Buyer Protection Policy v1.0 (2026-06-30). New dedicated
  // section. Formalizes the buyer-side dispute framework referenced from
  // Returns & Refunds §13 (Marketplace Assistance) and the Marketplace
  // section (fees + protection). Replaces the previous "buyer-protection"
  // alias that redirected to the Marketplace fees section.
  {
    id: "buyer-protection",
    icon: ShieldCheck,
    title: "Buyer Protection Policy",
    intro: "Crafters Market is committed to a trusted marketplace where Buyers can confidently purchase from independent Makers. This Policy explains what Buyer Protection covers, how each party is expected to behave when issues arise, and how Marketplace Assistance is engaged. Read together with the Terms of Service, Returns & Refunds Policy, Maker Agreement, and each Maker\u2019s Shop Policy.",
    blocks: [
      {
        heading: "1. Purpose",
        bullets: [
          `Effective date: ${POLICY_EFFECTIVE_DATE}.`,
          "Last updated: 2026-06-30. Version 1.0.",
          "Explain how Crafters Market assists Buyers and Makers when issues arise with an Order.",
          "Outline responsibilities of each party and the circumstances under which Marketplace Assistance is engaged.",
        ],
      },
      {
        heading: "2. Marketplace Role",
        text: "Crafters Market is an online marketplace connecting Buyers with independent Makers. Unless expressly stated otherwise:",
        bullets: [
          "Makers are responsible for producing, packaging, shipping, and fulfilling Orders.",
          "Buyers purchase directly from the Maker.",
          "Crafters Market is not the manufacturer or seller of listed products.",
          "Crafters Market may facilitate communication and investigate disputes but does not guarantee refunds or specific outcomes.",
        ],
      },
      {
        heading: "3. What Buyer Protection Covers",
        text: "Buyer Protection may apply when an Order involves one or more of:",
        bullets: [
          "The item never arrives.",
          "The wrong item is received.",
          "The item arrives materially different from the Listing description.",
          "The item arrives significantly damaged during shipping.",
          "A verified Custom Order does not match the final approved design.",
          "The Maker stops responding after payment and fails to fulfill the Order.",
        ],
      },
      {
        heading: "Not covered by Buyer Protection",
        bullets: [
          "Buyer\u2019s remorse (\u201cchanged my mind\u201d).",
          "Minor differences resulting from handmade craftsmanship (grain variation, brush strokes, weave, glaze pooling).",
          "Variations in natural materials such as wood, leather, fabric, stone, or metal.",
          "Delays caused by weather, customs, carrier disruptions, or other events beyond reasonable control (see Shipping §14 Force Majeure).",
          "Issues already disclosed in the Listing or the Maker\u2019s Shop Policy.",
        ],
      },
      {
        heading: "4. Buyer Responsibilities",
        text: "To receive assistance, Buyers should:",
        bullets: [
          "Review the Maker\u2019s Shop Policy before purchasing.",
          "Read the product description and options carefully.",
          "Review photographs and customization details.",
          "Provide accurate shipping information at checkout.",
          "Inspect deliveries promptly.",
          "Contact the Maker before escalating whenever practical.",
          "Cooperate by providing requested documentation.",
        ],
      },
      {
        heading: "5. Maker Responsibilities",
        text: "Makers are expected to:",
        bullets: [
          "Accurately describe products.",
          "Honor published Shop Policies and the Maker Agreement.",
          "Ship within stated processing times.",
          "Respond to Buyer inquiries within a reasonable time \u2014 generally within two business days.",
          "Make good-faith efforts to resolve legitimate issues.",
          "Cooperate during investigations.",
        ],
      },
      {
        heading: "6. Reporting an Issue",
        text: "If a problem occurs, Buyers should first contact the Maker through the Crafters Market messaging system. If the issue cannot be resolved directly, Buyers may request Marketplace Assistance. When submitting a request, Buyers may be asked to provide:",
        bullets: [
          "Order number.",
          "Description of the issue.",
          "Photographs of the item and packaging (when applicable).",
          "Tracking information (if available).",
          "Copies of relevant communications with the Maker.",
          "Any additional documentation reasonably requested.",
        ],
      },
      {
        heading: "7. Marketplace Review Process",
        text: "When Marketplace Assistance is requested, Crafters Market may:",
        bullets: [
          "Review the Listing.",
          "Review communications between Buyer and Maker.",
          "Request additional information from either party.",
          "Review shipping or tracking information.",
          "Evaluate available evidence in aggregate.",
          "Facilitate communication between the parties.",
          "Assist with payment-processor dispute procedures where appropriate.",
          "Each case is reviewed individually based on the available information.",
        ],
      },
      {
        heading: "8. Resolution Options",
        text: "Depending on circumstances, possible outcomes may include:",
        bullets: [
          "Encouraging the Maker to complete the Order.",
          "Replacement of damaged or incorrect items.",
          "Repair where appropriate.",
          "Partial refund.",
          "Full refund.",
          "Cancellation before fulfillment.",
          "No action if the evidence does not support the claim.",
          "Crafters Market reserves the right to determine whether Marketplace Assistance is appropriate based on the facts presented.",
        ],
      },
      {
        heading: "9. Custom Orders",
        text: "Custom and personalized items require special consideration.",
        bullets: [
          "Buyer Protection MAY apply when: the final product materially differs from the approved proof; the wrong customization is produced; or the Maker fails to deliver the agreed custom work.",
          "Buyer Protection generally does NOT apply when: the Buyer approved the final proof; the Buyer requests changes after production began; or differences are consistent with handmade craftsmanship and the approved design.",
          "See the Returns & Refunds Policy \u00a74 and the Maker Agreement \u00a716 for the underlying rules.",
        ],
      },
      {
        heading: "10. Digital Products",
        text: "Digital Products are generally considered delivered once the Buyer has received access to the purchased files.",
        bullets: [
          "Buyer Protection MAY apply if files cannot be accessed, files are materially different from the Listing, or files are corrupted or unusable.",
          "Digital Products are generally not refundable solely because the Buyer changes their mind after delivery.",
          "See the Returns & Refunds Policy \u00a75 for the underlying rules.",
        ],
      },
      {
        heading: "11. Shipping Issues",
        text: "When shipping problems occur:",
        list: [
          ["Maker should:", "provide shipment information, assist with carrier investigations, and work with the Buyer in good faith."],
          ["Buyer should:", "verify the shipping address provided, monitor tracking notifications, and report delivery problems promptly."],
          ["Crafters Market:", "may facilitate communication but is generally not responsible for carrier performance or shipping delays."],
        ],
      },
      {
        heading: "12. Chargebacks",
        bullets: [
          "If a Buyer initiates a payment dispute or chargeback through their payment provider, Crafters Market\u2019s internal review may be paused while the payment processor completes its investigation.",
          "Both Buyers and Makers are expected to cooperate during this process.",
          "See the Returns & Refunds Policy \u00a714 for detailed chargeback mechanics.",
        ],
      },
      {
        heading: "13. Fraud Prevention",
        text: "To protect the marketplace, Crafters Market reserves the right to investigate suspected:",
        bullets: [
          "Fraudulent claims.",
          "Return abuse.",
          "Payment fraud.",
          "False damage reports.",
          "Manipulated evidence.",
          "Abusive dispute activity.",
          "Knowingly submitting false claims may result in account restrictions or other enforcement actions.",
        ],
      },
      {
        heading: "14. Marketplace Enforcement",
        text: "When investigations reveal repeated or serious policy violations, Crafters Market may take actions including:",
        bullets: [
          "Educational warnings.",
          "Listing removal.",
          "Temporary account suspension.",
          "Permanent account termination.",
          "Additional account review.",
          "Payout restrictions where permitted by law.",
          "See the Prohibited Items Policy \u00a718 and the Maker Agreement \u00a721 for the enforcement escalation ladder.",
        ],
      },
      {
        heading: "15. Limitations",
        bullets: [
          "Buyer Protection is intended to support fair marketplace transactions but does not constitute an insurance program or guarantee.",
          "Nothing in this Policy modifies the legal relationship established in the Terms of Service or overrides applicable consumer-protection law.",
          "Non-waivable rights. Nothing in this Policy limits any non-waivable rights or protections provided under applicable law, including mandatory consumer-protection statutes in the Buyer's home jurisdiction. Where this Policy and applicable law conflict on a right that cannot be waived, the applicable law controls.",
        ],
      },
      {
        heading: "16. Policy Updates",
        bullets: [
          "We may update this Policy from time to time. Material changes will be communicated by posting the updated Policy to the Platform, by email, and / or by in-product notice prior to taking effect.",
          "The Effective Date and Last Updated values reflect the current version.",
          "Continued use of the Platform after the effective date of an update constitutes acceptance.",
          "This Policy is incorporated into the Terms of Service.",
        ],
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: "Draft v1.0 for legal review. Sections 8 (Resolution Options), 12 (Chargebacks), 13 (Fraud Prevention), 14 (Marketplace Enforcement), and 15 (Limitations \u2014 particularly the \u201cnot insurance\u201d framing) should be reviewed by counsel licensed in your operating jurisdiction(s) before this Policy is treated as fully binding.",
    },
    outro: (
      <>
        <p className="mb-3 text-ink-muted">
          Questions about this Policy or need to open a dispute? Contact the Maker
          first through the Platform messaging system; if you can\u2019t reach resolution,
          email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          with subject \u201cBuyer Protection Case\u201d and the details listed in Section 6.
        </p>
        <p className="text-ink-muted text-sm">
          <span>Version:</span> <b className="text-ink">1.1</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
          <br />
          <span>v1.1 · 2026-06-30 — Final legal-hardening pass (v3): §15 Limitations adds explicit non-waivable-rights carve-out.</span>
          <br />
          <span>v1.0 · 2026-06-30 — First dedicated Buyer Protection Policy section. 16 numbered sections. Replaces the prior \u201cbuyer-protection\u201d alias that redirected to the Marketplace fees section. Cross-referenced with ToS, Maker Agreement, Returns &amp; Refunds, Shipping, Prohibited Items.</span>
        </p>
      </>
    ),
  },

  {
    id: "custom",
    icon: Wand2,
    title: "Custom & Personalized Orders",
    intro: "Custom and personalized orders are a specialty of Crafters Market. Because each piece is made to your unique specifications, these orders require special considerations. The standards below are platform defaults — each shop may publish its own custom-order policy under their shop's profile, which takes precedence.",
    blocks: [
      {
        heading: "Platform standard (most shops follow this)",
        bullets: [
          "A design proof is sent for your approval before production begins",
          "You approve the proof in writing (email or message) before work proceeds",
          "Changes to the design after proof approval may incur additional fees",
          "Production begins only after proof approval and full payment",
        ],
      },
      {
        heading: "Shop-specific policies",
        text: "Some Makers opt out of the proof-approval step for very simple personalizations (e.g. name engraving on a stock SKU). Each Maker's individual Custom Order policy is shown on their Shop page and on every Listing detail page. Always review the Maker's Shop Policy before placing a Custom Order.",
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: (
        <>
          Custom orders are <b className="text-brand">non-refundable</b>{" "}
          once production has begun. Please review your proof carefully — we
          cannot accept returns on personalized items unless they arrive
          defective or damaged.
        </>
      ),
    },
    outro: "Rush production is available for most custom orders for an additional fee. Contact the maker before ordering to confirm availability.",
  },

  {
    id: "fulfillment",
    icon: Boxes,
    title: "Order Processing & Fulfillment",
    intro: (
      <>
        Most in-stock items ship within <b className="text-brand">1–3 business days</b>. Custom and made-to-order
        items have longer production windows — estimated times are listed on
        each product page.
      </>
    ),
    blocks: [
      {
        heading: "Production timelines by type:",
        list: [
          ["Standard in-stock items:", "1–3 business days"],
          ["Made-to-order pieces:", "5–10 business days"],
          ["Custom/personalized orders:", "7–14 business days after proof approval"],
          ["Large-format or commercial orders:", "14–21 business days (quoted per project)"],
          ["3D-printed pieces:", "3–10 business days depending on size & material"],
        ],
      },
    ],
    outro: "During peak seasons (November–January, major holidays), processing may take 1–2 additional business days. We'll notify you by email if your order is significantly delayed.",
  },

  {
    id: "payment",
    icon: CreditCard,
    title: "Payment Policy",
    intro: "We accept all major payment methods:",
    blocks: [
      {
        bullets: [
          "Visa, Mastercard, American Express, Discover",
          "Apple Pay & Google Pay",
          "Stripe Link (express checkout)",
        ],
      },
    ],
    callout: {
      tone: "info",
      icon: Lock,
      text: "All transactions are processed and secured by Stripe with SSL encryption. Crafters Market never stores your full card number.",
    },
    outro: (
      <>
        Payment is charged at the time of purchase. For custom orders, full
        payment is due upfront before production begins. For large commercial
        orders or wholesale inquiries, net-30 payment terms may be available
        — contact <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">{SUPPORT_EMAIL}</a> to discuss options.
      </>
    ),
  },

  {
    id: "marketplace",
    // iter413dl — Both alias anchors dropped in this wave now that
    // both destinations have their own dedicated sections:
    // "buyer-protection" → its own section below (v1.0)
    // "maker-agreement"  → its own section below (v3.0)
    aliasIds: [],
    icon: ShieldCheck,
    title: "Makers Market — Fee & Commission Policy",
    intro: "Crafters Market's Makers Market allows approved Makers to list and sell their work directly to Buyers on our Platform.",
    blocks: [
      {
        heading: "For Makers — Fees & Tiers",
        list: [
          ["Listing fee (Free tier):", "First 10 Listings are free for the lifetime of the account; each additional Listing or renewal is $0.20"],
          ["Listing fee (Crafters Plus):", "First 15 Listings each calendar month are free; each additional Listing/renewal is $0.20"],
          ["Monthly fee:", "$0 on the Free tier — no subscription required. Crafters Plus is optional at $12/month"],
          ["Commission (Free tier):", "5% of the final item subtotal, retained on completed transactions"],
          ["Commission (Crafters Plus):", "4% of the final item subtotal — a 1% discount vs. Free tier"],
          ["Payment processing:", "3% of the final item subtotal, retained to cover Stripe processing costs (applies to all tiers)"],
          ["Total deducted per sale:", "Free tier: 8% (5% commission + 3% processing) · Plus: 7% (4% + 3%)"],
          ["Off-site ad fee:", "12% of the item subtotal on sales attributed to Crafters Market off-site ad campaigns (Google / Meta). Only charged when an off-site ad directly drives the sale"],
          ["Promoted Listing fee:", "$5 / week per promoted Listing (optional, opt-in only)"],
        ],
        bullets: [
          "All Makers must apply and be approved before listing",
          "Makers set their own prices and ship directly to Buyers",
          "Makers are independent contractors, not employees of Crafters Market",
          "Payouts are issued via Stripe Connect to the Maker's verified bank account",
          "All fees are calculated on the item subtotal (excluding shipping and sales tax) and deducted automatically before payout",
          "Listing-fee charges accrue to a balance and are settled against your next payout — no upfront card billing for listing fees",
          "Crafters Plus subscription auto-renews monthly; you may cancel at any time from the Maker Dashboard. Cancellation takes effect at the end of the current billing period",
        ],
      },
      {
        heading: "For Buyers purchasing through Makers Market",
        bullets: [
          "Transactions are facilitated by Crafters Market via Stripe; the Maker fulfills the Order",
          "Each Maker's individual shipping, returns, and Custom Order Shop Policies apply",
          "Crafters Market is not responsible for the workmanship, condition, or shipping of any individual Maker's Listings beyond the Buyer Protection Policy and any protections offered by Stripe",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "All Makers Market participants are vetted and approved by Crafters Market. Maker Shop pages include their individual Shop Policies. We encourage Buyers to review a Maker's Shop Policy before purchasing.",
    },
  },

  // iter413fp — Fee & Pricing Policy v1.0 (2026-06-30). Consolidated,
  // standalone commercial-terms document. Existed previously as a
  // sub-block inside the "marketplace" section; extracted here so that
  // pricing changes don't require editing Terms, Maker Agreement, or
  // multiple other documents.
  //
  // Cross-refs: Terms §5 (Fees, Payments & Payouts), Maker Agreement §14
  // (Fees & Stripe Connect), Returns & Refunds Policy, Buyer Protection
  // Policy, Shipping & Logistics Policy.
  {
    id: "fee-pricing",
    icon: Receipt,
    title: "Fee & Pricing Policy",
    intro: "This Fee & Pricing Policy is the single source of truth for the commercial terms of selling on Crafters Market: commissions, listing fees, subscription fees, payment-processing fees, optional advertising fees, refund/chargeback handling, and payout timing. It supplements (and where more specific, controls over) the Fee-related sections of the Terms of Service and the Maker Agreement.",
    blocks: [
      {
        heading: "1. Who This Policy Applies To",
        bullets: [
          "This Policy applies to every approved Maker on Crafters Market, including Founding Sellers, Free-tier Makers, and Crafters Plus subscribers.",
          "Buyers do not pay Platform fees. Buyers pay the item price, any Maker-set shipping, and any applicable sales tax collected by Crafters Market as a marketplace facilitator or by the Maker where required.",
          "All fees below are calculated on the item subtotal in U.S. dollars, excluding shipping and sales tax, unless otherwise stated.",
        ],
      },
      {
        heading: "2. Fee Schedule at a Glance",
        list: [
          ["Free tier — commission:", "5% of the item subtotal on each completed sale."],
          ["Free tier — listing fee:", "First 10 active Listings are free for the lifetime of the account. Each additional new Listing or renewal is $0.20."],
          ["Free tier — monthly fee:", "$0. No subscription required."],
          ["Crafters Plus — commission:", "4% of the item subtotal (1% lower than Free tier)."],
          ["Crafters Plus — listing fee:", "First 15 new Listings each calendar month are free. Each additional new Listing or renewal is $0.20."],
          ["Crafters Plus — subscription:", "$12 / month, billed via Stripe. Auto-renews monthly; cancel any time from the Maker Dashboard. Cancellation takes effect at the end of the current billing period."],
          ["Payment processing (all tiers):", "3% of the item subtotal, retained to cover Stripe payment-processing costs. Applies to every completed sale."],
          ["Total deducted per sale:", "Free tier: 8% (5% commission + 3% processing). Crafters Plus: 7% (4% commission + 3% processing)."],
          ["Off-site advertising fee:", "12% of the item subtotal on sales attributable to Crafters Market off-site ad campaigns (Google, Meta). Charged only when an off-site ad directly drives the sale — see Section 6 below."],
          ["Promoted Listing fee:", "$5 / week per promoted Listing. Opt-in only; you control which Listings are promoted and when."],
        ],
      },
      {
        heading: "3. Founding Seller Program",
        bullets: [
          "Founding Sellers are the Version 1 cohort of Makers admitted to Crafters Market. Founding Seller benefits are described in the Maker Agreement §4 (Founding Seller Program) and may include preferred placement, reduced fees, or inaugural perks announced for the cohort.",
          "Any Founding Seller fee reduction (for example, a temporary commission discount) is layered on top of the tier that Founding Seller has selected (Free or Crafters Plus). Founding Seller benefits are a discount on the schedule in Section 2, not a separate tier.",
          "Founding Seller benefits are personal to the Maker account, non-transferable, and may be revoked, modified, or ended at Crafters Market's sole discretion per the Maker Agreement §4.",
        ],
      },
      {
        heading: "4. Payment Processing (Stripe)",
        bullets: [
          "All Buyer payments are processed by Stripe (and any successor payment processor). By accepting Orders you agree to Stripe's Connected Account Agreement and Services Agreement, in addition to the Terms of Service and the Maker Agreement.",
          "The 3% payment-processing fee in Section 2 is retained by Crafters Market to cover the payment-processor charges we incur on your sale (interchange, network fees, Stripe processing fees, and platform-processing overhead). It is not an additional profit line item.",
          "Stripe may hold, reserve, or freeze funds independently of Crafters Market as required by its risk, compliance, and reserve programs. Those Stripe-initiated holds are governed by Stripe's own agreements, not this Policy.",
        ],
      },
      {
        heading: "5. Listing Fees",
        bullets: [
          "A Listing fee is charged when you publish a new Listing beyond your tier's free allowance, or when you renew a Listing that has expired.",
          "Free tier: the first 10 active Listings on the account are free for the lifetime of the account. After the 10th active Listing, each new Listing or renewal is $0.20. If you delete a Listing that is inside the first 10, the free-Listing count does not refresh.",
          "Crafters Plus tier: the first 15 new Listings each calendar month are free. After the 15th new Listing that month, each additional new Listing or renewal is $0.20. The 15-Listing allowance resets on the 1st of each calendar month and does not roll over.",
          "Listing-fee charges accrue to a Maker balance and are settled against your next payout. Crafters Market does not bill your card for Listing fees on the Free tier; the Crafters Plus $12 monthly fee is billed to your saved card on the anniversary of your subscription start.",
          "Listing fees are non-refundable when you delete a Listing that has already been published, except as required by law.",
        ],
      },
      {
        heading: "6. Off-Site Advertising Fee",
        bullets: [
          "Crafters Market runs paid advertising for Maker Listings across off-platform surfaces including Google, Meta, Pinterest, and TikTok. When one of those ad clicks results in a completed sale within the attribution window, that sale is treated as an off-site-ad sale.",
          "The Off-Site Advertising Fee is 12% of the item subtotal, applied only on sales attributed to a Crafters Market off-site ad campaign. It replaces (does not stack on top of) the standard commission on that sale.",
          "The 3% payment-processing fee still applies on off-site-ad sales; total deduction on an attributed sale is 15% (12% off-site ad fee + 3% processing).",
          "Off-site advertising is a marketplace-run program and is not opt-in per Maker at this time. If we introduce an opt-out mechanism, it will be documented here and in the Maker Agreement.",
          "For clarity: sales that are not attributed to a Crafters Market off-site ad campaign remain on the standard tier commission (5% Free / 4% Plus).",
        ],
      },
      {
        heading: "7. Promoted Listings",
        bullets: [
          "Promoted Listings are an optional, opt-in Maker product that gives your Listing preferred placement on Crafters Market search and category pages.",
          "The fee is $5 per week per promoted Listing, charged in advance and non-refundable once the promotion window has started.",
          "You choose which Listings to promote, when to start, and when to stop. Promoted Listings do not carry any additional commission — the standard tier commission on Section 2 still applies to sales that come from a Promoted Listing.",
        ],
      },
      {
        heading: "8. Refunds, Chargebacks & Adjustments",
        bullets: [
          "When an Order is refunded (in full or in part), Crafters Market refunds the corresponding portion of the item subtotal to the Buyer. The tier commission on the refunded amount is reversed and credited back to the Maker balance in accordance with this Policy.",
          "Stripe payment-processing fees. Stripe payment-processing fees are governed by the payment processor (Stripe) and its published schedule. Stripe may retain a non-refundable portion of processing fees on refunded transactions; that portion is set by Stripe and may not be recoverable by the Platform or the Maker. Where Stripe retains a non-refundable processing fee, that portion is not credited back to the Maker balance.",
          "Off-site ad fees on refunded attributed sales. Any Off-Site Advertising Fee on an off-site-ad-attributed sale is retained if the corresponding advertising cost has already been paid to the advertising network at the time of refund.",
          "For chargebacks initiated by a Buyer's card issuer, Crafters Market will attempt to resolve the dispute with the Buyer, the Maker, and Stripe. If a chargeback is lost or settled in favor of the Buyer, the disputed amount is debited from the Maker balance, along with any chargeback fee levied by the card network or Stripe.",
          "Marketplace-Assistance refunds funded by Crafters Market under the Buyer Protection Policy are handled per that policy. Where the Platform funds a Buyer refund because the Maker did not fulfill a contested Order, Crafters Market may recover the refunded amount from future Maker payouts.",
          "Any adjustment (fee correction, chargeback reversal, bonus credit, promotional refund) will be recorded on the Maker's Payout & Fees statement in the Maker Dashboard. Makers may raise a fee dispute in writing within 60 days of the payout statement in which the item appeared.",
        ],
      },
      {
        heading: "9. Payout Timing",
        bullets: [
          "Payouts are issued via Stripe Connect to the Maker's verified bank account on the payout schedule configured in the Maker's Stripe account (default: daily rolling with a standard delay for new sellers; see Stripe's documentation).",
          "The first payout for a new Maker may be delayed by Stripe until identity and bank verification are complete.",
          "Payout holds initiated by Crafters Market are limited to the operational triggers described in Terms of Service §5 and Maker Agreement §14: Stripe risk/compliance, fraud investigation, active chargeback or dispute, identity-verification review, or an active legal/regulatory inquiry. A hold lasts only as long as reasonably necessary to resolve the underlying issue.",
          "Some payout holds are imposed directly by third parties \u2014 including Stripe, card networks, payment networks, financial institutions, or regulatory authorities \u2014 pursuant to their own compliance, risk, or reserve obligations. Crafters Market cannot override or accelerate those holds where it does not control fund release. Those holds are governed by Stripe's Connected Account Agreement and the applicable card-network or regulatory rules.",
          "Communication during holds. Crafters Market will make reasonable efforts to inform the Maker of the general reason for a payout hold, unless prohibited by law, card-network rules, an ongoing fraud investigation, or a regulatory requirement. We do not commit to any specific evidence, documentation, or notice threshold beyond what is reasonably practical under the circumstances.",
          "Funds not subject to a legitimate hold trigger continue to release on the normal payout cadence.",
        ],
      },
      {
        heading: "10. Sales Tax & Marketplace-Facilitator Obligations",
        bullets: [
          "In U.S. states that treat Crafters Market as a marketplace facilitator, Crafters Market collects and remits sales tax on qualifying Orders on the Maker's behalf. Marketplace-facilitator sales tax is added to the Buyer's total at checkout and does not reduce the Maker payout.",
          "In jurisdictions where Crafters Market is not a marketplace facilitator, the Maker remains responsible for collecting and remitting the tax due on the Maker's own sales.",
          "Sales tax is not part of the item subtotal on which commissions and fees are calculated (see Section 1). Sales tax is passed through and does not increase Maker or Platform revenue.",
          "For international Orders, Buyers are the importer of record and are responsible for any duties, VAT/GST, or customs fees, as described in the Shipping & Logistics Policy.",
        ],
      },
      {
        heading: "11. Currency, FX & Payment Methods",
        bullets: [
          "All prices on Crafters Market are set and quoted in U.S. dollars (USD) at Version 1. All fees and payouts are settled in USD.",
          "If the marketplace introduces additional currencies or Maker-side payout currencies, this Policy will be updated with the FX handling and any conversion fees before the change takes effect.",
          "Accepted Buyer payment methods are listed in the Payment Policy section of the site and include Visa, Mastercard, American Express, Discover, Apple Pay, Google Pay, and Stripe Link.",
        ],
      },
      {
        heading: "12. Changes to This Policy",
        bullets: [
          "Crafters Market may update this Fee & Pricing Policy from time to time to reflect changes in commissions, listing fees, subscription pricing, advertising fees, or any other commercial term.",
          "Changes will apply prospectively — never retroactively to a completed sale.",
          "Fee increases and new fees. We will provide at least sixty (60) days' advance notice of any change that increases an existing fee or introduces a new fee, via email to the address on file for the Maker account and via an in-Dashboard notice.",
          "Click-acceptance for material fee increases. Where a fee change materially increases the Maker's cost of selling on the Platform, we may require you to review and click-accept the updated Policy before creating new Listings or receiving payouts on or after the effective date. Click-acceptance is stronger evidence of contractual acceptance than continued use alone and does not replace the notice period in the preceding bullet.",
          "Fee reductions and promotional pricing. Fee reductions, promotional discounts, waived fees, temporary rate cuts, and other Maker-favorable changes may take effect immediately or on a shorter notice window, at Crafters Market's discretion. We will still record the change in this Policy's revision history.",
          "Continued use of the Platform after the applicable notice period (and, where required, click-acceptance of a material increase) constitutes acceptance of the updated Policy. If you do not agree to a fee increase or new fee, you may cancel Crafters Plus, pause your Shop, or close your Maker account before the change takes effect. Any Founding Seller fee protections continue to be governed by the Maker Agreement §4.",
          "The current version of this Policy always lives at /policies/fee-pricing. Prior versions are summarized in the Revision History section of this document.",
        ],
      },
      {
        heading: "13. Related Policies & Cross-References",
        bullets: [
          "Terms of Service §5 — Fees, Payments & Payouts (the underlying contractual authority for this Policy).",
          "Maker Agreement §14 — Fees & Stripe Connect (Maker-specific fee obligations, payout holds, and offset rights).",
          "Buyer Protection Policy — when Crafters Market funds a refund and when it recovers that amount from the Maker.",
          "Returns & Refunds Policy — how returns, exchanges, and refunds are processed and how they interact with commissions and processing fees.",
          "Shipping & Logistics Policy — risk of loss, carrier responsibility, and international-duty handling; shipping revenue is separate from the item-subtotal fee schedule in this Policy.",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "This Policy is the definitive source for Crafters Market fees. Where any other document summarizes fees for context, this Policy controls if there is a conflict.",
    },
    outro: (
      <>
        <span className="text-ink-muted">Version:</span>{" "}
        <b className="text-ink">1.3</b>
        <span className="text-ink-muted"> · Last updated:</span>{" "}
        <b className="text-ink">2026-06-30</b>
        <span className="text-ink-muted"> · Effective:</span>{" "}
        <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
      </>
    ),
  },

  // iter413dl — Maker Agreement v3.0. Expanded from owner-uploaded v2.1
  // draft per the v3.0 implementation brief (2026-06-30). Sections marked
  // LEGAL_REVIEW_REQUIRED are placeholders pending attorney finalization.
  // Until those placeholders land, makers continue to be bound by the
  // "For Sellers" bullets in the top-of-page Terms of Service and the
  // fee/commission schedule in the Marketplace section above.
  //
  // Terminology — consistent across the marketplace policy suite:
  //   Maker | Buyer | Platform | Listing | Order | Shop Policy
  //   Digital Product | Custom Order | User Content
  {
    id: "maker-agreement",
    icon: Handshake,
    title: "Maker Agreement",
    intro: "This Maker Agreement (\u201cAgreement\u201d) is a binding legal agreement between you (\u201cMaker\u201d or \u201cyou\u201d) and Crafters Market (\u201cwe,\u201d \u201cus,\u201d \u201cour,\u201d or the \u201cPlatform\u201d). By applying to become a Maker, listing items for sale, or using any seller tools on the Platform, you agree to the terms below. This Agreement supplements the Crafters Market Terms of Service and works alongside the Privacy Policy, Returns & Refunds Policy, Community Guidelines, and Prohibited Items Policy. Where this Agreement and the Terms of Service conflict, the more specific term controls for issues relating to Maker activity.",
    blocks: [
      {
        heading: "1. Introduction",
        bullets: [
          `Effective date: ${POLICY_EFFECTIVE_DATE}.`,
          "Last updated: 2026-06-30. Version 3.0.",
          "By applying to become a Maker, listing items, or using seller tools, you accept this Agreement and the Terms of Service.",
          "This Agreement applies to all approved Makers on the Platform, including Founding Sellers.",
          "Defined terms used throughout this Agreement (Maker, Buyer, Platform, Listing, Order, Shop Policy, Digital Product, Custom Order, User Content) carry the meanings given in the Terms of Service unless re-defined here.",
        ],
      },
      {
        heading: "2. Maker Eligibility",
        bullets: [
          "Becoming a Maker requires an application; approval is at Crafters Market's sole discretion and is not guaranteed.",
          "We may verify identity, business legitimacy, and the handmade nature of your work as part of the review process.",
          "You must be at least 18 years old (or the age of majority in your jurisdiction) and legally able to enter into a binding contract.",
          "You represent that you have all legal authority to sell the items you list — including any licenses, permits, or registrations required for your craft, materials, or jurisdiction.",
          "You agree to maintain compliance with applicable federal, state, and local laws throughout your participation on the Platform.",
          "Acceptance into the marketplace is not guaranteed; we may decline applications without disclosing the reason.",
        ],
      },
      {
        heading: "3. Independent Business Relationship",
        text: "Makers are independent businesses. Nothing in this Agreement creates an employment, agency, partnership, franchise, or representative relationship between you and Crafters Market. Specifically, you are not:",
        bullets: [
          "an employee of Crafters Market;",
          "an independent contractor of Crafters Market;",
          "an agent of Crafters Market;",
          "a franchisee of Crafters Market;",
          "a partner of Crafters Market; or",
          "a representative authorized to bind or speak on behalf of Crafters Market.",
        ],
      },
      {
        heading: "4. Founding Seller Program",
        bullets: [
          "Eligibility for the Founding Seller program is determined by Crafters Market based on application date, application quality, and category coverage. The program is capped per category and per overall cohort.",
          "Approved Founding Sellers receive a permanent founder badge displayed on the Maker profile and any benefits announced for that cohort (which may include preferred placement, reduced fees, or inaugural perks).",
          "Lifetime benefits, where granted, are tied to good standing on the Platform. Material or repeated violations of this Agreement, the Terms of Service, or the Community Guidelines may result in revocation of the founder badge and any associated benefits.",
          "Revocation, demotion within, or amendment to the Founding Seller program is at Crafters Market's sole discretion. We will notify affected Founding Sellers of any material program changes.",
          "Founding Sellers remain subject to all other provisions of this Agreement; the program is additive, not a substitute for compliance.",
        ],
      },
      {
        heading: "5. Account Responsibilities",
        bullets: [
          "You are responsible for the security of your Maker account, including safeguarding login credentials and any API keys we issue.",
          "You agree to choose a strong, unique password and to enable any multi-factor authentication options we provide.",
          "You agree to keep your account information (legal name, business name, email, mailing address, phone, banking information via Stripe Connect, and tax-identification information) accurate and current at all times.",
          "Account sharing is prohibited. Each Maker account must be controlled by an individual or legally identifiable business entity. Sub-users (if offered) must be authorized and traceable.",
          "You are responsible for all activity that occurs under your account. Notify us immediately at " + SUPPORT_EMAIL + " of any unauthorized use or suspected compromise.",
          "Subject to applicable law and good-faith reasons, a single individual or business should maintain a single Maker account; duplicate accounts created to evade enforcement, ratings, or fee structures are prohibited.",
        ],
      },
      {
        heading: "6. Listing Standards",
        bullets: [
          "All Listings must include accurate, truthful titles and descriptions. Misleading titles, deceptive size or material claims, and unsupported performance claims are prohibited.",
          "Listing photography must be your own original work, photography licensed to you, or photography you are otherwise authorized to use. Hot-linking competitors' images or scraping marketplace photos is prohibited.",
          "Pricing must be truthful. Phantom \u201csale\u201d pricing, fake markdowns, and bait-and-switch tactics are prohibited.",
          "You must keep inventory levels accurate. Overselling an item is a violation that can trigger seller-performance review (see Section 13).",
          "You must clearly state production timelines on Listings for made-to-order or back-ordered items.",
          "Where a Listing contains manufactured or sourced components, you must disclose this in the description (see Section 7).",
          "Keyword stuffing, hidden search terms, duplicate Listings created solely to game search ranking, and other forms of search manipulation are prohibited.",
        ],
      },
      {
        heading: "7. Handmade & Original Work",
        text: "Crafters Market is a handmade marketplace. To protect marketplace integrity, every Listing must fit one of the following Maker-disclosed categories:",
        bullets: [
          "Handmade: produced by you or under your direct supervision, with substantial creative or physical contribution from a human maker.",
          "Handcrafted with sourced components: handmade by you using one or more manufactured components (e.g. clock movements, hardware, blanks) that are not themselves handmade. You must disclose this on the Listing.",
          "Designed by Maker: items where you supplied the design and finishing but production was completed by an approved Production Partner. Production Partners must be disclosed on your Maker profile and follow our Production Partner policy where applicable.",
          "Assembled from components: items assembled by you from non-handmade components (e.g. kits). You must disclose this on the Listing and may not list these items as \u201chandmade.\u201d",
          "Resale, drop-shipping, mass-produced inventory, and AI-generated-and-printed merchandise without substantial human creative contribution are not permitted on the Platform.",
        ],
      },
      {
        heading: "8. Product Safety & Compliance",
        bullets: [
          "You certify that your products comply with all applicable laws, regulations, and safety standards.",
          "You certify that your products are not subject to a current recall and that you will immediately remove and notify Crafters Market of any product that becomes subject to a recall.",
          "You certify that you meet category-specific regulatory requirements (e.g. CPSIA for children\u2019s products, FDA labeling for cosmetics and food, fiber content disclosure for textiles, lead-content limits for jewelry).",
          "You certify that hazardous-material shipping rules are followed for products containing flammables, magnets, batteries, aerosols, or other regulated content.",
          "Misrepresentation of safety or compliance status may result in immediate listing removal and account suspension (see Section 21).",
        ],
      },
      {
        heading: "9. Intellectual Property",
        bullets: [
          "You warrant that you own or have all necessary rights to the items you list and to any User Content you upload.",
          "You will not infringe any third party\u2019s copyright, trademark, trade dress, publicity, or other intellectual-property right.",
          "AI-assisted content (designs, listing text, descriptions, photography enhancements) does not change your ownership warranty. You remain responsible for ensuring that AI-generated or AI-assisted material does not infringe copyright, trademark, or licensing terms of any model, training set, or third party.",
          "Reporting infringement: if you believe a Listing on the Platform infringes your intellectual property, file a notice per the DMCA process described in the Intellectual Property Policy section below.",
          "Repeat infringement: Crafters Market follows a repeat-infringer policy. Accounts subject to multiple substantiated infringement claims may be suspended or terminated (see Section 21).",
        ],
      },
      {
        heading: "10. User Content License",
        bullets: [
          "You retain ownership of all User Content you upload (photos, videos, listing text, logos, digital files, custom design uploads). Content ownership always remains with the Maker; nothing in this license transfers ownership of underlying intellectual property to Crafters Market.",
          "Purpose limitation. The license granted in this Section exists solely for the purpose of operating, marketing, and promoting the marketplace and the visibility of your Shop and Listings. It does not authorize Crafters Market to use your User Content for any purpose outside operating and promoting the marketplace, and does not authorize AI Model Training on your User Content (see §10a).",
          "You grant Crafters Market a worldwide, non-exclusive, royalty-free, sublicensable license to host, display, reproduce, adapt for display, distribute, and create derivative works of your User Content for the purposes stated in the preceding bullet.",
          "Permitted uses include: marketplace display, search and discovery, marketing, advertising, product-catalog syndication (Google Merchant Center, Meta, Pinterest, TikTok, and similar channels), social-media promotion, email newsletters, and other Platform-driven promotional campaigns.",
          "License termination on account closure. When you close your Maker account or delete a specific piece of User Content, the operational license granted in this Section will end with respect to that content as soon as reasonably possible, subject to the following limited carve-outs where the residual use is outside our practical control or is required for lawful business reasons: (a) legal, tax, accounting, dispute, or regulatory-compliance retention required by law; (b) completed transactions — Order records, receipts, invoices, and related records must be retained for the length of applicable dispute, chargeback, and tax windows; (c) archived backups — routinely-rotated encrypted backups may retain a copy until the next rotation cycle; (d) previously published marketing — email newsletters, blog articles, social posts, ad creative, and other outbound materials already published before account closure may remain in place; and (e) cached copies on third-party systems — cached, syndicated, or indexed copies on services outside our practical control (search engines, ad networks, social platforms) may persist until those systems refresh.",
          "During the period necessary to wind down the operational license under the preceding bullet, Crafters Market will not use your User Content for any new promotional campaign or new syndication once the account is closed.",
        ],
      },
      {
        heading: "10a. AI Use — Creator-Owned AI Policy",
        bullets: [
          "Your creativity belongs to you. This section clarifies what Crafters Market may and may not do with your User Content when AI tools are involved. It sits alongside — and is expressly narrower than — the general license in Section 10.",
          "Allowed under the Section 10 license (\u201cOperational AI\u201d): Crafters Market may use AI-powered tools to operate and market the Platform. Examples include search relevance, personalized recommendations, fraud and spam detection, on-platform translations, accessibility enhancements, customer-support assistance, Listing optimization suggestions, SEO metadata generation, and the use of third-party advertising platforms (Google Ads, Meta / Facebook / Instagram, Pinterest, TikTok, Reddit, and similar surfaces) solely to generate, optimize, target, and deliver advertisements that promote Maker Listings. Operational AI also includes email campaigns, blog articles, product-description drafts, promotional graphics, video scripts, and social captions used to promote the marketplace.",
          "Operational AI is considered part of running and promoting the marketplace, and does not require a separate consent from you.",
          "NOT allowed under the Section 10 license (\u201cAI Model Training\u201d): Crafters Market will not use your User Content to train image-generation models, large language models, recommendation foundation models, or other commercial AI/machine-learning systems, and will not license or otherwise permit your User Content to be used by any third party (including any third-party advertising provider) to train commercial foundation models, unless you have provided explicit, affirmative, opt-in consent for that specific purpose. For the avoidance of doubt, the Operational AI license does not authorize the Platform or any third-party advertising provider to train commercial foundation models using your User Content.",
          "Silence, inaction, or continued marketplace participation are not consent to AI Model Training. Consent must be affirmative.",
          "If we launch an AI Training Program in the future, participation will require: (a) a separate consent step distinct from acceptance of this Maker Agreement; (b) a clear description of the intended training use, data scope, and any counterparties; (c) the ability to withdraw consent at any time, subject to reasonable technical limitations for models already trained; and (d) no reduction in your visibility, ranking, payouts, marketplace access, or other Maker benefits for declining to participate.",
          "This section survives termination of the Maker Agreement with respect to any consent you may have granted before termination.",
          "This section is a companion to Section 6a of the Terms of Service and the \u201cHow We Use AI\u201d section of the Privacy Policy. In the event of a conflict between the three, this section controls with respect to AI use of Maker Content.",
        ],
      },
      {
        heading: "11. Shipping & Fulfillment",
        bullets: [
          "You must meet the processing times stated on your Listings and in your Shop Policies. Where a timeline is not stated, default Platform timelines (see Order Processing & Fulfillment section) apply.",
          "Orders must be shipped using a method that provides tracking unless the item type makes tracking impractical and this is disclosed in your Shop Policies.",
          "You are responsible for packaging items so they arrive undamaged.",
          "You are responsible for communicating delays to Buyers as soon as you become aware of them.",
          "Lost shipments: if a tracked shipment is lost in transit, you are responsible for investigating with the carrier and resolving the situation with the Buyer (replacement, refund, or insurance claim, as appropriate).",
          "Damaged shipments: you are responsible for honoring your Shop Policy and the Returns & Refunds Policy with respect to items damaged in transit.",
          "You are responsible for any customs documentation if international shipping is enabled in the future.",
        ],
      },
      {
        heading: "12. Customer Service Standards",
        bullets: [
          "You must communicate with Buyers professionally and respectfully at all times.",
          "You must respond to Buyer messages within a reasonable timeframe \u2014 generally within two (2) business days.",
          "You must address order issues in good faith, working with the Buyer toward resolution before escalating to Platform dispute review.",
          "You must keep Buyers informed of order status, especially for Custom Orders and made-to-order items.",
          "Abusive, harassing, discriminatory, or threatening communication with a Buyer is a serious violation and may result in immediate suspension (see Section 21).",
        ],
      },
      {
        heading: "13. Seller Performance Standards",
        text: "Repeated failure to meet the following measurable standards may trigger enforcement under Section 21:",
        bullets: [
          "Excessive order cancellations (above a threshold we set and disclose in the Maker dashboard) without legitimate cause.",
          "Excessive Buyer disputes (e.g. \u201citem not as described,\u201d \u201cnot received\u201d) above the Platform average for your category.",
          "Repeated late shipments past your stated processing time.",
          "Listings found to be materially inaccurate after Buyer complaint or Platform review.",
          "Abusive, harassing, or discriminatory communication with Buyers, other Makers, or Crafters Market staff.",
          "Failure to respond to Buyer messages or Platform inquiries within reasonable timeframes.",
          "Enforcement is progressive where possible: notice → warning → temporary suspension → termination. Severe violations may skip steps.",
        ],
      },
      {
        heading: "14. Payments & Stripe Connect",
        bullets: [
          "Payments are processed via Stripe and routed to your verified bank account through Stripe Connect. Use of Stripe Connect requires you to accept Stripe\u2019s Connected Account Agreement.",
          "You must complete Stripe\u2019s identity verification (KYC) and provide accurate banking information. Payouts cannot be released to unverified accounts.",
          "Standard payout schedule is set by Stripe\u2019s defaults unless you adjust it in your Stripe Express dashboard.",
          "Payout holds initiated by Crafters Market are limited to legitimate operational triggers: (a) Stripe risk, compliance, or reserve requirements; (b) fraud investigations opened by Crafters Market or a card network; (c) active chargeback or dispute proceedings; (d) Maker identity-verification review; (e) an active legal, tax, or regulatory-compliance inquiry. A hold lasts only as long as reasonably necessary to resolve the underlying issue, including any applicable Stripe timelines, the card network's dispute lifecycle, or the timeline of a legal/regulatory inquiry. Funds not subject to a legitimate hold trigger are released on the normal payout cadence.",
          "Third-party-controlled holds. Some payout holds are imposed directly by third parties \u2014 including Stripe, card networks, payment networks, financial institutions, or regulatory authorities \u2014 pursuant to their own compliance, risk, or reserve obligations. Crafters Market cannot override or accelerate those holds where it does not control fund release. In those cases, resolution is governed by Stripe's Connected Account Agreement and the applicable card-network or regulatory rules, and we will assist you with information and cooperation where reasonably practical.",
          "Communication during holds. Crafters Market will make reasonable efforts to inform you of the general reason for a payout hold, unless prohibited by law, card-network rules, an ongoing fraud investigation, or a regulatory requirement. We do not commit to any specific evidence, documentation, or notice threshold beyond what is reasonably practical under the circumstances.",
          "Reserves: we may require a rolling reserve on payouts for accounts with elevated dispute or chargeback risk.",
          "Negative balances: if refunds or chargebacks exceed pending payouts, the resulting negative balance must be settled by you. We may recover negative balances from subsequent payouts or, if necessary, by direct collection.",
          "Failed transfers: if a payout to your bank fails, we will retry per Stripe\u2019s retry schedule; persistent failure may pause payouts until banking information is corrected.",
          "Chargebacks: you are responsible for chargebacks initiated by Buyers. We will work with you to gather evidence but cannot guarantee chargeback reversal.",
          "Payment disputes: see Section 15 (Returns) and Section 20 (Dispute Cooperation).",
          "Platform fees (commission, payment processing, off-site ad fees, and any promoted-listing fees) are deducted from each sale before payout. The current fee schedule is set out in the Marketplace section above and is incorporated into this Agreement by reference.",
        ],
      },
      {
        heading: "15. Returns, Refunds & Cancellations",
        bullets: [
          "You are responsible for honoring refunds, exchanges, and cancellations consistent with your published Shop Policies, the Crafters Market Returns & Refunds Policy, and any consumer-protection rights that cannot be waived by contract.",
          "Where a refund is issued, the platform commission attributable to that refunded amount is also refunded to you. Stripe\u2019s payment-processing fees are generally not refunded by Stripe and are therefore not refunded by Crafters Market.",
          "Custom Orders may have a no-refund policy after production begins, provided this is clearly disclosed at time of purchase and consistent with applicable law.",
          "You agree to follow the dispute and cooperation provisions in Section 20.",
        ],
      },
      {
        heading: "16. Custom Orders",
        bullets: [
          "You must clearly state estimates, deposit requirements (if any), proof/approval steps, revision policy, production timelines, and refund/cancellation rules before the Buyer pays.",
          "Production should not begin until any required Buyer approvals (e.g. proof sign-off) are received.",
          "Personalized products (engraving, embroidery, monogramming, custom sizing) may be designated non-refundable provided the Listing clearly discloses this.",
          "Abandoned projects: where a Buyer fails to respond to required approval requests, you should follow up on a reasonable cadence and document attempts. Crafters Market may intervene if the situation cannot be resolved between you and the Buyer.",
          "You remain responsible for delivering the agreed work within the stated timeline.",
        ],
      },
      {
        heading: "17. Digital Products",
        bullets: [
          "Digital Products include downloadable files such as patterns, templates, SVGs, fonts, print-at-home designs, and other non-physical deliverables.",
          "You must clearly state the license granted with each Digital Product, including whether commercial use is permitted, attribution requirements (if any), and any redistribution restrictions.",
          "Digital Products are generally not eligible for return once downloaded; you must surface this on the Listing.",
          "You are responsible for providing reasonable support for download failures and duplicate-purchase situations.",
          "You retain ownership of your Digital Products subject to the User Content License in Section 10.",
        ],
      },
      {
        heading: "18. Taxes & Regulatory Compliance",
        bullets: [
          "You are responsible for determining, collecting, reporting, and remitting all taxes arising from your sales on Crafters Market \u2014 including income tax, self-employment tax, and sales/use tax where applicable \u2014 except where Crafters Market is required to collect and remit on your behalf under marketplace-facilitator laws.",
          "Where marketplace-facilitator law requires Crafters Market to collect and remit sales tax on your behalf, we will do so and remove that responsibility from you for the applicable jurisdictions.",
          "You are responsible for obtaining and maintaining all permits, licenses, and registrations required for your craft, materials, jurisdiction, or category of goods sold.",
          "We may issue you an IRS Form 1099-K or other tax form where required, based on your payout activity. You agree to provide accurate tax-identification information (W-9 or W-8 series as applicable) in your Stripe Connect onboarding.",
          "Product-specific legal requirements (food safety, cosmetic labeling, child-product safety, fiber-content disclosure, hazardous-materials shipping, etc.) are your responsibility \u2014 see also Section 8.",
        ],
      },
      {
        heading: "19. Privacy Roles & Buyer Data",
        bullets: [
          "Role split. Crafters Market operates the Platform, marketplace services, payment facilitation, and Order administration \u2014 and acts as data controller for those functions. You, the Maker, are an independent seller and act as an independent data controller for Buyer information you receive to fulfill Orders you accept.",
          "When you receive a Buyer\u2019s information through the Platform (name, shipping address, contact details), you may use that information only to fulfill the Order, provide customer service for that Order, and comply with legal obligations that apply to you.",
          "You must protect Buyer information using reasonable security measures and may not retain it longer than necessary for the purposes above.",
          "You must comply with all applicable privacy laws with respect to Buyer information you receive \u2014 including but not limited to CAN-SPAM, GDPR (if you reach EU Buyers), and applicable U.S. state privacy laws.",
          "You may not use Buyer information for unrelated marketing without obtaining appropriate consent (for example, a Buyer\u2019s explicit opt-in to your own newsletter outside the Platform).",
          "You may not sell, rent, or share Buyer information with third parties except as needed to fulfill the Order (for example, providing the address to a shipping carrier).",
          "The Crafters Market Privacy Policy describes Platform-side handling of Buyer information. Your Shop Policy (or your own privacy notice, where applicable) governs your independent handling of Buyer information after you receive it.",
        ],
      },
      {
        heading: "19a. Truthful Advertising, Product Claims & Reviews (FTC Compliance)",
        bullets: [
          "You are responsible for the accuracy of every claim you make about your Listings \u2014 including materials, dimensions, functionality, safety, sourcing, and any performance or health-related claims.",
          "Origin & \u201cMade in USA\u201d. You must not represent an item as \u201cMade in USA\u201d (or make any similar country-of-origin claim) unless it is \u201call or virtually all\u201d made in the United States, as that standard is applied by the U.S. Federal Trade Commission (FTC). Qualified origin claims must be truthful and clearly qualified (e.g., \u201cAssembled in USA from imported materials\u201d).",
          "Truthful advertising. Marketing and promotional statements about your Listings must be truthful, non-deceptive, and substantiated. Do not use manipulated photos, misleading before/after images, or endorsements you did not receive.",
          "Reviews \u2014 no fake or incentivized-and-undisclosed reviews. You may not post, procure, or coordinate fake reviews of your own or another Maker\u2019s Listings. You may not offer money, discounts, free products, or other incentives in exchange for reviews unless (a) the exchange is disclosed conspicuously in the review itself and (b) the disclosure meets current FTC endorsement-guide standards.",
          "Family, friends, and employees. Reviews written by people with a material connection to you (family, close friends, employees, contractors) must disclose that relationship in the review.",
          "AI-generated reviews. Do not post AI-generated reviews or reviews of Listings you have not actually purchased and received.",
          "Health, safety, and therapeutic claims. Any health, medical, therapeutic, structural, or safety-related claim must comply with applicable law (FTC, FDA, CPSC) and, where required, be substantiated by competent and reliable evidence. Unapproved therapeutic or medical claims are prohibited.",
          "Regulated claims (e.g., organic, fair-trade, cruelty-free, food-safety). Only use these terms if you meet the applicable certification or regulatory definition, and be prepared to document the basis of your claim if asked.",
          "Enforcement. Violations of this Section may result in Listing removal, review removal, account suspension, or termination under the Community Guidelines and Section 21 (Marketplace Enforcement).",
        ],
      },
      {
        heading: "20. Dispute Cooperation",
        text: "You agree to cooperate in good faith with the following processes:",
        bullets: [
          "Buyer disputes raised through the Platform: respond to Platform inquiries promptly and provide requested order, shipping, and communication evidence.",
          "Stripe disputes and chargebacks: provide all evidence we need to respond to the card network on your behalf.",
          "Intellectual-property investigations: respond to DMCA and trademark notices within the time periods specified in the Intellectual Property Policy.",
          "Fraud investigations: cooperate with any reasonable Crafters Market or Stripe inquiry, including providing identity verification, source-of-funds, and supply-chain documentation as appropriate.",
          "Lawful government requests: in the event of a court order, subpoena, or other lawful process, we may be required to disclose information; we will notify you where legally permitted and required.",
        ],
      },
      {
        heading: "21. Marketplace Enforcement",
        text: "Crafters Market reserves the right, at our sole discretion and consistent with applicable law, to take any of the following actions in response to actual or suspected violation of this Agreement, the Terms of Service, or any other Platform policy:",
        bullets: [
          "Remove specific Listings;",
          "Suspend your account temporarily, with or without notice;",
          "Reject pending applications;",
          "Remove the Founding Seller or other badges granted to your account;",
          "Revoke Founding Seller benefits granted in connection with badge removal;",
          "Freeze payouts where legally permitted, including in connection with fraud review, dispute investigation, or unresolved chargeback liability;",
          "Decline future applications associated with you or your business;",
          "Terminate your participation on the Platform.",
          "We will generally provide notice and an opportunity to respond before terminating, but reserve the right to act immediately where the violation poses risk to Buyers, other Makers, or the Platform.",
        ],
      },
      {
        heading: "22. Insurance",
        bullets: [
          "Many craft categories carry elevated product-liability risk (e.g. children\u2019s products, candles, food, cosmetics, skincare). For these categories, we recommend you carry appropriate business and product-liability insurance.",
          "Crafters Market reserves the right to require evidence of insurance as a condition of listing in higher-risk categories in the future.",
          "Crafters Market\u2019s own insurance does not extend to your products and is not a substitute for your own coverage.",
        ],
      },
      {
        heading: "23. Force Majeure",
        bullets: [
          "Neither party will be liable for delays or failures in performance caused by events outside their reasonable control, including but not limited to natural disasters, severe weather, fire, pandemic, war or civil unrest, terrorist activity, carrier disruptions or strikes, government actions or restrictions, labor disputes, supply-chain failures, internet or hosting outages, or denial-of-service attacks.",
          "The affected party will give prompt notice of the event and use reasonable efforts to mitigate the impact and resume performance.",
          "Force-majeure relief does not waive obligations to refund Buyers or honor consumer-protection law.",
        ],
      },
      {
        heading: "24. Changes to this Agreement",
        bullets: [
          "We may update this Agreement from time to time. Material changes will be communicated by posting the updated Agreement to the Platform, by email, and / or by an in-product notice prior to taking effect.",
          "The Effective Date and Last Updated values at the top and bottom of this Agreement reflect the current version.",
          "Continued participation on the Platform after the effective date of an update constitutes acceptance of the updated Agreement.",
          "Where required by law, we will obtain affirmative re-acceptance for material changes.",
        ],
      },
      {
        heading: "25. Standard Contract Provisions",
        bullets: [
          "Severability \u2014 if any provision of this Agreement is found unenforceable in any jurisdiction, the remaining provisions remain in full effect, and the unenforceable provision will be construed to reflect the parties' original intent as closely as possible while remaining enforceable.",
          "Waiver \u2014 no failure or delay in enforcing any right under this Agreement constitutes a waiver of that right. A waiver of any provision on one occasion is not a waiver on any other occasion.",
          "Assignment \u2014 you may not assign this Agreement without our prior written consent; any purported assignment without consent is void. We may assign or transfer this Agreement (including by operation of law) in connection with a merger, acquisition, reorganization, or sale of assets, or to an affiliate.",
          "Notices \u2014 We may send notices to the email address on your account. You may send notices to Crafters Market at policy@craftersmarket.org (or dmca@craftersmarket.org for IP-specific notices). Notices are deemed received on the business day after they are sent.",
          "Entire agreement \u2014 this Agreement, together with the Terms of Service, Privacy Policy, Returns & Refunds Policy, Community Guidelines, and Prohibited Items Policy, constitutes the entire agreement between you and Crafters Market regarding Maker activity on the Platform, and supersedes any prior agreements on that subject.",
        ],
      },
      {
        heading: "26. Survival",
        bullets: [
          "The provisions of this Agreement that by their nature should survive termination will survive termination \u2014 including, without limitation: payment and payout obligations (§14); the License you grant to Crafters Market for User Content (§10) and the AI Use provisions (§10a); intellectual-property representations and warranties; confidentiality; the Truthful Advertising, Product Claims & Reviews provisions (§19a) to the extent they cover past conduct; disclaimers and limitation of liability; indemnification (as incorporated from the Terms of Service); the Governing Law and Dispute Resolution provisions (§27); and the Standard Contract Provisions (§25).",
        ],
      },
      {
        heading: "27. Governing Law & Dispute Resolution (Maker-Specific)",
        bullets: [
          "This Section mirrors the dispute-resolution framework in the Terms of Service §12 so that this Agreement is enforceable on its own without cross-reference. In the event of a conflict between this Section and Terms of Service §12, this Section controls with respect to Maker-Platform disputes; the Terms control with respect to Buyer-Platform disputes.",
          "Governing Law. This Agreement is governed by the laws of the State of Washington, USA, without regard to conflict-of-law rules. Nothing in this Section limits any non-waivable rights or protections provided under applicable law, including any mandatory consumer-protection or seller-protection statutes in the Maker's home jurisdiction.",
          "Step 1 \u2014 Informal Resolution (30 days). Before initiating any formal proceeding against Crafters Market under this Agreement, you agree to first send a written description of your dispute to policy@craftersmarket.org and give Crafters Market 30 days to attempt an informal resolution.",
          "Step 2 \u2014 Mandatory, Individual Arbitration. If a Maker-Platform dispute is not resolved within the 30-day informal period, it will be resolved by binding, individual arbitration administered by the American Arbitration Association (AAA) under its Commercial Arbitration Rules (or Consumer Arbitration Rules where those apply). The arbitration will be seated in King County, Washington, and conducted in English. Arbitration will be administered remotely by default (video conference or written submissions) unless the arbitrator determines that an in-person hearing is necessary. Judgment on the award may be entered in any court of competent jurisdiction.",
          "Class-Action Waiver. You and Crafters Market each agree to bring Maker-Platform claims only in an individual capacity, and not as a plaintiff or class member in any purported class, collective, consolidated, mass, or representative proceeding. The arbitrator has no authority to conduct any class, collective, or representative proceeding.",
          "Small-Claims Carve-Out. Either party may bring an individual claim that qualifies for the small-claims court of the party's home jurisdiction in that court instead of in arbitration. Filing a small-claims action does not waive the mandatory-arbitration or class-waiver provisions above with respect to any other dispute.",
          "Injunctive Relief. Nothing in this Section prevents either party from seeking injunctive or equitable relief in a court of competent jurisdiction to protect intellectual property, confidential information, or Platform integrity.",
          "Non-Arbitrable Disputes / Venue. For any Maker-Platform dispute not subject to arbitration under this Section (for example, small-claims actions and requests for injunctive relief), the exclusive venue is the state or federal courts located in King County, Washington.",
          "Opt-Out of Arbitration. You may opt out of the arbitration agreement in this Section by sending a written notice to policy@craftersmarket.org within 30 days of first accepting this Agreement. A valid opt-out notice must include your legal name, the account email address, and a clear statement that you decline to arbitrate. Email to policy@craftersmarket.org is the authoritative legal submission method; accepted opt-out notices are recorded in an internal ledger maintained by Crafters Market Legal / Compliance for future reference. Opting out does not affect any other provision of this Agreement.",
        ],
      },
      {
        heading: "28. Electronic Signatures & Acceptance",
        bullets: [
          "By creating a Maker account, checking any acceptance box, clicking \u201cI Agree,\u201d publishing a Listing, accepting an Order, or otherwise using the Platform as a Maker, you agree that these actions constitute your electronic signature and your acceptance of this Maker Agreement \u2014 under the U.S. Electronic Signatures in Global and National Commerce Act (E-SIGN), the Uniform Electronic Transactions Act (UETA), and any applicable state law.",
          "You may withdraw your consent to transact electronically by closing your account and ceasing to use the Platform. Electronic signatures already made remain valid and enforceable.",
          "You are responsible for keeping the email address on your account current so you receive electronic notices about this Agreement and any updates.",
        ],
      },
      // ─── Crafters Market–specific provisions (additive, not numbered) ───
      {
        heading: "Verification",
        bullets: [
          "Where Makers have completed Crafters Market\u2019s verification or vetting process, a verification indicator may be displayed on the Maker profile.",
          "Verification confirms that the Maker has completed the Platform\u2019s review process at the time of approval. It is not a guarantee of workmanship, future performance, ongoing legal compliance, buyer satisfaction, or product quality.",
          "Verification may be removed for cause as part of the enforcement actions described in Section 21.",
        ],
      },
      {
        heading: "AI-Assisted Content",
        bullets: [
          "Makers may use AI-assisted tools (within the Platform or externally) to generate or refine listing text, product photography, descriptions, designs, and other User Content.",
          "Use of AI-assisted tools does not transfer responsibility for compliance. You remain responsible for ensuring that AI-assisted output does not infringe any copyright, trademark, publicity right, training-set license, or applicable AI-disclosure law.",
          "Where a Listing is materially AI-generated rather than AI-assisted, you must disclose this fact in the Listing description.",
          "AI cannot be used to circumvent the handmade requirements in Section 7. AI-generated artwork printed onto blanks without substantial human creative contribution is not eligible to be listed as handmade or handcrafted on the Platform.",
        ],
      },
      {
        heading: "Marketplace Growth & Future Services",
        bullets: [
          "Crafters Market reserves the right to introduce additional services available to Makers, including but not limited to: promoted listings, advanced analytics, off-site advertising tools, AI-assisted listing tools, fulfillment integrations, additional payment providers, mobile applications, and API access.",
          "Participation in any new service is optional unless we expressly indicate otherwise, and may be subject to its own posted terms incorporated into this Agreement by reference.",
          "We will provide reasonable notice of new services and any change to required (vs. optional) status.",
        ],
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: "Draft v3.0 for legal review. Sections 14 (Payments & Stripe Connect specifics), 18 (Taxes & marketplace-facilitator language), 25 (Standard Contract Provisions: severability, governing law, dispute resolution, class-action waiver), and the Indemnification clauses in the Terms of Service should be reviewed by counsel licensed in your operating jurisdiction(s) before being treated as fully binding. Until that review is complete, Makers remain bound by the seller terms in the Terms of Service section and the fee schedule in the Marketplace section.",
    },
    outro: (
      <>
        <p className="mb-3">
          By becoming a Maker on Crafters Market, you acknowledge that you have read,
          understood, and agree to this Maker Agreement, the Crafters Market Terms of
          Service, the Privacy Policy, the Returns & Refunds Policy, the Community
          Guidelines, and the Prohibited Items Policy.
        </p>
        <p className="mb-3 text-ink-muted">
          Questions about this Agreement?{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className="text-ink-muted text-sm">
          <span>Version:</span> <b className="text-ink">3.6</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
          <br />
          <span>v3.6 · 2026-06-30 — Final Legal Consistency Audit (v4): §10 User Content License rewritten with purpose limitation, explicit ownership retention, and license-termination-on-account-closure with limited carve-outs; §14 broadens payout-hold disclosure to payment networks, financial institutions, and regulatory authorities; §27 opt-out references the internal ledger.</span>
          <br />
          <span>v3.5 · 2026-06-30 — Final legal-hardening pass (v3): §14 Communication-during-holds (reasonable-efforts obligation subject to law / card-network / fraud / regulatory carve-outs); §27 Governing Law adds explicit non-waivable-rights carve-out (including any mandatory seller-protection statute in the Maker&rsquo;s home jurisdiction).</span>
          <br />
          <span>v3.4 · 2026-06-30 — Second-round legal-review pass: §10a clarifies that Operational AI does NOT authorize the Platform or any third-party ad provider to train commercial foundation models on Maker Content; §14 clarifies that some payout holds are Stripe- or card-network-controlled; §27 adds remote-first arbitration (video/written by default), King County WA remains the legal seat.</span>
          <br />
          <span>v3.3 · 2026-06-30 — Legal-hardening pass: fully populated §25 Standard Contract Provisions (severability, waiver, assignment, notices, entire agreement); added §26 Survival; added §27 Maker-specific Governing Law & Dispute Resolution (mirrors ToS §12: 30-day informal → AAA arbitration + class-action waiver + small-claims carve-out + injunctive-relief carve-out + 30-day opt-out); added §28 Electronic Signatures & Acceptance (E-SIGN / UETA).</span>
          <br />
          <span>v3.2 · 2026-06-30 — Legal-review pass: §14 payout holds tied to Stripe lifecycle + limited operational triggers; §19 clarified Platform-vs-Maker data-controller role split; added §19a Truthful Advertising, Product Claims & Reviews (FTC Compliance — Made in USA, no fake or undisclosed-incentivized reviews, health-claim substantiation).</span>
          <br />
          <span>v3.1 · 2026-06-30 — Added Section 10a AI Use (Creator-Owned AI Policy). Distinguishes Operational AI (allowed under the Section 10 content license — search, recommendations, ads, SEO, translations, listing optimization) from AI Model Training (opt-in only, never a condition of marketplace access). Cross-referenced with ToS §6a and Privacy Policy &ldquo;How We Use AI&rdquo;.</span>
          <br />
          <span>v3.0 · 2026-06-30 — Expanded from v2.1 per implementation brief: 25 numbered sections + Verification / AI-Assisted Content / Marketplace Growth provisions. Cross-referenced with ToS, Privacy Policy, Returns & Refunds, Community Guidelines, Prohibited Items.</span>
          <br />
          <span>v2.1 · 2026-06-29 — Initial dedicated Maker Agreement section (12 clauses, owner-uploaded draft).</span>
          <br />
          <span>v1   · prior — Embedded \u201cFor Sellers\u201d bullets inside the Terms of Service.</span>
        </p>
      </>
    ),
  },

  // iter413dl — Community Guidelines v3.0 (2026-06-30). Fills the gap
  // the consistency audit flagged: the ToS + Maker Agreement both
  // reference Community Guidelines but no dedicated section existed.
  // Tone is welcoming and community-focused (not punitive), per brief.
  {
    id: "community-guidelines",
    icon: Handshake,
    title: "Community Guidelines",
    intro: "These Community Guidelines describe how Buyers and Makers are expected to interact on Crafters Market. They\u2019re written for people, not lawyers, and they complement \u2014 they don\u2019t replace \u2014 the Terms of Service, Maker Agreement, Prohibited Items Policy, and Returns & Refunds Policy.",
    blocks: [
      {
        heading: "1. Welcome to the Community",
        text: "Crafters Market exists to connect Buyers with independent Makers who value craftsmanship, creativity, originality, honesty, professionalism, and mutual respect. Whether you\u2019re here to shop for something handmade or to sell your own work, this is the shared foundation.",
      },
      {
        heading: "2. Our Core Values",
        text: "Five principles guide how the marketplace operates:",
        list: [
          ["Craftsmanship \u2014", "take pride in creating quality work. Handmade is the point."],
          ["Integrity \u2014", "represent products honestly. Say what you make, make what you say."],
          ["Respect \u2014", "treat Buyers, Makers, and staff professionally. Assume good faith."],
          ["Originality \u2014", "celebrate original work; respect the intellectual property of others."],
          ["Community \u2014", "support fellow Makers and contribute positively to the marketplace."],
        ],
      },
      {
        heading: "3. Expectations for Makers",
        text: "As a Maker, we ask you to:",
        bullets: [
          "Provide accurate Listings \u2014 titles, descriptions, materials, dimensions.",
          "Use honest photography of your own actual work.",
          "Communicate promptly \u2014 generally within two business days.",
          "Meet the production timelines you publish.",
          "Honor your published Shop Policies.",
          "Resolve issues professionally and in good faith.",
          "Respect intellectual property.",
          "Maintain product quality across Orders.",
        ],
      },
      {
        heading: "4. Expectations for Buyers",
        text: "As a Buyer, we ask you to:",
        bullets: [
          "Read Listings carefully before purchasing.",
          "Review the Maker\u2019s Shop Policy before purchasing.",
          "Communicate respectfully.",
          "Provide accurate information for Custom Orders (measurements, spellings, artwork).",
          "Understand that handmade production takes time.",
          "Leave fair and honest reviews based on your actual experience.",
          "Work directly with the Maker before escalating disputes whenever possible.",
        ],
      },
      {
        heading: "5. Reviews (FTC Compliance)",
        text: "Reviews are how the community builds trust. They must:",
        bullets: [
          "Reflect a genuine purchasing experience.",
          "Remain respectful \u2014 constructive criticism is welcome; personal attacks are not.",
          "Avoid extortion (\u201cchange my order or I\u2019ll leave a 1-star\u201d is not acceptable).",
          "Avoid discriminatory language.",
          "Avoid misinformation about the Maker, the product, or the Platform.",
          "No fake reviews. Posting, procuring, or coordinating reviews of Listings you have not actually purchased and received is prohibited.",
          "No undisclosed incentives. Reviews written in exchange for money, discounts, free products, or other incentives must clearly and conspicuously disclose that fact in the review, consistent with current FTC endorsement-guide standards. Undisclosed-incentive reviews are prohibited.",
          "Disclose material connections. Reviews written by family, close friends, employees, or contractors of the Maker must disclose that relationship.",
          "No AI-generated reviews or reviews written by anyone other than the actual Buyer of the Order.",
          "Reviews that violate marketplace policies may be removed, and the responsible account may be subject to enforcement under the Maker Agreement or Terms of Service.",
        ],
      },
      {
        heading: "6. Messaging",
        text: "Buyer\u2013Maker messages on the Platform are for coordinating Orders and answering product questions. The following are not permitted:",
        bullets: [
          "Harassment or repeated unwanted contact.",
          "Spam or bulk marketing solicitation.",
          "Phishing attempts or scams.",
          "Abusive language, threats, or discriminatory conduct.",
          "Attempts to move payment off-platform to bypass marketplace protections \u2014 this exposes both parties to fraud and forfeits Marketplace Assistance rights.",
        ],
      },
      {
        heading: "7. Original Work",
        bullets: [
          "Respect copyrights: don\u2019t copy other Makers\u2019 designs, photography, or written descriptions.",
          "Respect trademarks: don\u2019t use protected brand names or logos without a license.",
          "Celebrate creativity while protecting intellectual property.",
          "See the Prohibited Items Policy and Intellectual Property Policy for the binding rules.",
        ],
      },
      {
        heading: "8. AI-Assisted Content",
        bullets: [
          "You may use AI-assisted tools, provided you have the legal right to use the resulting work, Listings remain accurate, and Buyers are not misled about what they\u2019re purchasing.",
          "You remain responsible for all published content you list on the Platform, whether AI-assisted or not.",
          "See the Maker Agreement \u00a7 on AI-Assisted Content and Prohibited Items \u00a714 for the binding rules.",
        ],
      },
      {
        heading: "9. Marketplace Integrity",
        text: "The marketplace only works when Buyers can trust what they see. Avoid conduct intended to game the system:",
        bullets: [
          "Fake reviews (self-reviews, paid reviews, review-swapping).",
          "Fake Orders or artificially inflating sales activity.",
          "Duplicate accounts to evade ratings, fees, or enforcement.",
          "Misleading Listings designed to bait clicks.",
          "Keyword manipulation and search-ranking games.",
          "Deceptive advertising, on-platform or off-.",
        ],
      },
      {
        heading: "10. Reporting Concerns",
        text: "If you see something that violates these Guidelines or any other Crafters Market policy, please report it:",
        bullets: [
          "Abusive or harassing behavior.",
          "Counterfeit products.",
          "Intellectual-property concerns.",
          "Scams or attempted fraud.",
          "Prohibited items.",
          "Other policy violations.",
          "Report to " + SUPPORT_EMAIL + " with subject line \u201cCommunity Report\u201d and include links, screenshots, or evidence where possible. Report in good faith; false reports intended to harm another Maker may themselves be a violation.",
        ],
      },
      {
        heading: "11. Enforcement Philosophy",
        text: "Our goal is to educate and improve the marketplace whenever reasonable. Actions may include:",
        bullets: [
          "Education \u2014 gentle nudge, correction, guidance.",
          "Warning \u2014 formal notice logged to the account.",
          "Listing removal \u2014 a specific Listing is taken down.",
          "Temporary suspension \u2014 the account is paused for a set period.",
          "Permanent account removal.",
          "Enforcement escalates gradually where possible; severe or repeated violations may skip steps.",
        ],
      },
      {
        heading: "12. Zero-Tolerance Conduct",
        text: "Some behavior is fundamentally incompatible with this marketplace and will lead to immediate removal:",
        bullets: [
          "Fraud (of any kind, against Buyers, Makers, or the Platform).",
          "Hate speech targeting protected groups.",
          "Threats of violence.",
          "Child exploitation of any kind.",
          "Illegal activity conducted through the Platform.",
          "Intentional intellectual-property infringement.",
          "Payment fraud, including chargeback abuse.",
          "Repeated scams or repeat-infringer conduct.",
        ],
      },
      {
        heading: "13. Growing Together",
        text: "These Guidelines exist to help Buyers and Makers build a trusted marketplace where independent creators can succeed together. When we all do our part \u2014 honest listings, respectful communication, original work, patient handmade timelines \u2014 the whole community wins.",
      },
      {
        heading: "Accessibility & Inclusion",
        text: "Crafters Market welcomes participants from all backgrounds and encourages respectful communication across cultures, identities, abilities, and points of view. Everyone deserves to participate in this marketplace without harassment or discrimination.",
      },
    ],
    callout: {
      tone: "info",
      text: "These are Community Guidelines, not legal terms. The binding rules live in the Terms of Service, Maker Agreement, Prohibited Items Policy, Returns & Refunds Policy, and Privacy Policy. Where these Guidelines and a binding policy conflict, the binding policy controls.",
    },
    outro: (
      <>
        <p className="mb-3 text-ink-muted">
          Questions or feedback about the community?{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className="text-ink-muted text-sm">
          <span>Version:</span> <b className="text-ink">3.0</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
          <br />
          <span>v3.0 · 2026-06-30 — First dedicated Community Guidelines section. 13 numbered sections + Accessibility &amp; Inclusion. Fills the audit-flagged gap where ToS + Maker Agreement referenced Community Guidelines with no matching section.</span>
        </p>
      </>
    ),
  },

  // iter413dl — "Privacy at a Glance" plain-language summary, inserted
  // above the full Privacy Policy. Non-legal, transparency-first. Links
  // out to the canonical Privacy Policy section.
  {
    id: "privacy-at-a-glance",
    icon: ShieldCheck,
    title: "Privacy at a Glance",
    intro: "A plain-language summary of how we handle your information. This is a transparency aid, not a substitute for the full Privacy Policy below \u2014 the legal document below controls if there is ever a conflict.",
    blocks: [
      {
        heading: "What we collect",
        bullets: [
          "Account info (name, email, address) when you sign up.",
          "Order info (what you bought, where it ships, payment status).",
          "Listings, photos, descriptions, messages \u2014 if you\u2019re a Maker.",
          "Technical info (IP, device, browser) needed to run the site safely.",
          "Cookies for sign-in, cart, and aggregate analytics.",
        ],
      },
      {
        heading: "Why we collect it",
        bullets: [
          "To process and ship your Orders.",
          "To facilitate payments through Stripe.",
          "To prevent fraud and keep accounts secure.",
          "To improve the marketplace and search.",
          "To send transactional notifications (and marketing only if you opt in).",
        ],
      },
      {
        heading: "Who we share it with",
        bullets: [
          "Stripe \u2014 for payments and payouts.",
          "Shipping carriers \u2014 they need the address to deliver.",
          "Vendors that help us operate the site (hosting, email, analytics) under contract.",
          "Law enforcement \u2014 only when legally required.",
          "We DO NOT sell your information.",
          "We DO NOT share it with advertisers for off-platform targeting.",
        ],
      },
      {
        heading: "What you can do",
        bullets: [
          "Update your account info any time.",
          "Opt out of marketing emails with one click.",
          "Manage your cookie preferences.",
          "Request a copy of your data, or ask us to delete it (some data we must keep for tax and dispute reasons).",
          "Contact " + SUPPORT_EMAIL + " for any privacy question.",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "This is a short, plain-language summary. The full legal Privacy Policy is the next section on this page. If anything below conflicts with this summary, the full Policy controls.",
    },
    outro: (
      <p className="text-ink-muted text-sm">
        Read the full <a href="#privacy" className="text-brand hover:underline">Privacy &amp; Data Policy</a> for the binding details.
      </p>
    ),
  },

  // iter413dl — Privacy Policy v3.0 expansion (2026-06-30). The 14
  // numbered sections below replace the prior 6-bullet generic block.
  // The Google API Services User Data subsections that follow MUST be
  // preserved verbatim — Google's OAuth verification reviewer greps
  // for the exact heading strings ("Google API Services User Data",
  // "Google API Limited Use Disclosure", etc.). Do not change them.
  {
    id: "privacy",
    icon: Lock,
    title: "Privacy & Data Policy",
    intro: "Crafters Market is a marketplace where Buyers, Makers, applicants, and visitors interact. This Privacy Policy explains what information we collect, how we use it, who we share it with, and what controls you have. It applies to all users of the Platform.",
    blocks: [
      {
        heading: "1. Introduction",
        bullets: [
          `Effective date: ${POLICY_EFFECTIVE_DATE}.`,
          "Last updated: 2026-06-30. Version 3.2.",
          "Purpose: this Policy is intended to provide transparent, plain-language disclosure of how Crafters Market collects, uses, and shares information.",
          "Relationship to the Terms of Service: this Policy supplements the Terms of Service and is incorporated by reference. Where it conflicts with the Terms of Service on a privacy-specific issue, this Policy controls.",
          "Scope: this Policy applies to Buyers, Makers, applicants for the Maker program, and visitors to the Platform. It does not apply to information collected by third parties on their own services even when linked from the Platform.",
        ],
      },
      {
        heading: "2. Information We Collect",
        text: "We collect the following categories of information. Not every category applies to every user.",
        list: [
          ["Account information \u2014", "name, email, phone, mailing address, business name (for Makers), and profile information you provide."],
          ["Marketplace information \u2014", "Listings you create, Orders you place or fulfill, reviews you leave or receive, messages you send through Platform messaging, items you save, and (if implemented) wishlists and search history."],
          ["Maker verification information \u2014", "during Maker onboarding and verification, we may collect information necessary to assess application quality and confirm identity. Only the information necessary to operate the marketplace is collected."],
          ["Payment information \u2014", "payments are processed by Stripe. Crafters Market does NOT see or store full payment-card numbers, CVV codes, or full bank-account details. We see and store only what Stripe returns (tokens, last-4 digits, transaction metadata)."],
          ["Uploaded content \u2014", "photos, videos, listing descriptions, logos, digital files, and Custom Order uploads (collectively, \u201cUser Content\u201d)."],
          ["Technical information \u2014", "IP address, browser, operating system, device identifiers, log files, crash reports, and referring pages."],
          ["Analytics \u2014", "aggregate usage metrics to improve usability, marketplace performance, search, and fraud detection."],
          ["Cookies \u2014", "see Section 7. Categories include essential cookies, analytics cookies, preference cookies, and (where applicable) marketing cookies."],
        ],
      },
      {
        heading: "3. How We Use Information",
        text: "We use the categories above for the following purposes:",
        bullets: [
          "Account creation and management.",
          "Operating the marketplace (search, browsing, listing display, recommendations).",
          "Processing Orders and facilitating payment through Stripe.",
          "Customer support and dispute resolution (including Marketplace Assistance under the Returns & Refunds Policy).",
          "Fraud prevention, account security, and Platform integrity.",
          "Improving search relevance and personalization within the Platform.",
          "Marketing communications, subject to the consent rules in Section 12.",
          "Legal compliance, including tax reporting and responding to lawful requests.",
          "Aggregate analytics and product improvement.",
        ],
      },
      {
        heading: "4. Information Sharing",
        text: "We share information only as needed to operate the marketplace. Categories of recipients:",
        list: [
          ["Buyers and Makers \u2014", "information necessary to complete transactions (e.g. the Buyer\u2019s shipping address is shared with the Maker fulfilling the Order; the Maker\u2019s shop name is displayed to the Buyer)."],
          ["Payment processors \u2014", "Stripe receives the information needed to process payments and payouts."],
          ["Shipping providers \u2014", "shipping addresses and Order details are shared with carriers selected by the Maker."],
          ["Service providers \u2014", "vendors that help us operate the Platform (analytics, cloud hosting, email delivery, fraud detection, customer-support tooling). Service providers are under contractual obligations to use information only on our behalf."],
          ["Legal requirements \u2014", "we may disclose information when required by court order, subpoena, legal process, law-enforcement request, or regulatory inquiry; we will notify affected users where legally permitted."],
          ["Business transfers \u2014", "in connection with a merger, acquisition, asset sale, or bankruptcy, information may transfer to the successor entity subject to the protections of this Policy."],
        ],
        bullets: [
          "We DO NOT sell personal information to third parties.",
          "We DO NOT share personal information with advertisers for third-party ad targeting outside our own owned campaigns.",
        ],
      },
      {
        heading: "4a. Third-Party Service Providers (Vendor Inventory)",
        text: "The following third-party services are currently used to operate the Platform. Each vendor is bound by its own privacy and security terms in addition to our contractual obligations with them. This list reflects production; we update it when we add, remove, or replace a vendor.",
        list: [
          ["Stripe (payments, Stripe Connect, subscriptions) \u2014", "processes Buyer payments, Maker payouts, Crafters Plus subscription billing, and dispute/chargeback workflows. Receives Buyer billing information, Maker identity and banking information for KYC, and transaction metadata. Governed by Stripe's Privacy Policy and Connected Account Agreement."],
          ["Cloudflare (CDN, DDoS protection, edge security) \u2014", "sits in front of Platform traffic. Sees IP addresses, request metadata, and (where TLS is terminated at the edge) request contents in transit. Used for performance and abuse mitigation, not for advertising."],
          ["Google Analytics 4 / GA4 (product analytics) \u2014", "measures site usage, funnels, retention. Receives pseudonymous identifiers, page-view events, and coarse geolocation. Configured with IP anonymization where supported."],
          ["Google Ads (advertising, conversion tracking) \u2014", "runs off-site ad campaigns and imports conversion events. Receives hashed identifiers and conversion metadata for ads attribution. Does not receive plaintext personal information."],
          ["Google Search Console (SEO / indexing telemetry) \u2014", "provides organic-search performance data. Does not receive user personal information beyond aggregated query and click data."],
          ["Meta (Facebook / Instagram) Ads & Conversions API \u2014", "runs off-site ad campaigns on Meta surfaces. Receives hashed identifiers and conversion metadata for ads attribution."],
          ["Pinterest (advertising and catalog feed) \u2014", "if enabled, receives catalog metadata for Maker Listings and hashed identifiers for conversion attribution."],
          ["TikTok (Pixel and Events API) \u2014", "if enabled, receives hashed identifiers and conversion events for ads attribution on TikTok surfaces."],
          ["Sentry (error monitoring) \u2014", "if enabled, receives client and server error stack traces, request metadata, and pseudonymous user identifiers to help us find and fix bugs."],
          ["Mailgun / transactional email provider \u2014", "delivers transactional email (Order confirmations, account and security notices, dispute updates, payout notifications). Receives recipient email addresses and message content."],
          ["Shippo (shipping-label purchase, rate lookup) \u2014", "if the Maker uses on-Platform label purchase, Shippo receives the shipping address, package dimensions, and payment metadata needed to purchase and track the label."],
          ["AI service providers \u2014", "the specific model providers we rely on for Operational AI (e.g., OpenAI, Anthropic, Google Gemini) may receive prompts and content necessary to perform the specific task (search relevance, listing optimization, translation, moderation, ad-copy generation). Provider identities may change over time; we do not send AI providers your creative Maker Content for training under the Creator-Owned AI Policy (Section 11 and Terms §6a)."],
          ["Emergent Universal Key (LLM aggregator) \u2014", "used internally to route Operational-AI requests to the appropriate model provider without exposing plaintext API keys to the Platform runtime."],
        ],
        bullets: [
          "Each vendor listed above has its own Privacy Policy that governs its own processing of information it receives from us. Links are available on request.",
          "When we add, remove, or replace a vendor in a way that materially changes what information is shared, we will update this list and, where required by law, notify affected users.",
        ],
      },
      {
        heading: "5. Data Retention",
        bullets: [
          "We retain information only as long as reasonably necessary to operate the Platform, comply with legal obligations, resolve disputes, enforce our agreements, and maintain security.",
          "Specific retention periods are set internally based on category and risk profile (e.g. transaction records, tax records, fraud-investigation logs are retained for the longer periods that law and dispute windows require).",
          "On account closure, see Section 13.",
        ],
      },
      {
        heading: "6. User Rights",
        text: "Subject to applicable law, you may request the following with respect to information we hold about you:",
        bullets: [
          "Access \u2014 a copy of personal information we hold about you.",
          "Correction \u2014 correction of inaccurate information.",
          "Deletion \u2014 deletion of personal information we no longer have a lawful or operational basis to retain. Self-service account deletion (buyers and makers) is available at /account/delete.",
          "Portability \u2014 a machine-readable export of personal information where required.",
          "Objection \u2014 objection to specific processing activities where applicable law grants that right.",
          "Marketing preferences \u2014 opt out of marketing communications at any time (transactional communications cannot be opted out of while you have an active account).",
          "Cookie preferences \u2014 manage cookie categories as described in Section 7 and the Cookie Policy.",
          "To exercise any of these rights, contact " + SUPPORT_EMAIL + ". We respond within 30 days. Some information may need to be retained for legal, tax, fraud-prevention, or contractual reasons.",
        ],
      },
      {
        heading: "6a. California Privacy Rights (CCPA / CPRA)",
        text: "If you are a California resident, the California Consumer Privacy Act (as amended by the California Privacy Rights Act) grants you the following rights in addition to those in Section 6:",
        bullets: [
          "Right to know. You may request the categories and specific pieces of personal information we have collected about you, the sources of that information, the business or commercial purpose for collection, and the categories of third parties with whom we share it.",
          "Right to delete. You may request deletion of personal information we have collected about you, subject to statutory exceptions (for example, information we need to complete a transaction, detect security incidents, or comply with a legal obligation).",
          "Right to correct. You may request correction of inaccurate personal information we hold about you.",
          "Right to limit use of sensitive personal information. You may request that we limit our use of sensitive personal information (SPI) to purposes necessary to provide the requested service.",
          "Right to opt out of \u201csale\u201d or \u201csharing.\u201d The CCPA/CPRA defines \u201csale\u201d and \u201csharing\u201d broadly. Crafters Market does not sell personal information for money. Where our use of advertising cookies (Meta, Google, Pinterest, TikTok, Reddit) constitutes \u201csharing\u201d for cross-context behavioral advertising under the CCPA/CPRA, you may opt out via the Cookie Preference Center (post-launch) or by sending a request to " + SUPPORT_EMAIL + ".",
          "Right to non-discrimination. We will not deny goods or services, charge different prices, or provide a different level of quality because you exercised any of these rights.",
          "How to submit a request. Email " + SUPPORT_EMAIL + " with the subject line \u201cCalifornia Privacy Rights Request.\u201d We will verify your identity using account information and respond within 45 days (extendable by 45 additional days where necessary and with notice to you).",
          "Authorized agents. You may authorize an agent to submit a request on your behalf. Authorized-agent requests must be accompanied by written authorization signed by you.",
          "Appeals. If we deny your request, you may appeal by replying to our written response; we will respond to appeals within 45 days.",
          "Metrics. To the extent we are required to publish annual metrics under the CCPA/CPRA, we will do so on our Privacy Policy page or a linked disclosure.",
        ],
      },
      {
        heading: "7. Cookies & Tracking",
        text: "We use cookies and similar technologies. Categories:",
        bullets: [
          "Essential cookies \u2014 required for the Platform to function (sign-in sessions, cart state, fraud checks).",
          "Analytics cookies \u2014 understand traffic, page performance, and feature usage. Aggregated and anonymized where possible.",
          "Functionality cookies \u2014 remember your preferences (theme, language, viewed-listing history).",
          "Security cookies \u2014 detect and block fraud and abuse.",
          "Session-management cookies \u2014 maintain sign-in state and cart continuity.",
          "Marketing cookies \u2014 not currently used for third-party ad targeting. If we ever add advertising cookies, we will disclose and manage them via the Cookie Policy and obtain consent where required.",
          "See the Cookie Policy for the full inventory and your controls.",
        ],
      },
      {
        heading: "8. Security",
        bullets: [
          "We use reasonable administrative, technical, and organizational safeguards to protect information against unauthorized access, alteration, disclosure, and destruction.",
          "Examples include encryption in transit (HTTPS), encryption at rest for sensitive fields, access controls limiting who can view production data, security logging, and routine review of vendor security posture.",
          "No method of internet transmission or electronic storage is completely secure, and we cannot guarantee absolute security.",
          "If we become aware of a security incident affecting your information, we will notify you in line with applicable law.",
        ],
      },
      {
        heading: "9. Children\u2019s Privacy",
        bullets: [
          "The Platform is not intended for individuals under 18 unless otherwise permitted by applicable law.",
          "We do not knowingly collect personal information from children.",
          "If you believe a child has provided information to the Platform, contact " + SUPPORT_EMAIL + " and we will take prompt steps to delete it.",
        ],
      },
      {
        heading: "10. International Transfers",
        bullets: [
          "Crafters Market currently operates primarily within the United States, and the Platform is intended for U.S.-based Buyers and Makers. Personal information you provide is stored and processed in the United States.",
          "If we expand services to residents of the European Economic Area (EEA), the United Kingdom, or other jurisdictions requiring additional transfer safeguards, we will implement the legally required mechanisms (including Standard Contractual Clauses or equivalent safeguards where applicable) before accepting registrations from those jurisdictions.",
          "If you access the Platform from outside the United States, you understand and agree that your information will be transferred to and processed in the United States, and that the data-protection laws of the U.S. may differ from those of your home jurisdiction.",
        ],
      },
      {
        heading: "11. AI & Automated Services — Creator-Owned AI Policy",
        bullets: [
          "Your creativity belongs to you. This section explains, in plain English, how Crafters Market uses AI in relation to your personal information and User Content, and — importantly — what we do NOT do.",
          "Operational AI (allowed): We use AI-powered tools to operate and market the Platform. This includes search relevance and personalization, recommendations, fraud and spam detection, on-platform translations, accessibility enhancements, customer-support assistance, Listing optimization, SEO metadata generation, and the use of third-party advertising platforms (Google, Meta / Facebook / Instagram, Pinterest, TikTok, Reddit, and similar surfaces) solely to generate, optimize, target, and deliver advertisements that promote Maker Listings. Operational AI also includes email campaigns, blog articles, product-description drafts, promotional graphics, video scripts, and social captions used to promote the marketplace.",
          "Operational AI is part of running and promoting the marketplace. It does not require a separate consent step beyond your acceptance of the Terms of Service, the Maker Agreement (if you sell), and this Privacy Policy.",
          "AI Model Training (NOT allowed without your explicit consent): We do not use your User Content — your photos, Listings, descriptions, journals, or other creative work — to train image-generation models, large language models, recommendation foundation models, or other commercial AI/machine-learning systems, and we do not license or otherwise permit your User Content to be used by any third party (including any third-party advertising provider) to train commercial foundation models. The Operational AI license above does not authorize the Platform or any third-party advertising provider to train commercial foundation models using your User Content.",
          "Silence, inaction, or continued marketplace participation are not consent to AI Model Training. Consent must be affirmative and specific to a defined training program.",
          "Personal information (as opposed to creative User Content) is never used to train external commercial AI models.",
          "If we launch an AI Training Program in the future, it will be opt-in only, with a separate consent step, a clear description of intended use, the ability to withdraw consent later (subject to reasonable technical limitations for previously-trained models), and no reduction in your visibility, ranking, payouts, or marketplace access if you decline.",
          "Aggregated, de-identified data. We may use aggregated statistics (e.g., \u201chow many Buyers viewed a Listing this week\u201d) that cannot reasonably be tied back to an individual Maker or Buyer to improve our own operational-AI features.",
          "Cross-reference: Section 6a of the Terms of Service and Section 10a of the Maker Agreement contain the marketplace-wide AI use rules. If any of those three references conflict, the Maker Agreement controls with respect to Maker Content.",
        ],
      },
      {
        heading: "12. Communications",
        bullets: [
          "Transactional notifications \u2014 Order confirmations, shipping notices, dispute updates, security alerts, payout notifications. These are required for service and cannot be opted out of while you have an active account.",
          "Account notices \u2014 policy updates, terms-of-service changes, account-status changes.",
          "Optional marketing communications \u2014 newsletters, new-Maker announcements, promotional campaigns. You may opt out at any time using the unsubscribe link in any marketing email or by updating your account preferences.",
          "We do not share email addresses with third-party advertisers for marketing to you outside the Platform.",
        ],
      },
      {
        heading: "13. Account Closure",
        bullets: [
          "You may close your account at any time from account settings or by emailing " + SUPPORT_EMAIL + ".",
          "On closure, your public profile is unpublished and Listings (for Makers) are removed.",
          "Certain information may be retained to comply with legal obligations (tax records, transaction history, anti-fraud records), resolve disputes, prevent fraud, and maintain marketplace records.",
          "Retained information is segregated from active operations and is used only for the limited purposes above.",
        ],
      },
      {
        heading: "14. Changes to this Policy",
        bullets: [
          "We may update this Policy from time to time. Material changes will be communicated by posting the updated Policy to the Platform, by email, and / or by in-product notice prior to taking effect.",
          "The Effective Date and Last Updated values reflect the current version.",
          "Continued use of the Platform after the effective date of an update constitutes acceptance.",
          "Where required by law, we will obtain affirmative re-acceptance for material changes.",
        ],
      },
      // ─── Google API Services User Data — DO NOT EDIT HEADINGS ───
      // iter329b — Google API Services User Data disclosure restructured
      // to use the EXACT section titles that Google's OAuth verification
      // reviewer greps for: "Google User Data We Access", "How We Use
      // Google Data", "Storage & Retention", "Sharing & Third Parties",
      // "User Controls / Disconnect & Delete Data", and the all-important
      // "Google API Limited Use Disclosure". Mirrored 1:1 in the
      // /api/og/policy server-side prerender so the reviewer sees the
      // same content without executing JavaScript.
      {
        heading: "Google API Services User Data",
        bullets: [
          "Crafters Market uses Google APIs only for OWNER-SIDE business operations (Search Console, Analytics, and Ads). We DO NOT offer \"Sign in with Google\" to buyers or makers, and we do not access Gmail, Drive, Calendar, Contacts, Photos, YouTube, or any consumer Google service.",
        ],
      },
      {
        heading: "Google User Data We Access",
        bullets: [
          "Google Search Console — scope: https://www.googleapis.com/auth/webmasters. We submit our own sitemaps and read indexing status of our own URLs (craftersmarket.org). We do not read data about other websites or users.",
          "Google Analytics 4 — scope: https://www.googleapis.com/auth/analytics.readonly. Server-side reporting on aggregate traffic to craftersmarket.org. We read aggregate metric counts only — no per-visitor identifiers are pulled into our database.",
          "Google Ads API — scope: https://www.googleapis.com/auth/adwords. We create + report on the off-site ad campaigns we run to drive traffic to craftersmarket.org. We do not access ad accounts that don't belong to us.",
          "Connected-account email (display only): immediately after the OAuth handshake, we make a best-effort call to Google's https://www.googleapis.com/oauth2/v2/userinfo endpoint to show \"Connected as you@example.com\" on the admin settings screen so the connecting team member can verify they linked the intended account. We do NOT request the openid, profile, or userinfo.email scopes separately — if Google's response does not include an email, we proceed with an empty value.",
        ],
      },
      {
        heading: "How We Use Google Data",
        bullets: [
          "Submit sitemap.xml + sitemap_index.xml to Google Search Console so Crafters Market pages are indexed.",
          "Inspect indexing status of specific craftersmarket.org URLs to debug indexing issues.",
          "Read aggregate Google Analytics 4 reports (pageviews, sources, sessions) for the admin dashboard.",
          "Create, pause, and read performance metrics on Google Ads campaigns we run to drive traffic to craftersmarket.org.",
          "Display the connected admin's email address on our admin settings screen.",
          "We DO NOT use Google user data to train AI or machine-learning models.",
          "We DO NOT use Google user data for advertising targeting outside our own owned Google Ads campaigns.",
          "We DO NOT enrich, profile, or repackage Google user data for any other purpose.",
        ],
      },
      {
        heading: "Storage & Retention",
        bullets: [
          "An encrypted OAuth refresh token, stored at rest in our MongoDB.",
          "The connected admin's email address (display-only on the settings screen).",
          "The list of OAuth scopes granted.",
          "We DO NOT persist the content of Search Console reports, Analytics rows, or Ads campaigns beyond what's needed to render the current admin view in memory.",
          "Refresh tokens are deleted immediately on disconnect; any cached derived data is purged within 30 days.",
          "Data is stored in encrypted form on infrastructure provided by our hosting partner under industry-standard SOC 2 / ISO 27001 controls.",
        ],
      },
      {
        heading: "Sharing & Third Parties",
        bullets: [
          "We DO NOT sell Google user data.",
          "We DO NOT share Google user data with any third party for advertising, marketing, or analytics outside the Crafters Market platform.",
          "We DO NOT transfer Google user data to any AI or ML provider for training.",
          "We DO NOT share Google user data with sub-processors except the encrypted-at-rest database described in \"Storage & Retention\" above.",
          "If we ever need to expand sharing for a legitimate operational reason, we will obtain explicit re-consent from the connecting admin before doing so.",
        ],
      },
      {
        heading: "User Controls / Disconnect & Delete Data",
        bullets: [
          "Revoke Google's grant at any time: visit https://myaccount.google.com/permissions, find \"Crafters Market\", and click \"Remove access\". Revocation is enforced by Google immediately.",
          "Disconnect from inside our admin dashboard: open Admin → Settings → Integrations and click \"Disconnect\" next to the relevant Google service.",
          "On disconnect, our stored refresh token is deleted within seconds. Any cached derived data (admin display state, sitemap submission history) is purged within 30 days.",
          "Request a copy of all Google-sourced data we hold about you: email team@craftersmarket.org with subject line \"Google data access request\". We respond within 30 days.",
          "Request deletion of all Google-sourced data we hold about you: email team@craftersmarket.org with subject line \"Google data deletion request\". We respond within 30 days.",
        ],
      },
      {
        heading: "Google API Limited Use Disclosure",
        bullets: [
          "Crafters Market's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements: https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes",
          "We affirm that data obtained from Google's APIs is used only to provide or improve user-facing features that are prominent in the requesting application's user experience — specifically the owner-side Search Console, Analytics, and Ads operations described above.",
          "We affirm that data obtained from Google's APIs is not transferred to others except as necessary to provide or improve those features, comply with applicable law, or as part of a merger, acquisition, or sale of assets with notice to users.",
          "We affirm that data obtained from Google's APIs is not used for serving advertisements outside our own owned Crafters Market ad campaigns.",
          "We affirm that humans do not read data obtained from Google's APIs unless we have obtained the connecting admin's affirmative agreement, the data is required for security purposes (such as investigating abuse), it is required to comply with applicable law, or the data has been aggregated and anonymized for internal operations.",
        ],
      },
      {
        heading: "Contact",
        bullets: [
          "Questions about how we handle Google user data: " + SUPPORT_EMAIL + ".",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "Payments are processed by Stripe under their PCI-DSS-compliant infrastructure. We do not see, store, or log your full card details at any point. Our Google integrations are limited to read-only / write-our-own-sitemap operations on Crafters-Market-owned properties — they never read your Google account data.",
    },
    outro: (
      <>
        <p className="text-ink-muted text-sm">
          <span>Version:</span> <b className="text-ink">3.4</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
          <br />
          <span>v3.4 · 2026-06-30 — Final Legal Consistency Audit (v4): §4a adds a concrete Third-Party Service Providers (Vendor Inventory) enumerating every production vendor — Stripe, Cloudflare, GA4, Google Ads, Google Search Console, Meta Ads/CAPI, Pinterest, TikTok, Sentry, Mailgun, Shippo, AI service providers, and the Emergent Universal Key aggregator.</span>
          <br />
          <span>v3.3 · 2026-06-30 — Second-round legal-review pass: §10 International Transfers rewritten from EU/UK placeholder to U.S.-focused language (with forward-looking commitment to SCCs / equivalent safeguards before EEA/UK expansion); §11 clarifies that Operational AI does NOT authorize the Platform or any third-party advertising provider to train commercial foundation models on Maker Content.</span>
          <br />
          <span>v3.2 · 2026-06-30 — Legal-hardening pass: added §6a California Privacy Rights (CCPA/CPRA) — right to know/delete/correct/limit SPI/opt-out of sharing/non-discrimination/agent-authorization/appeals. Wired Effective date through the effective-date deployment hook.</span>
          <br />
          <span>v3.1 · 2026-06-30 — Rewrote §11 as the Creator-Owned AI Policy. Distinguishes Operational AI (allowed under the license) from AI Model Training (opt-in only, never a condition of marketplace access). Cross-referenced with ToS §6a and Maker Agreement §10a.</span>
          <br />
          <span>v3.0 · 2026-06-30 — Expanded to 14 numbered sections covering Information We Collect, Sharing, Retention, User Rights, Cookies, Security, Children\u2019s Privacy, International Transfers, AI &amp; Automated Services, Communications, Account Closure, and Changes. Preserved Google API Services User Data disclosure verbatim (OAuth verification requirement).</span>
          <br />
          <span>v2.x · prior — Six-bullet summary plus Google API Services User Data disclosure.</span>
        </p>
      </>
    ),
  },

  // iter413dl — Cookie Policy v3.0 (2026-06-30). New dedicated section
  // referenced from the Privacy Policy. Marketplace-specific, plain-
  // language, structured to accommodate a future Cookie Preference
  // Center without a rewrite. Sections marked LEGAL_REVIEW_REQUIRED
  // are placeholders pending counsel input.
  {
    id: "cookies",
    icon: Boxes,
    title: "Cookie Policy",
    intro: "This Cookie Policy explains how Crafters Market uses cookies and similar technologies on the Platform. It works alongside the Privacy Policy and the Terms of Service. Where this Policy and the Privacy Policy conflict on a cookie-specific issue, this Policy controls.",
    blocks: [
      {
        heading: "1. Introduction",
        bullets: [
          `Effective date: ${POLICY_EFFECTIVE_DATE}.`,
          "Last updated: 2026-06-30. Version 3.0.",
          "Purpose: describe how cookies and similar technologies are used across the Platform, what categories exist, and how you can control them.",
          "Relationship to the Privacy Policy: this Policy is incorporated into and supplements the Privacy Policy. See the Privacy Policy for the broader description of how we handle personal information.",
        ],
      },
      {
        heading: "2. What Are Cookies?",
        text: "Cookies are small text files placed on your device when you visit a website. They allow the site to recognize your device on future visits, remember your preferences, and provide certain features. In addition to cookies, we may use similar technologies:",
        bullets: [
          "Web beacons and tracking pixels \u2014 small transparent images used to understand whether an email or page was opened.",
          "Local storage and session storage \u2014 browser-based storage used to hold session state, cart contents, or preferences.",
          "SDK technologies \u2014 for future mobile applications, if introduced.",
          "Where this Policy refers to \u201ccookies,\u201d it also includes these similar technologies unless otherwise noted.",
        ],
      },
      {
        heading: "3. Categories of Cookies",
        text: "We group cookies into four categories.",
        list: [
          ["Essential \u2014", "required for the Platform to function (authentication, sign-in sessions, cart, checkout, fraud prevention, security, account management). Cannot be disabled without breaking the site."],
          ["Functional \u2014", "remember your preferences (language, accessibility settings, recently viewed products, login preferences, theme)."],
          ["Analytics \u2014", "help us understand traffic, marketplace performance, feature usage, search behavior, and user journeys. May include first-party analytics and third-party providers such as Google Analytics."],
          ["Marketing \u2014", "support advertising campaigns, conversion measurement, remarketing, and social-media advertising. Used only where implemented and, where required by law, with appropriate consent."],
        ],
      },
      {
        heading: "4. Session vs Persistent Cookies",
        bullets: [
          "Session cookies expire when you close your browser. Example: keeping you signed in during a single visit.",
          "Persistent cookies remain on your device until they expire or you delete them. Example: remembering your theme preference across visits, or your cart between sessions.",
        ],
      },
      {
        heading: "5. First-Party vs Third-Party Cookies",
        bullets: [
          "First-party cookies are set directly by Crafters Market and used only on the Platform.",
          "Third-party cookies are set by providers integrated into the Platform, which may include analytics providers, payment processors (e.g. Stripe), embedded media, social-sharing tools, and advertising platforms (where implemented).",
          "We do not list specific third-party providers here unless they are actively implemented, to avoid disclosure drift.",
        ],
      },
      {
        heading: "6. How Crafters Market Uses Cookies",
        text: "Cookies help us:",
        bullets: [
          "Maintain secure sign-in sessions for Buyers and Makers.",
          "Remember shopping-cart contents across pages and short visits.",
          "Save preferences (theme, language, accessibility, recently viewed).",
          "Improve search relevance and marketplace navigation.",
          "Personalize recommendations within the Platform.",
          "Analyze aggregate marketplace performance and improve reliability.",
          "Detect and prevent fraud, spam, and abuse.",
          "Support Marketplace Assistance in dispute investigation (see the Returns & Refunds Policy).",
          "We do not use cookies to target ads to you on other websites outside our own owned campaigns.",
        ],
      },
      {
        heading: "7. Cookie Consent",
        bullets: [
          "Where applicable law requires (e.g. UK/EU/EEA/Brazil/California and other jurisdictions with consent requirements), you should be able to: accept all cookies, reject non-essential cookies, customize preferences by category, and revisit those preferences at any time via a Cookie Preference Center linked from this Policy and the Privacy Policy.",
          "Essential cookies cannot be rejected because the Platform will not function without them.",
          "If a Cookie Preference Center is not yet enabled for your jurisdiction, we will not use non-essential cookies in a way that requires prior consent under that jurisdiction\u2019s law.",
          "If Crafters Market expands services to jurisdictions with strict cookie-consent regimes (EU / EEA ePrivacy Directive, UK, LGPD, CPRA, and similar), a jurisdiction-appropriate Cookie Preference Center and consent-recording mechanism will be enabled before non-essential cookies are set for users in those jurisdictions.",
        ],
      },
      {
        heading: "8. Managing Cookies",
        text: "You have several tools for managing cookies:",
        bullets: [
          "Cookie Preference Center on this page (when available in your jurisdiction).",
          "Browser settings \u2014 delete existing cookies, block future cookies, allow only first-party cookies, or clear cookies on exit. Common browsers include Chrome, Safari, Firefox, and Edge; each provides cookie-management controls in its Settings/Privacy area.",
          "Do Not Track and Global Privacy Control signals \u2014 we honor these signals where required by law.",
          "Note: disabling essential cookies will break sign-in, cart, checkout, and other core features.",
        ],
      },
      {
        heading: "9. Third-Party Services",
        text: "Some integrated services may set their own cookies on your device, including:",
        bullets: [
          "Payment providers (e.g. Stripe) \u2014 to secure and complete payment.",
          "Analytics providers \u2014 to measure aggregate usage.",
          "Embedded media \u2014 e.g. video players or image hosts embedded on the Platform.",
          "Social-media integrations \u2014 e.g. share buttons or embed cards.",
          "You should review the privacy or cookie policies of those providers directly. Their cookies are governed by their own policies, not by this one, though we require providers to have privacy practices compatible with ours.",
        ],
      },
      {
        heading: "10. AI & Marketplace Features",
        bullets: [
          "Cookies and browser storage may support marketplace features including personalized recommendations, AI-assisted search, saved preferences, and improved marketplace functionality.",
          "Cookies do not determine ownership of User Content. See the Maker Agreement and Terms of Service for content ownership and licensing.",
          "We DO NOT use cookie data to train external commercial AI models on your personal information.",
        ],
      },
      {
        heading: "11. Changes to this Policy",
        bullets: [
          "We may update this Policy from time to time. Material changes will be communicated by posting the updated Policy to the Platform, by email, and / or by in-product notice prior to taking effect.",
          "The Effective Date and Last Updated values reflect the current version.",
          "Continued use of the Platform after the effective date of an update constitutes acceptance.",
          "This Policy is incorporated into the Privacy Policy and the Terms of Service.",
        ],
      },
      {
        heading: "Future: Cookie Preference Center",
        bullets: [
          "Crafters Market plans to expose a Cookie Preference Center from both this Policy and the Privacy Policy so that Buyers and Makers can review the categories of cookies in use, enable or disable non-essential categories where required by law, and revisit their preferences at any time.",
          "Building this framework now, even while only essential and analytics cookies are actively used, will let us add future advertising, personalization, and AI-related features without restructuring the privacy experience later.",
          "Participation status: [PLANNED — implementation pending Phase-D exit].",
        ],
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: "Draft v3.0 for legal review. Section 7 (Cookie Consent \u2014 jurisdiction-specific consent-mechanism language) should be reviewed by counsel licensed in your operating jurisdiction(s) before this Policy is treated as fully binding.",
    },
    outro: (
      <>
        <p className="mb-3 text-ink-muted">
          Questions about cookies?{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
            {SUPPORT_EMAIL}
          </a>
          . For the broader picture of how we handle information, see the{" "}
          <a href="#privacy" className="text-brand hover:underline">Privacy &amp; Data Policy</a>.
        </p>
        <p className="text-ink-muted text-sm">
          <span>Version:</span> <b className="text-ink">3.0</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
          <br />
          <span>v3.0 · 2026-06-30 — First dedicated Cookie Policy section. 11 numbered sections + Future Cookie Preference Center block. Cross-referenced with Privacy Policy, ToS.</span>
          <br />
          <span>v2.x · prior — Cookies covered only within the Privacy Policy.</span>
        </p>
      </>
    ),
  },

  {
    id: "prohibited",
    icon: Ban,
    title: "Prohibited Items Policy",
    intro: "Crafters Market exists to support lawful, original, handmade, and responsibly created products. This Policy establishes what may not be listed on the Platform. Approval as a Maker does not automatically approve every product. Crafters Market may remove any Listing at its discretion to protect Buyers, Makers, or the marketplace.",
    blocks: [
      {
        heading: "1. Introduction",
        bullets: [
          `Effective date: ${POLICY_EFFECTIVE_DATE}.`,
          "Last updated: 2026-06-30. Version 3.0.",
          "Purpose: define what may not be listed on Crafters Market.",
          "This Policy supplements the Terms of Service and works alongside the Maker Agreement, Community Guidelines, Returns & Refunds Policy, and Privacy Policy.",
          "Crafters Market reserves the right to remove Listings or suspend accounts that violate this Policy.",
        ],
      },
      {
        heading: "2. General Rule",
        text: "Only products that comply with all of the following may be listed:",
        bullets: [
          "Applicable federal, state, and local law.",
          "Marketplace standards for handmade / handcrafted / designed work (see the Maker Agreement).",
          "Third-party intellectual-property rights.",
          "Community expectations of respect, safety, and honest representation.",
          "Crafters Market may remove any Listing at its sole discretion when necessary to protect Buyers, Makers, or the marketplace.",
        ],
      },
      {
        heading: "3. Illegal Products",
        text: "Listings that involve or facilitate any of the following are prohibited:",
        bullets: [
          "Stolen property.",
          "Counterfeit goods.",
          "Forged documents (IDs, certifications, credentials).",
          "Illegal drugs and drug paraphernalia.",
          "Unlawful services (money laundering, illegal gambling, etc.).",
          "Any product illegal to possess, sell, or distribute in the Buyer\u2019s or Maker\u2019s jurisdiction.",
        ],
      },
      {
        heading: "4. Intellectual Property Violations",
        text: "Prohibited products include those that infringe:",
        bullets: [
          "Copyrights \u2014 unauthorized use of protected artistic, literary, musical, or design work.",
          "Trademarks \u2014 unauthorized use of protected brand names, logos, or trade dress.",
          "Patents \u2014 unauthorized manufacture of patented articles or processes.",
          "Publicity rights \u2014 unauthorized use of a person\u2019s name, likeness, or persona.",
          "Licensing agreements \u2014 unauthorized use of licensed content beyond the terms of the license.",
          "Makers must own or hold appropriate rights before listing. Repeat infringement may result in termination per the Maker Agreement \u00a721 and the Intellectual Property Policy below.",
        ],
      },
      {
        heading: "5. Dangerous Products",
        text: "Products presenting unreasonable safety risk are prohibited, including:",
        bullets: [
          "Explosives, blasting agents, and related components.",
          "Hazardous chemicals or corrosives not lawfully packaged for retail sale.",
          "Products currently subject to a government recall.",
          "Consumer products failing applicable safety standards (children\u2019s products, sleepwear flammability, lead limits, small-parts choking hazards).",
          "Items requiring specific licensing or certification that the Maker does not hold.",
        ],
      },
      {
        heading: "6. Weapons & Regulated Items",
        bullets: [
          "Firearms, firearm components, and ammunition.",
          "Replica or realistic-imitation weapons that violate applicable law.",
          "Suppressors, silencers, and related regulated accessories.",
          "Switchblades, gravity knives, and other knives regulated in specific jurisdictions.",
          "Body armor where restricted by law.",
          "Any regulated weapon or accessory whose sale is prohibited or restricted by applicable law.",
          "Crafters Market reserves the right to restrict additional categories as laws change or payment-processor rules require.",
        ],
      },
      {
        heading: "7. Animal & Wildlife Products",
        bullets: [
          "Live animal sales through the Platform are prohibited.",
          "Products made from protected or endangered species (ivory, sea-turtle shell, protected fur, feathers of protected bird species) are prohibited.",
          "Products claiming a species that is not what is actually used are prohibited.",
          "Makers listing legal animal-derived materials (e.g. antler shed, ethically sourced leather) must comply with all applicable wildlife, agriculture, and conservation laws and disclose material sourcing where reasonably possible.",
        ],
      },
      {
        heading: "8. Human Biological Materials",
        bullets: [
          "Human remains, cremains, teeth, bones, or fluids are prohibited unless a specific product category is expressly permitted by marketplace policy AND clearly lawful in the Buyer\u2019s and Maker\u2019s jurisdictions.",
          "Items containing purported religious or ceremonial human material are prohibited without express marketplace approval.",
        ],
      },
      {
        heading: "9. Medical & Health Claims",
        bullets: [
          "Listings must not claim to diagnose, cure, treat, mitigate, or prevent any disease unless the Maker is legally authorized to make such claims and the product is properly registered under applicable law (e.g. FDA for drugs and medical devices).",
          "Structure/function claims for supplements, cosmetics, or personal-care items must comply with applicable law and be truthful and substantiated.",
          "Products intended for medical use (implants, surgical instruments, prescription-only items) are prohibited.",
        ],
      },
      {
        heading: "10. Adult Content",
        bullets: [
          "Explicit adult content that is unlawful in any relevant jurisdiction is prohibited.",
          "Explicit adult content that is not clearly gated, contextually appropriate to a handmade craft marketplace, or otherwise inconsistent with marketplace standards is prohibited.",
          "Legal, tasteful, adult-themed craft work (e.g. fine-art nudes) may be allowed subject to marketplace review and appropriate audience gating; contact " + SUPPORT_EMAIL + " before listing.",
        ],
      },
      {
        heading: "11. Hate, Harassment & Extremism",
        text: "Zero tolerance. Prohibited products include those that:",
        bullets: [
          "Promote or celebrate hatred against any protected group (race, ethnicity, national origin, religion, disability, gender, sexual orientation, gender identity, age, or other protected characteristic).",
          "Encourage or facilitate discrimination or violence.",
          "Glorify or memorialize acts of mass violence, terrorism, or genocide.",
          "Support or recruit for extremist organizations designated by government authorities.",
          "Use hate symbols in a non-critical, non-educational context.",
          "Target specific individuals or protected groups for harassment.",
        ],
      },
      {
        heading: "12. Fraud & Deceptive Listings",
        text: "The following are prohibited:",
        bullets: [
          "Falsely representing mass-produced or drop-shipped inventory as handmade or handcrafted.",
          "Misleading product descriptions (misrepresenting size, material, origin, function, or provenance).",
          "Materially manipulated product images (color-shifting to hide defects, compositing to imply features that do not exist).",
          "False origin claims (\u201cmade in USA\u201d when not, \u201chandmade in [region]\u201d when mass-produced elsewhere).",
          "Counterfeit branding of your own listings using another maker\u2019s or brand\u2019s identity.",
          "Deceptive pricing (fake original prices, phantom discounts, hidden fees).",
          "Responsibility for origin claims. Makers are solely responsible for the accuracy of any origin claim (including \u201cMade in USA,\u201d \u201cHandmade,\u201d \u201cHandcrafted,\u201d \u201cSmall-batch,\u201d or any similar representation) appearing on their Listings, Shop pages, packaging, or marketing. Crafters Market may review, restrict, or remove Listings that appear misleading, but does not independently verify every claim before it is published. Enforcement is discretionary; the absence of enforcement is not an endorsement of any specific claim.",
        ],
      },
      {
        heading: "13. Digital Products",
        bullets: [
          "Makers must possess all rights necessary to distribute the Digital Product.",
          "Prohibited: pirated files; unauthorized reproductions of another creator\u2019s work; stolen designs; software piracy; use of licensed fonts, brushes, textures, or 3D models beyond the terms of their license.",
          "Prohibited: use of copyrighted characters, logos, or media without a license or clear fair-use basis (fan-art considerations do not create marketplace-safe use \u2014 permission still governs).",
          "See the Maker Agreement \u00a717 for the licensing framework Makers must apply to their own Digital Products.",
        ],
      },
      {
        heading: "14. AI-Generated Content",
        text: "How Crafters Market distinguishes AI-assisted creative work from materially AI-generated work, and what must be disclosed:",
        bullets: [
          "AI-assisted means AI was used only as a tool to assist the Maker's own creative process. AI-assisted work does not require an AI-disclosure tag on the Listing.",
          "Examples of AI-assisted use (no disclosure required): grammar correction, SEO keyword suggestions, background removal, image cleanup, translation, title generation, spelling check, tag suggestions, minor color correction, moderation assistance, and similar tool-level uses.",
          "Materially AI-generated means the primary artistic expression or the final product was substantially created by generative AI rather than by the Maker. Listings that are materially AI-generated must be clearly disclosed as such in the Listing title or description.",
          "Examples of materially AI-generated Listings (disclosure required): AI-created artwork sold as prints or on physical products, AI-generated product images used as the primary Listing image, AI-generated printable designs, and AI-generated digital downloads.",
          "Crafters Market intentionally does not use a numeric percentage threshold (e.g., \u201c50% AI\u201d). Percentages create loopholes and are difficult to enforce. The test is whether the primary artistic expression or final product was substantially created by AI or by the Maker; the examples above are the practical guide.",
          "Non-disclosure of a materially AI-generated Listing is a violation of this Policy and the Maker Agreement.",
          "AI-assisted work is permitted when: (a) the Maker has the legal right to use the resulting content; (b) no third-party intellectual property is infringed by the AI output; and (c) Listings accurately represent the product being sold and disclose AI-generation where the work is materially AI-generated rather than merely AI-assisted.",
          "AI cannot be used to circumvent the handmade / handcrafted / designed-by-Maker categories defined in the Maker Agreement \u00a77.",
          "Makers remain responsible for all AI-assisted and AI-generated content they publish, including copyright, trademark, publicity, and training-set-license compliance.",
        ],
      },
      {
        heading: "15. Marketplace Integrity",
        text: "Activities intended to manipulate the marketplace are prohibited:",
        bullets: [
          "Fake reviews (self-reviews, paid reviews, review swaps, bot reviews).",
          "Fake orders or artificial sales activity intended to inflate rankings, badges, or reputation.",
          "Duplicate accounts intended to evade enforcement, ratings, or fee structures (see Maker Agreement \u00a75).",
          "Search manipulation (keyword stuffing, hidden search terms, duplicate Listings created solely to game ranking).",
          "Off-platform payment coordination to evade marketplace fees or dispute mechanisms.",
          "Any other platform abuse intended to gain unfair advantage or harm other Makers.",
        ],
      },
      {
        heading: "16. Reporting Violations",
        text: "Buyers, Makers, and rights holders may report suspected violations through the following channels:",
        bullets: [
          "In-product report link on Listings and Maker profiles (where available).",
          "Email " + SUPPORT_EMAIL + " with subject line \u201cPolicy Report — [category]\u201d and include the URL of the Listing or profile, a description of the issue, and any supporting evidence (photos, receipts, prior communication, IP registration documents for infringement claims).",
          "DMCA notices are handled through the process described in the Intellectual Property Policy section below.",
        ],
      },
      {
        heading: "17. Investigation Process",
        bullets: [
          "Crafters Market may request documentation supporting a Maker\u2019s right to list a given product (e.g. proof of authorship, license, source-of-materials).",
          "Listings may be temporarily hidden or removed during investigation.",
          "Accounts may be suspended pending investigation where risk to Buyers or the Platform warrants.",
          "We cooperate with payment providers (Stripe) and law-enforcement or regulatory authorities where legally required.",
          "Investigations may proceed before a final determination is made. Provisional action is not a finding of wrongdoing.",
        ],
      },
      {
        heading: "18. Enforcement",
        text: "Possible enforcement actions include, in ascending order of severity:",
        bullets: [
          "Educational warning \u2014 for first-time or minor issues that can be corrected.",
          "Listing removal \u2014 the specific Listing is removed; the account remains active.",
          "Category restriction \u2014 the account may not list in a specific category.",
          "Temporary suspension \u2014 the account is disabled for a set period.",
          "Payout restriction \u2014 payouts held or reserves imposed, where legally permitted, pending resolution.",
          "Revocation of Founding Seller status \u2014 badge and any associated benefits removed.",
          "Permanent account termination \u2014 the Maker is removed from the Platform; future applications may be declined.",
          "Enforcement is proportionate to the violation, documented in our internal records, and applied consistently across similar cases.",
        ],
      },
      {
        heading: "19. Appeals",
        bullets: [
          "Makers may request reconsideration of certain enforcement decisions by emailing " + SUPPORT_EMAIL + " with subject line \u201cEnforcement Appeal\u201d, referencing the case ID we provide in the enforcement notice, and including any new documentation or context relevant to the decision.",
          "Appeals are reviewed by a Crafters Market staff member not involved in the original decision, where practical.",
          "Crafters Market retains final discretion regarding marketplace participation.",
          "Certain violations (fraud, hate content, IP infringement subject to a repeat-infringer policy) may not be appealable.",
        ],
      },
      {
        heading: "20. Policy Updates",
        bullets: [
          "We may update this Policy from time to time. Material changes will be communicated by posting the updated Policy to the Platform, by email, and / or by in-product notice prior to taking effect.",
          "The Effective Date and Last Updated values reflect the current version.",
          "Continued use of the Platform after the effective date of an update constitutes acceptance.",
          "This Policy is incorporated into the Terms of Service and the Maker Agreement.",
        ],
      },
      {
        heading: "Future Categories & Discretion",
        bullets: [
          "Crafters Market reserves the right to prohibit additional product categories when required by legal changes, safety concerns, marketplace standards, payment-processor requirements, insurance requirements, or evolving marketplace policy.",
          "Where a Maker is uncertain whether a specific item is permitted, contact " + SUPPORT_EMAIL + " before listing.",
        ],
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: "Draft v3.0 for legal review. Sections 3 (Illegal Products), 6 (Weapons & Regulated Items), 7 (Animal & Wildlife), 8 (Human Biological Materials), 9 (Medical Claims), 11 (Hate & Extremism), and 18 (Enforcement) should be reviewed by counsel licensed in your operating jurisdiction(s) and cross-checked against Stripe's own restricted-business list before this Policy is treated as fully binding.",
    },
    outro: (
      <>
        <p className="mb-3 text-ink-muted">
          Report a prohibited listing or ask a question:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          — subject line \u201cPolicy Report\u201d speeds triage.
        </p>
        <p className="text-ink-muted text-sm">
          <span>Version:</span> <b className="text-ink">3.3</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
          <br />
          <span>v3.3 · 2026-06-30 — Final Legal Consistency Audit (v4): §14 AI-Generated Content re-scoped to replace subjective wording with concrete example lists (AI-assisted: grammar correction, SEO keywords, background removal, image cleanup, translation, title generation; materially-AI-generated: AI-created artwork, AI-generated product images, AI-generated printable designs, AI-generated digital downloads). Examples replace numeric thresholds.</span>
          <br />
          <span>v3.2 · 2026-06-30 — Final legal-hardening pass (v3): §14 AI-Generated Content rewritten to codify the AI-assisted vs. materially-AI-generated distinction (no numeric percentage threshold — the test is whether the primary artistic expression or final product was substantially created by AI or by the Maker). Adds concrete examples and required-disclosure rule.</span>
          <br />
          <span>v3.1 · 2026-06-30 — Second-round legal-review pass: §12 adds Maker responsibility for origin claims (Made in USA / Handmade / etc.); Platform reserves moderation authority.</span>
          <br />
          <span>v3.0 · 2026-06-30 — Original marketplace-specific policy. 20 numbered sections + Future Categories block. Cross-referenced with ToS, Maker Agreement, Returns &amp; Refunds, IP Policy.</span>
          <br />
          <span>v1   · prior — 8-bullet summary embedded on this page.</span>
        </p>
      </>
    ),
  },

  {
    id: "ip",
    icon: Copyright,
    title: "Intellectual Property & DMCA Policy",
    intro: "Crafters Market respects the intellectual property rights of others and expects everyone who uses the Platform to do the same. This Policy explains what Makers must certify about their Listings, how rights-holders can report infringement, how counter-notices work, and what happens to repeat infringers.",
    blocks: [
      {
        heading: "1. Maker Representations & Warranties",
        bullets: [
          "You represent and warrant that every Listing you publish is your original work or is properly licensed for the use you make of it.",
          "You represent and warrant that you have all rights necessary to reproduce, display, and sell all images, descriptions, designs, and other content you upload to your Shop.",
          "Custom Orders that involve third-party logos, characters, or trademarks may only be produced with the Buyer's explicit written representation that they own or hold a valid license for the underlying rights (and/or that the use is a legitimate personal, non-commercial use under applicable law).",
          "You agree to indemnify Crafters Market for third-party IP claims arising from your Listings, consistent with the Terms of Service.",
        ],
      },
      {
        heading: "2. Designated DMCA Agent",
        text: (
          <>
            Crafters Market has registered a Designated DMCA Agent with the
            U.S. Copyright Office under the U.S. Digital Millennium Copyright
            Act (DMCA), 17 U.S.C. § 512.
            <br />
            <br />
            <b>Registration Status:</b> Active · Effective 2026-06-30 ·
            Registration Number DMCA-1074892
            <br />
            <br />
            <b>Send DMCA notices and counter-notices to the registered
            Designated Agent:</b>
            <br />
            <br />
            Micheal Williams
            <br />
            Designated DMCA Agent, Crafters Market
            <br />
            1864 North Cutter Place
            <br />
            Oak Harbor, WA 98277
            <br />
            United States
            <br />
            Email:{" "}
            <a
              href="mailto:williams342@gmail.com"
              className="text-brand hover:underline"
            >
              williams342@gmail.com
            </a>
            <br />
            Phone: (360) 507-6178
            <br />
            <br />
            To be effective under 17 U.S.C. § 512, copyright notices and
            counter-notices must be sent to the registered Designated Agent
            using the contact information above.
          </>
        ),
      },
      {
        heading: "3. How to Submit a DMCA Notice (Copyright)",
        bullets: [
          "Your DMCA notice must include: (1) your name, physical or electronic signature, and contact information; (2) an identification of the copyrighted work you claim has been infringed; (3) the URL(s) of the allegedly infringing Listing or content on the Platform; (4) a statement that you have a good-faith belief the disputed use is not authorized by the copyright owner, its agent, or the law; (5) a statement, under penalty of perjury, that the information in your notice is accurate and that you are the copyright owner or authorized to act on behalf of the owner; and (6) your physical or electronic signature.",
          "Incomplete notices may be returned. Knowingly making a material misrepresentation in a DMCA notice may subject you to liability for damages under 17 U.S.C. § 512(f).",
          "Upon receipt of a compliant notice, we will remove or disable access to the identified material and notify the Maker who posted it.",
        ],
      },
      {
        heading: "4. Counter-Notice Procedure",
        bullets: [
          "If your content was removed and you believe the removal was a mistake or that you have the right to use the material, you may submit a counter-notice to the Designated DMCA Agent.",
          "Your counter-notice must include: (1) your name, physical or electronic signature, and contact information; (2) identification of the material that was removed and the location where it appeared before removal; (3) a statement, under penalty of perjury, that you have a good-faith belief the material was removed by mistake or misidentification; and (4) your consent to the jurisdiction of the U.S. federal district court for the judicial district in which you reside (or, if outside the United States, the U.S. District Court for the Western District of Washington), and that you will accept service of process from the person who submitted the original notice.",
          "If the original claimant does not notify us within 10\u201314 business days that they have filed an action seeking a court order to restrain the material, we will restore the material.",
        ],
      },
      {
        heading: "5. Repeat-Infringer Policy",
        bullets: [
          "Crafters Market maintains a repeat-infringer policy under 17 U.S.C. § 512(i). Accounts that receive multiple substantiated DMCA notices are subject to escalating enforcement.",
          "Threshold. Three substantiated DMCA notices against an account within any 12-month window will result in permanent removal of that account from the Platform.",
          "A substantiated notice is one that was not successfully contested by a valid counter-notice within the statutory window and that was not later withdrawn.",
          "The threshold above is a floor \u2014 Crafters Market may terminate a Maker's account sooner for a single egregious or willful infringement, or for a pattern of infringement across accounts.",
        ],
      },
      {
        heading: "6. Trademark & Other IP Claims",
        bullets: [
          "The DMCA covers copyright only. Trademark takedowns, right-of-publicity claims, and other IP claims are handled through a parallel-but-distinct process. Send trademark or other IP takedown requests to " + SUPPORT_EMAIL + " with (a) the mark or right at issue and its registration details (if any), (b) the URL(s) of the allegedly infringing Listing, (c) a description of the alleged infringement, (d) a good-faith statement that the use is unauthorized, and (e) your signature.",
          "We will evaluate trademark and other IP takedown requests and remove Listings that we determine are more likely than not infringing, applying the same repeat-infringer principles as for copyright.",
        ],
      },
      {
        heading: "7. Rights-Holder Cooperation",
        bullets: [
          "Crafters Market cooperates with rights-holders and their authorized agents to prevent the Platform from being used for infringement.",
          "We may share information relevant to a takedown with the counter-noticing Maker, and vice versa, to the extent required by law and the DMCA.",
          "We may cooperate with law-enforcement and lawful legal process from rights-holders, subject to applicable law and our Privacy Policy.",
        ],
      },
    ],
    callout: {
      tone: "warn",
      text: "Repeat infringers will have their accounts permanently terminated. Making a false DMCA notice or counter-notice can subject you to damages under U.S. federal law.",
    },
  },

  {
    id: "seller-misconduct",
    icon: UserX,
    title: "Seller Misconduct",
    intro: "We may suspend or permanently ban sellers for any of the following:",
    blocks: [
      {
        bullets: [
          "Selling items that are not handmade by the seller",
          "Misrepresenting or copying another seller's designs",
          "Failing to ship orders within the promised time",
          "Repeatedly receiving low ratings or customer complaints",
          "Providing false or misleading information in listings",
          "Harassing or being abusive toward buyers",
          "Attempting to sell prohibited or illegal items",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "We review each case individually. If your account is suspended, you will be notified by email.",
    },
  },

  {
    id: "buyer-misconduct",
    icon: UserX,
    title: "Buyer Misconduct",
    intro: "We protect our makers as fiercely as our buyers. Buyers found violating any of the following may have orders cancelled, accounts banned, and may be reported to law-enforcement or pursued for damages:",
    blocks: [
      {
        bullets: [
          "Filing fraudulent chargebacks without first contacting the seller or our support team",
          "Harassment, threats, or abusive language toward makers or staff",
          "Knowingly providing false shipping information or refusing legitimate delivery",
          "Returning items in materially different condition than received and demanding a refund",
          "Coordinated review-bombing or extortion attempts (\"refund me or I'll leave bad reviews\")",
          "Reselling Makers Market pieces for commercial profit without seller permission",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: (
        <>
          If you have an issue with an order, please contact us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">{SUPPORT_EMAIL}</a>{" "}
          before filing a chargeback. We resolve the vast majority of disputes
          directly with the maker within 5 business days.
        </>
      ),
    },
  },

  // iter413ee — Accessibility Statement (2026-06-30). Launch-blocker
  // addition per counsel review. Plain-language commitment + contact
  // + ongoing-WCAG-improvement pledge.
  {
    id: "accessibility",
    icon: Users,
    title: "Accessibility Statement",
    intro: "Crafters Market is committed to making our marketplace usable by as many people as possible, including people with disabilities. This statement describes our accessibility commitment, the standards we aim for, how to contact us if you run into a barrier, and our approach to ongoing improvement.",
    blocks: [
      {
        heading: "Our Commitment",
        bullets: [
          "Crafters Market believes independent Makers and Buyers of every ability deserve equal access to a curated handmade marketplace.",
          "We treat accessibility as an ongoing engineering and design responsibility \u2014 not a one-time checklist.",
          "We consider accessibility every time we ship a material feature, and we welcome feedback that helps us do better.",
        ],
      },
      {
        heading: "Standards We Aim For",
        bullets: [
          "We aim to conform to the W3C Web Content Accessibility Guidelines (WCAG) 2.1 Level AA. WCAG 2.2 improvements are adopted as we update surfaces.",
          "Our goals include: sufficient color contrast; keyboard-navigable interactive components; visible focus indicators; descriptive alt text on decorative and functional images; proper heading order and landmarks; screen-reader-friendly form labels and error messages; and captions or transcripts on video content we control.",
          "We build on top of shadcn/ui and Radix primitives, which provide accessible defaults for menus, dialogs, tabs, dropdowns, and other interactive components. Where we deviate from those primitives we test for accessibility regressions before shipping.",
        ],
      },
      {
        heading: "Known Limitations",
        bullets: [
          "The Platform is still in Founding Access v1. Some newer surfaces may not yet meet every WCAG 2.1 AA criterion. We are logging and prioritizing gaps as we find them.",
          "Third-party content \u2014 including Listings uploaded by Makers, embedded videos from external providers, and content on third-party linked sites \u2014 is not under our direct control. We ask Makers to write descriptive titles and provide alt text; we plan to add tooling and coaching around this over time.",
        ],
      },
      {
        heading: "Report a Barrier",
        bullets: [
          "If you encounter a barrier or need an accommodation to use Crafters Market, email us at accessibility@craftersmarket.org.",
          "Please include (a) a description of the issue, (b) the URL where it occurred, and (c) the assistive technology (screen reader, magnifier, voice control, keyboard-only, etc.) and browser you were using, if known.",
          "We aim to respond within 5 business days with either a fix, a workaround, or a target timeline.",
        ],
      },
      {
        heading: "Ongoing Improvements",
        bullets: [
          "Accessibility items are tracked alongside other engineering work in our roadmap.",
          "We include accessibility checks in feature-development reviews \u2014 for example, verifying keyboard navigation and focus behavior on new interactive components.",
          "We plan to publish an updated Accessibility Statement at least annually reflecting our current state and priorities.",
        ],
      },
      {
        heading: "Formal Legal Frameworks",
        bullets: [
          "This statement is provided in good faith and describes our commitment. It is not a warranty that every part of the Platform meets every WCAG success criterion at every moment.",
          "Where applicable law (for example, the Americans with Disabilities Act, Section 508, or local equivalents) requires specific accommodations, we take those obligations seriously and address them in coordination with counsel.",
        ],
      },
      {
        heading: "Contact",
        bullets: [
          "Accessibility contact: accessibility@craftersmarket.org.",
          "General support: " + SUPPORT_EMAIL + ".",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "Accessibility is a moving target. If you run into a barrier, please tell us \u2014 we\u2019d rather hear about a problem than ship past it.",
    },
    outro: (
      <>
        <span className="text-ink-muted">Version:</span>{" "}
        <b className="text-ink">1.0</b>
        <span className="text-ink-muted"> · Last updated:</span>{" "}
        <b className="text-ink">2026-06-30</b>
        <span className="text-ink-muted"> · Effective:</span>{" "}
        <b className="text-ink">{POLICY_EFFECTIVE_DATE}</b>
      </>
    ),
  },
];
