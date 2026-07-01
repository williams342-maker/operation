import React, { useEffect, useState } from "react";
import {
  ChevronDown, FileText, Truck, RotateCcw, Wand2, Boxes, CreditCard,
  ShieldCheck, Lock, Ban, Copyright, AlertTriangle, UserX, Mail, Handshake,
} from "lucide-react";
import { useStructuredData } from "../lib/seo";

const SUPPORT_EMAIL = "team@craftersmarket.org";

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
          "Effective date: [Insert Date \u2014 to be set on legal sign-off]. Version 2.0. Last updated 2026-06-30.",
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
        ],
      },
      {
        heading: "5. Fees, Payments & Payouts",
        bullets: [
          "Crafters Market charges a marketplace commission on each sale. Exact rates and any listing/renewal or subscription fees are published in the Fee & Pricing Policy and in the Makers Market section of the site.",
          "Payments are processed by Stripe (and any successor processor). By accepting Orders you agree to Stripe\u2019s Connected Account Agreement and Services Agreement.",
          "Makers must complete Stripe onboarding (identity verification, payout account) before withdrawing funds. Stripe may hold, reserve, or freeze funds as required by its risk and compliance programs.",
          "Crafters Market may deduct fees, refunds, chargebacks, and any amounts owed under these Terms, the Maker Agreement, or applicable policies from Maker balances or future payouts.",
          "Refunds and reversals are governed by the Returns & Refunds Policy and the Buyer Protection Policy.",
        ],
      },
      {
        heading: "6. Listings, User Content & Intellectual Property",
        bullets: [
          "You retain ownership of the copyrights, trademarks, and other rights you already hold in the content you upload (photos, descriptions, Listings, journal posts, messages, reviews, and other \u201cUser Content\u201d).",
          "You grant Crafters Market a worldwide, non-exclusive, royalty-free license to host, display, reproduce, adapt for format/size, and promote your User Content on the Platform and through connected surfaces (Google, Meta, Pinterest, TikTok, email, and other channels) for the purpose of operating and marketing the marketplace.",
          "You represent that you have all rights necessary to upload and license your User Content and that it does not infringe any third-party rights.",
          "You may not use another Maker\u2019s User Content, brand assets, or Listings without written permission. The Intellectual Property & DMCA Policy explains how to report infringement and how repeat-infringer accounts are handled.",
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
          "Crafters Market may participate in the defense of any such claim at its own expense and reserves the right to assume the exclusive defense and control of any matter for which you are required to indemnify us.",
        ],
      },
      {
        heading: "12. Dispute Resolution & Governing Law",
        bullets: [
          "These Terms are governed by the laws of the State of Washington, USA, without regard to conflict-of-law rules.",
          "Buyers and Makers agree to attempt to resolve disputes with each other first through on-platform messaging and, if that fails, through the Buyer Protection Policy for Order-related disputes.",
          "Disputes with Crafters Market that cannot be resolved informally will be brought exclusively in the state or federal courts located in King County, Washington \u2014 unless a mandatory arbitration provision is later adopted (see Attorney Review Notes at the end of this document).",
          "Nothing in this section prevents either party from seeking injunctive or equitable relief to protect intellectual property, confidential information, or Platform integrity.",
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
          "Continued use of the Platform after the effective date constitutes acceptance of the updated Terms. Prior versions are preserved in the Revision History (below) and available on request.",
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
        <b className="text-ink">2.0</b>
        <span className="text-ink-muted"> · Last updated:</span>{" "}
        <b className="text-ink">2026-06-30</b>
        <span className="text-ink-muted"> · Effective:</span>{" "}
        <b className="text-ink">Pending legal sign-off</b>
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
          "Effective date: [Insert Date — to be set on legal sign-off].",
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
          "[LEGAL REVIEW: jurisdiction-specific consumer-protection language for international shipments to be added by counsel if/when the marketplace expands international operations.]",
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
          <span>Version:</span> <b className="text-ink">3.0</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">[Insert Date — to be set on legal sign-off]</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
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
          "Effective date: [Insert Date — to be set on legal sign-off].",
          "Last updated: 2026-06-30. Version 3.0.",
          "This Policy describes how returns, refunds, exchanges, and cancellations work on Crafters Market.",
          "Purchases are made from independent Makers; Crafters Market provides the marketplace, payment-processing facilitation, and dispute-resolution assistance.",
          "This Policy supplements the Crafters Market Terms of Service and works alongside the Maker Agreement, Community Guidelines, Prohibited Items Policy, Privacy Policy, and each Maker's individual Shop Policy.",
        ],
      },
      {
        heading: "2. Policy Hierarchy",
        text: "When there is a conflict between rules, the following order of precedence applies:",
        list: [
          ["1. Applicable Law —", "consumer-protection rights that cannot be waived by contract always govern."],
          ["2. Terms of Service —", "the master agreement between you and Crafters Market."],
          ["3. This Returns & Refunds Policy —", "the marketplace-wide baseline."],
          ["4. Maker Agreement —", "the agreement between each Maker and Crafters Market."],
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
          "Buyer should notify the Maker within a reasonable period \u2014 generally within 7 days of delivery for transit damage and within 30 days for latent defects.",
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
          <span>Version:</span> <b className="text-ink">3.0</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">[Insert Date — to be set on legal sign-off]</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
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
          "Effective date: [Insert Date — to be set on legal sign-off].",
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
          <span>Version:</span> <b className="text-ink">1.0</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">[Insert Date — to be set on legal sign-off]</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
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
          "Effective date: [Insert Date — to be set on legal sign-off].",
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
          "You retain ownership of all User Content you upload (photos, videos, listing text, logos, digital files, custom design uploads).",
          "You grant Crafters Market a worldwide, non-exclusive, royalty-free, sublicensable license to host, display, reproduce, adapt for display, distribute, and create derivative works of your User Content solely for the purposes of operating, marketing, and promoting the Platform and the visibility of your Shop and Listings.",
          "Permitted uses include: marketplace display, search and discovery, marketing, advertising, product-catalog syndication (Google Merchant Center, Meta, Pinterest, TikTok, and similar channels), social-media promotion, email newsletters, and other Platform-driven promotional campaigns.",
          "Ownership remains with you. You may revoke the license for a given piece of User Content by deleting it from the Platform, except for residual copies in our backups and any cached or syndicated copies on third-party services whose retention we do not control.",
          "Nothing in this license transfers ownership of underlying intellectual property to Crafters Market.",
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
          "Payout holds: we may hold payouts where required by law, in response to a Buyer dispute, during a fraud review, or pending resolution of an open investigation.",
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
        heading: "19. Privacy & Buyer Data",
        bullets: [
          "When you receive a Buyer\u2019s information through the Platform (name, shipping address, contact details), you may use that information only to fulfill the Order, provide customer service, and comply with legal obligations.",
          "You must protect Buyer information using reasonable security measures and may not retain it longer than necessary for the purposes above.",
          "You must comply with applicable privacy laws (including but not limited to CAN-SPAM, GDPR if you reach EU Buyers, and applicable U.S. state privacy laws).",
          "You may not use Buyer information for unrelated marketing without obtaining appropriate consent (e.g. a Buyer\u2019s explicit opt-in to your own newsletter outside the Platform).",
          "You may not sell, rent, or share Buyer information with third parties except as needed to fulfill the Order (e.g. providing the address to a shipping carrier).",
          "See the Crafters Market Privacy Policy for the Platform-side details on how Buyer information is handled.",
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
        // LEGAL_REVIEW_REQUIRED — owner-uploaded brief flags these clauses
        // for attorney finalization. Replace placeholder text once counsel
        // returns finalized severability / waiver / assignment / survival
        // / governing-law / dispute-resolution / entire-agreement text.
        bullets: [
          "Severability \u2014 if any provision of this Agreement is found unenforceable, the remaining provisions remain in full effect [LEGAL REVIEW: confirm jurisdiction-specific severability language].",
          "Waiver \u2014 no failure or delay in enforcing any right under this Agreement constitutes a waiver of that right.",
          "Assignment \u2014 you may not assign this Agreement without our written consent; we may assign or transfer this Agreement in connection with a merger, acquisition, sale of assets, or by operation of law.",
          "Survival \u2014 the Intellectual Property License residuals (Section 10), Payments & Stripe Connect chargeback liability (Section 14), Taxes & Regulatory Compliance (Section 18), Privacy & Buyer Data (Section 19), Dispute Cooperation (Section 20), Marketplace Enforcement (Section 21), Indemnification (in the Terms of Service), and Standard Contract Provisions (this Section 25) survive termination of this Agreement.",
          "Governing law \u2014 [LEGAL REVIEW: jurisdiction and venue to be finalized by counsel].",
          "Dispute resolution \u2014 [LEGAL REVIEW: informal-resolution clause, arbitration / mediation, class-action waiver, small-claims carve-out to be finalized by counsel].",
          "Entire agreement \u2014 this Agreement, together with the Terms of Service, Privacy Policy, Returns & Refunds Policy, Community Guidelines, and Prohibited Items Policy, constitutes the entire agreement between you and Crafters Market regarding Maker activity on the Platform.",
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
          <span>Version:</span> <b className="text-ink">3.0</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">[Insert Date — to be set on legal sign-off]</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
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
        heading: "5. Reviews",
        text: "Reviews are how the community builds trust. They should:",
        bullets: [
          "Reflect a genuine purchasing experience.",
          "Remain respectful \u2014 constructive criticism is welcome; personal attacks are not.",
          "Avoid extortion (\u201cchange my order or I\u2019ll leave a 1-star\u201d is not acceptable).",
          "Avoid discriminatory language.",
          "Avoid misinformation about the Maker, the product, or the Platform.",
          "Reviews that violate marketplace policies may be removed.",
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
          <b className="text-ink">[Insert Date — to be set on legal sign-off]</b>
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
          "Effective date: [Insert Date — to be set on legal sign-off].",
          "Last updated: 2026-06-30. Version 3.0.",
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
          "Deletion \u2014 deletion of personal information we no longer have a lawful or operational basis to retain.",
          "Portability \u2014 a machine-readable export of personal information where required.",
          "Objection \u2014 objection to specific processing activities where applicable law grants that right.",
          "Marketing preferences \u2014 opt out of marketing communications at any time (transactional communications cannot be opted out of while you have an active account).",
          "Cookie preferences \u2014 manage cookie categories as described in Section 7 and the Cookie Policy.",
          "To exercise any of these rights, contact " + SUPPORT_EMAIL + ". We respond within 30 days. Some information may need to be retained for legal, tax, fraud-prevention, or contractual reasons.",
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
          "Crafters Market is operated from the United States. If you access the Platform from outside the U.S., your information may be transferred to and processed in the U.S.",
          "Where international transfers occur and applicable law requires, we will rely on appropriate transfer mechanisms (e.g. Standard Contractual Clauses) [LEGAL REVIEW: confirm jurisdiction-specific mechanisms once the marketplace expands internationally].",
        ],
      },
      {
        heading: "11. AI & Automated Services",
        bullets: [
          "We may use AI-assisted tools to improve search, generate Listing suggestions, provide customer-support automation, detect fraud, and improve marketplace functionality.",
          "Use of AI by Crafters Market does not transfer ownership of your User Content. You remain the owner of what you upload and remain responsible for ensuring that AI-assisted material you publish does not infringe copyright, trademark, or licensing terms.",
          "We DO NOT train external commercial AI models on your personal information.",
          "We may use aggregated, de-identified data to improve our own AI-assisted features.",
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
          <span>Version:</span> <b className="text-ink">3.0</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">[Insert Date — to be set on legal sign-off]</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
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
          "Effective date: [Insert Date — to be set on legal sign-off].",
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
          "[LEGAL REVIEW: jurisdiction-specific consent-mechanism language (ePrivacy Directive, GDPR, LGPD, CPRA, etc.) to be finalized by counsel.]",
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
          <b className="text-ink">[Insert Date — to be set on legal sign-off]</b>
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
          "Effective date: [Insert Date — to be set on legal sign-off].",
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
        bullets: [
          "AI-assisted work is permitted when: (a) the Maker has the legal right to use the resulting content; (b) no third-party intellectual property is infringed by the AI output; and (c) Listings accurately represent the product being sold and disclose AI-generation where the work is materially AI-generated rather than merely AI-assisted.",
          "AI cannot be used to circumvent the handmade / handcrafted / designed-by-Maker categories defined in the Maker Agreement \u00a77.",
          "Makers remain responsible for all AI-assisted content they publish, including copyright, trademark, publicity, and training-set-license compliance.",
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
          <span>Version:</span> <b className="text-ink">3.0</b>
          <span className="mx-2">·</span>
          <span>Effective date:</span>{" "}
          <b className="text-ink">[Insert Date — to be set on legal sign-off]</b>
          <span className="mx-2">·</span>
          <span>Last updated:</span>{" "}
          <b className="text-ink">June 30, 2026</b>
        </p>
        <p className="text-ink-muted text-xs mt-2 leading-relaxed">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-muted">Revision history</span>
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
    title: "Intellectual Property Policy",
    intro: "Crafters Market respects the intellectual property rights of others and expects users of our platform to do the same.",
    blocks: [
      {
        heading: "Sellers represent and warrant that:",
        bullets: [
          "All listings are their original work or properly licensed",
          "They have the right to sell, reproduce, or display all images, designs, and content uploaded to their shop",
          "Custom orders involving third-party logos, characters, or trademarks are made with explicit buyer-supplied licensing or fall under permitted personal use",
        ],
      },
      {
        heading: "DMCA takedown",
        text: (
          <>
            If you believe content on Crafters Market infringes your
            copyright, send a DMCA notice to <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">{SUPPORT_EMAIL}</a>{" "}
            with: (1) your contact info, (2) a description of the work
            infringed, (3) the URL of the allegedly infringing listing, (4) a
            good-faith statement, and (5) your physical or electronic
            signature. Counter-notices follow the same channel.
          </>
        ),
      },
    ],
    callout: {
      tone: "info",
      text: "Repeat infringers will have their accounts permanently terminated. Crafters Market cooperates with law-enforcement and rights-holders' lawful requests.",
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
];

// ============================================================
//  Tone-aware callout box (yellow/amber for warn, neutral for info)
// ============================================================
function Callout({ data }) {
  const Icon = data.icon || (data.tone === "warn" ? AlertTriangle : null);
  const cls =
    data.tone === "warn"
      ? "border-amber-700/40 bg-amber-500/5"
      : "border-line bg-paper";
  return (
    <div className={`border ${cls} p-4 my-5 flex gap-3 items-start`}>
      {Icon && (
        <Icon
          size={16}
          className={`flex-shrink-0 mt-0.5 ${data.tone === "warn" ? "text-brand" : "text-brand"}`}
        />
      )}
      <div className="font-mono text-xs leading-relaxed text-ink">
        {data.text}
      </div>
    </div>
  );
}

// ============================================================
//  Accordion section
// ============================================================
function PolicySection({ section, isOpen, onToggle }) {
  const Icon = section.icon;
  return (
    <div
      // iter318a — anchor target so footer links like `/policy#shipping`
      // scroll the user to the right section. Browsers default to
      // top-of-element on hash-jump, so we keep the wrapper id-bound
      // (the page-level useEffect also force-opens this section).
      id={section.id}
      className={`border ${isOpen ? "border-brand/40" : "border-line"} transition-colors scroll-mt-32`}
      data-testid={`policy-section-${section.id}`}
    >
      {/* iter318a — alias anchors: footer links to /policy#buyer-protection
          and /policy#maker-agreement both land on this same section,
          because they're the two blocks inside the Makers Market policy.
          Empty <span id> tags are inert layout-wise. */}
      {section.aliasIds?.map((aid) => (
        <span key={aid} id={aid} className="block scroll-mt-32" aria-hidden="true" />
      ))}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-4 p-5 md:p-6 text-left hover:bg-paper transition"
        data-testid={`policy-toggle-${section.id}`}
      >
        <span
          className={`w-10 h-10 flex items-center justify-center flex-shrink-0 border ${
            isOpen
              ? "bg-brand text-[#0a0a0a] border-brand"
              : "bg-surface text-brand border-line"
          }`}
        >
          <Icon size={18} />
        </span>
        <span className="flex-1 font-display text-xl md:text-2xl tracking-[-0.005em]">
          {section.title}
        </span>
        <ChevronDown
          size={20}
          className={`flex-shrink-0 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="px-5 md:px-6 pb-6 md:pb-8 pt-0 space-y-5">
          {section.intro && (
            <p className="font-mono text-sm text-ink leading-relaxed">
              {section.intro}
            </p>
          )}

          {(section.blocks || []).map((block, i) => (
            <div key={i} className="space-y-3">
              {block.heading && (
                <h4 className="font-display text-base uppercase tracking-[0.02em] text-ink">
                  {block.heading}
                </h4>
              )}
              {block.text && (
                <p className="font-mono text-sm text-ink leading-relaxed">
                  {block.text}
                </p>
              )}
              {block.list && (
                <ul className="space-y-2 font-mono text-sm">
                  {block.list.map(([k, v], j) => (
                    <li key={j} className="flex gap-3 text-ink">
                      <span className="text-brand mt-1">▪</span>
                      <span>
                        <b className="text-ink">{k}</b> {v}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {block.bullets && (
                <ul className="space-y-2 font-mono text-sm">
                  {block.bullets.map((b, j) => (
                    <li key={j} className="flex gap-3 text-ink">
                      <span className="text-brand mt-1">▪</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {section.callout && <Callout data={section.callout} />}

          {section.outro && (
            <p className="font-mono text-sm text-ink leading-relaxed">
              {section.outro}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  Page shell
// ============================================================
export default function PolicyPage() {
  // Open the first 3 sections by default — the rest are collapsed
  // so the page reads as a structured index rather than a wall of text.
  const [open, setOpen] = useState({ terms: true, shipping: true, returns: true });
  const toggle = (id) => setOpen((s) => ({ ...s, [id]: !s[id] }));

  // iter318a — hash deep-link support. When the user lands on
  // `/policy#shipping` (or any alias like `#buyer-protection`), find
  // the canonical section that owns that id (or claims it via aliasIds)
  // and (a) force it open, (b) scroll it into view. Runs once on mount
  // and again on any in-app hash change.
  useEffect(() => {
    const applyHash = () => {
      const hash = (window.location.hash || "").replace(/^#/, "");
      if (!hash) return;
      const ownerId = (SECTIONS.find(
        (s) => s.id === hash || (s.aliasIds || []).includes(hash),
      ) || {}).id;
      if (!ownerId) return;
      setOpen((s) => ({ ...s, [ownerId]: true }));
      // Defer scroll until after the section opens (next paint).
      setTimeout(() => {
        const el = document.getElementById(hash) || document.getElementById(ownerId);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useStructuredData({
    title: "Terms of Service & Site Policies · Crafters Market",
    description: "Crafters Market Terms of Service, shipping, returns, custom orders, payments, Makers Market commission, privacy, prohibited items, IP, and seller/buyer conduct.",
    url: "https://craftersmarket.org/policy",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Crafters Market Site Policies",
      url: "https://craftersmarket.org/policy",
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
    },
  });

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="policy-page">
      <div className="w-full max-w-[1100px] mx-auto px-4 md:px-8">
        <header className="mb-12 md:mb-16">
          <div className="flex items-center gap-3 mb-4">
            <span className="h-px w-8 bg-brand" />
            <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">Policies &middot; The Fine Print</span>
          </div>
          <h1
            className="font-heading uppercase text-5xl sm:text-7xl lg:text-8xl leading-[0.92] tracking-tight text-ink mb-6"
            data-testid="policy-h1"
          >
            Site <span className="text-brand">policies</span><span className="text-ink">.</span>
          </h1>
          <p className="font-body text-base sm:text-lg text-ink-muted max-w-2xl leading-relaxed">
            The full operating manual for buying and selling on Crafters
            Market. Each section opens to its full text &mdash; please read the ones
            relevant to your transaction. By using this site you agree to all
            policies below. Last updated <span className="text-ink font-semibold">April 2026</span>.
          </p>
          <div className="inline-flex items-center gap-2 mt-5 px-3 py-1.5 border border-amber-700/40 bg-amber-500/5">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand">
              ◆ Founding Access v1
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              · Pending legal review
            </span>
          </div>
        </header>

        <div className="space-y-3" data-testid="policy-sections">
          {SECTIONS.map((s) => (
            <PolicySection
              key={s.id}
              section={s}
              isOpen={!!open[s.id]}
              onToggle={() => toggle(s.id)}
            />
          ))}
        </div>

        {/* Contact footer */}
        <div className="border border-line mt-12 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-5 md:gap-8">
          <span className="w-12 h-12 flex items-center justify-center bg-surface text-brand border border-line flex-shrink-0">
            <Mail size={20} />
          </span>
          <div className="flex-1">
            <div className="font-display text-2xl tracking-[-0.005em]">
              Question we didn't answer?
            </div>
            <p className="font-mono text-xs text-ink-muted mt-1 leading-relaxed">
              Email us at{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
                {SUPPORT_EMAIL}
              </a>{" "}
              and we'll respond within 1 business day. For urgent
              transaction issues, include your order ID.
            </p>
          </div>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="btn-industrial btn-primary"
            data-testid="policy-contact-cta"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}
