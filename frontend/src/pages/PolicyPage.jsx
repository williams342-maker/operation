import React, { useEffect, useState } from "react";
import {
  ChevronDown, FileText, Truck, RotateCcw, Wand2, Boxes, CreditCard,
  ShieldCheck, Lock, Ban, Copyright, AlertTriangle, UserX, Mail,
} from "lucide-react";
import { useStructuredData } from "../lib/seo";

const SUPPORT_EMAIL = "team@craftersmarket.org";

// ============================================================
//  Policy sections — every clause is written to be enforceable
//  AND protective: clear timelines, named parties, explicit
//  liability boundaries. Mirrors the structure in the user's
//  reference mockup (11 sections), wired to current site config.
// ============================================================
const SECTIONS = [
  {
    id: "terms",
    icon: FileText,
    title: "Terms of Service",
    intro: "Welcome to Crafters Market. By using our website and services, you agree to these Terms.",
    blocks: [
      {
        heading: "For Buyers",
        bullets: [
          "All sales are between you and the individual seller, not Crafters Market",
          "We only provide the platform — questions or issues about orders should be directed to the seller",
          "Once you purchase, the seller is responsible for shipping and fulfilling your order",
        ],
      },
      {
        heading: "For Sellers",
        bullets: [
          "You must sell only items you make yourself — no reselling or drop-shipping",
          "You are responsible for accurately describing your items, shipping on time, and handling customer service",
          "We charge a percentage commission on every sale (the exact fee is shown in the Makers Market section below and again before you list)",
          "You must follow our Prohibited Items policy — no counterfeit, illegal, or harmful products",
        ],
      },
      {
        heading: "General",
        bullets: [
          "We may remove listings or suspend accounts that violate these rules",
          "All payments are processed securely via Stripe; we are not responsible for disputes between buyers and sellers beyond what Stripe's protections cover",
          "These terms may be updated at any time — continued use of Crafters Market means you accept the changes",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "These Terms of Service operate alongside the topic-specific policies below (Shipping, Returns, Marketplace, Privacy, Prohibited Items, etc.). Where a specific policy provides more detail, that detail controls.",
    },
    outro: (
      <>
        <span className="text-ink-muted">Last updated:</span>{" "}
        <b className="text-ink">April 2026</b>
      </>
    ),
  },

  {
    id: "shipping",
    icon: Truck,
    title: "Shipping Policy",
    intro: "Crafters Market currently ships to U.S. addresses only. International shipping is not available at this time — we may add it in the future. All orders are processed within 1–3 business days after payment confirmation. Orders placed on weekends or holidays begin processing the next business day.",
    blocks: [
      {
        heading: "Domestic (U.S.) Shipping Estimates",
        list: [
          ["Standard:", "5–7 business days"],
          ["Expedited:", "2–3 business days"],
          ["Overnight:", "1 business day (where available)"],
        ],
      },
      {
        heading: "International Orders",
        bullets: [
          "We do not ship outside the United States at this time",
          "Checkout will only accept U.S. shipping addresses",
          "International shipping may be enabled in the future — follow our newsletter for updates",
        ],
      },
    ],
    callout: {
      tone: "info",
      icon: AlertTriangle,
      text: "Shipping is currently limited to the 50 U.S. states, D.C., and U.S. territories. APO/FPO/DPO military addresses are accepted at standard domestic rates.",
    },
    outro: (
      <>
        Tracking information is emailed once your order ships. If you haven't
        received a tracking number within <b className="text-brand">4 business days</b> of ordering, please contact
        us at <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">{SUPPORT_EMAIL}</a>.
      </>
    ),
  },

  {
    id: "returns",
    icon: RotateCcw,
    title: "Returns & Exchanges",
    intro: "We want you to love your piece. If something isn't right, we'll do our best to make it right.",
    blocks: [
      {
        heading: "Eligible for return within 14 days of delivery:",
        bullets: [
          "Item arrived damaged or defective",
          "Item significantly different from the listing description",
          "Wrong item received",
        ],
      },
      {
        heading: "Not eligible for return:",
        bullets: [
          "Custom or personalized orders (see Custom Orders policy)",
          "Digital files and downloadable designs",
          "Items marked as final sale",
          "Items returned after the 14-day window",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "To initiate a return, contact us within 14 days of delivery. Buyers are responsible for return shipping costs unless the error was ours.",
    },
    outro: (
      <>
        Refunds are issued to the original payment method within{" "}
        <b className="text-brand">3–5 business days</b> of receiving the
        returned item in its original condition.
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
        text: "Some shops opt out of the proof-approval step for very simple personalizations (e.g. name engraving on a stock SKU). Each shop's individual custom-order policy is shown on their profile and on every product detail page. Always review the seller's policy before placing a custom order.",
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: (
        <>
          Custom orders are <b className="text-amber-300">non-refundable</b>{" "}
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
    // iter318a — alias anchors so direct deep-links from the footer
    // (Buyer Protection / Maker Agreement) land on this section, which
    // owns BOTH the buyer-side and seller-side rules.
    aliasIds: ["buyer-protection", "maker-agreement"],
    icon: ShieldCheck,
    title: "Makers Market — Seller & Commission Policy",
    intro: "Crafters Market's Makers Market allows approved Artists to list and sell their work directly to buyers on our platform.",
    blocks: [
      {
        heading: "For Sellers — Fees & Tiers",
        list: [
          ["Listing fee (Free tier):", "First 10 listings are free for the lifetime of the account; each additional listing or renewal is $0.20"],
          ["Listing fee (Crafters Plus):", "First 15 listings each calendar month are free; each additional listing/renewal is $0.20"],
          ["Monthly fee:", "$0 on the Free tier — no subscription required. Crafters Plus is optional at $12/month"],
          ["Commission (Free tier):", "5% of the final item subtotal, retained on completed transactions"],
          ["Commission (Crafters Plus):", "4% of the final item subtotal — a 1% discount vs. Free tier"],
          ["Payment processing:", "3% of the final item subtotal, retained to cover Stripe processing costs (applies to all tiers)"],
          ["Total deducted per sale:", "Free tier: 8% (5% commission + 3% processing) · Plus: 7% (4% + 3%)"],
          ["Off-site ad fee:", "12% of the item subtotal on sales attributed to Crafters Market off-site ad campaigns (Google / Meta). Only charged when an off-site ad directly drives the sale"],
          ["Promoted Listing fee:", "$5 / week per promoted listing (optional, opt-in only)"],
        ],
        bullets: [
          "All sellers must apply and be approved before listing",
          "Sellers set their own prices and ship directly to buyers",
          "Sellers are independent contractors, not employees of Crafters Market",
          "Payouts are issued via Stripe Connect to the seller's verified bank account",
          "All fees are calculated on the item subtotal (excluding shipping and sales tax) and deducted automatically before payout",
          "Listing-fee charges accrue to a balance and are settled against your next payout — no upfront card billing for listing fees",
          "Crafters Plus subscription auto-renews monthly; you may cancel at any time from the maker dashboard. Cancellation takes effect at the end of the current billing period",
        ],
      },
      {
        heading: "For Buyers purchasing through Makers Market",
        bullets: [
          "Transactions are facilitated by Crafters Market via Stripe; the maker fulfills the order",
          "Each seller's individual shipping, return, and custom-order policies apply",
          "Crafters Market is not responsible for the workmanship, condition, or shipping of any individual seller's pieces beyond the protections offered by Stripe",
        ],
      },
    ],
    callout: {
      tone: "info",
      text: "All Makers Market sellers are vetted and approved by Crafters Market. Seller profiles include their individual shop policies. We encourage buyers to review a seller's policy before purchasing.",
    },
  },

  {
    id: "privacy",
    icon: Lock,
    title: "Privacy & Data Policy",
    intro: "Crafters Market takes your privacy seriously. Here's how we handle your information:",
    blocks: [
      {
        bullets: [
          "We collect only the information necessary to process and fulfill your order",
          "Your personal data is never sold to third parties",
          "Order information is shared with shipping carriers solely to fulfill delivery",
          "Email addresses are used for transactional notifications and (with your consent) marketing",
          "Site analytics are first-party and aggregated — no cross-site ad tracking, no third-party ad pixels",
          "Right to be forgotten: email us and we'll purge your data within 30 days unless retention is required by law",
        ],
      },
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
  },

  {
    id: "prohibited",
    icon: Ban,
    title: "Prohibited Items & Listings",
    intro: "Crafters Market exists to celebrate handcrafted, original work. The following are not permitted on the platform and will result in listing removal and may result in account suspension:",
    blocks: [
      {
        bullets: [
          "Mass-produced or drop-shipped items misrepresented as handmade",
          "Counterfeit goods or items infringing on registered trademarks or copyrights",
          "Weapons, explosives, ammunition, or replicas thereof",
          "Hate speech, hate symbols, or content promoting violence or discrimination",
          "Items featuring real human remains, endangered wildlife products, or illegal materials",
          "Sexually explicit content, drugs, drug paraphernalia, or related accessories",
          "Items that violate any applicable U.S. federal, state, or local law",
          "Recalled products or items subject to active product-safety alerts",
        ],
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: "Buyers and sellers are encouraged to report suspected prohibited listings to our team. We review every report and take action within 48 hours.",
    },
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
          className={`flex-shrink-0 mt-0.5 ${data.tone === "warn" ? "text-amber-400" : "text-brand"}`}
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
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ Policies
          </div>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[0.92] tracking-[-0.01em] mb-5">
            Site Policies
          </h1>
          <p className="font-mono text-sm md:text-base text-ink-muted max-w-2xl leading-relaxed">
            The full operating manual for buying and selling on Crafters
            Market. Each section opens to its full text — please read the ones
            relevant to your transaction. By using this site you agree to all
            policies below. Last updated <span className="text-ink">April 2026</span>.
          </p>
          <div className="inline-flex items-center gap-2 mt-5 px-3 py-1.5 border border-amber-700/40 bg-amber-500/5">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber-400">
              ◆ Beta v1
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
