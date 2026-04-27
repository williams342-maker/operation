import React, { useState } from "react";
import {
  ChevronDown, Truck, RotateCcw, Wand2, Boxes, CreditCard,
  ShieldCheck, Lock, Ban, Copyright, AlertTriangle, UserX, Mail,
} from "lucide-react";
import { useStructuredData } from "../lib/seo";

const COMMISSION_RATE = "10%";
const SUPPORT_EMAIL = "team@craftersmarket.org";

// ============================================================
//  Policy sections — every clause is written to be enforceable
//  AND protective: clear timelines, named parties, explicit
//  liability boundaries. Mirrors the structure in the user's
//  reference mockup (11 sections), wired to current site config.
// ============================================================
const SECTIONS = [
  {
    id: "shipping",
    icon: Truck,
    title: "Shipping Policy",
    intro: "All orders are processed within 1–3 business days after payment confirmation. Orders placed on weekends or holidays will begin processing the next business day.",
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
        heading: "International Shipping",
        list: [
          ["Canada & Mexico:", "7–14 business days"],
          ["All other countries:", "10–21 business days"],
        ],
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: "International buyers are responsible for any customs duties, import taxes, or fees charged by their country. Crafters Market is not liable for delays due to customs.",
    },
    outro: (
      <>
        Tracking information is emailed once your order ships. If you haven't
        received a tracking number within <b className="text-[#ff4500]">4 business days</b> of ordering, please contact
        us at <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#ff4500] hover:underline">{SUPPORT_EMAIL}</a>.
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
        <b className="text-[#ff4500]">3–5 business days</b> of receiving the
        returned item in its original condition.
      </>
    ),
  },

  {
    id: "custom",
    icon: Wand2,
    title: "Custom & Personalized Orders",
    intro: "Custom and personalized orders are a specialty of Crafters Market. Because each piece is made to your unique specifications, these orders require special considerations.",
    blocks: [
      {
        bullets: [
          "A design proof will be sent for your approval before production begins",
          "You must approve the proof in writing (email or message) before we proceed",
          "Changes to the design after proof approval may incur additional fees",
          "Production begins only after proof approval and full payment",
        ],
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
    outro: "Rush production is available for most custom orders for an additional fee. Contact us before ordering to confirm availability.",
  },

  {
    id: "fulfillment",
    icon: Boxes,
    title: "Order Processing & Fulfillment",
    intro: (
      <>
        Most in-stock items ship within <b className="text-[#ff4500]">1–3 business days</b>. Custom and made-to-order
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
        — contact <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#ff4500] hover:underline">{SUPPORT_EMAIL}</a> to discuss options.
      </>
    ),
  },

  {
    id: "marketplace",
    icon: ShieldCheck,
    title: "Makers Market — Seller & Commission Policy",
    intro: "Crafters Market's Makers Market allows approved Artists to list and sell their work directly to buyers on our platform.",
    blocks: [
      {
        heading: "For Sellers",
        list: [
          ["Listing fee:", `$0 — free to list`],
          ["Monthly fee:", "$0 — no subscription required"],
          ["Commission:", `${COMMISSION_RATE} of the final sale price, collected on completed transactions`],
        ],
        bullets: [
          "All sellers must apply and be approved before listing",
          "Sellers set their own prices and ship directly to buyers",
          "Sellers are independent contractors, not employees of Crafters Market",
          "Payouts are issued via Stripe Connect to the seller's verified bank account",
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
    ],
    callout: {
      tone: "info",
      text: "Payments are processed by Stripe under their PCI-DSS-compliant infrastructure. We do not see, store, or log your full card details at any point.",
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
            copyright, send a DMCA notice to <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#ff4500] hover:underline">{SUPPORT_EMAIL}</a>{" "}
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
    intro: "Sellers found violating any of the following may have listings removed, payouts withheld pending investigation, and accounts suspended or terminated:",
    blocks: [
      {
        bullets: [
          "Failing to ship paid orders within the listed timeframe without communication",
          "Misrepresenting materials, dimensions, technique, or origin of a piece",
          "Using stock photography or AI-generated imagery to depict pieces that do not match the actual deliverable",
          "Refusing to honor refunds or replacements covered by their stated shop policies",
          "Communicating with buyers in a hostile, threatening, or harassing manner",
          "Attempting to circumvent platform fees by routing payments off-platform",
          "Providing false KYC information during seller onboarding",
        ],
      },
    ],
    callout: {
      tone: "warn",
      icon: AlertTriangle,
      text: "Crafters Market reserves the right to withhold or claw back payouts from sellers who engage in fraudulent or substantially-non-conforming sales. Stripe Connect dispute and chargeback policies apply in addition to ours.",
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
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#ff4500] hover:underline">{SUPPORT_EMAIL}</a>{" "}
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
      : "border-[#262626] bg-[#0d0d0d]";
  return (
    <div className={`border ${cls} p-4 my-5 flex gap-3 items-start`}>
      {Icon && (
        <Icon
          size={16}
          className={`flex-shrink-0 mt-0.5 ${data.tone === "warn" ? "text-amber-400" : "text-[#ff4500]"}`}
        />
      )}
      <div className="font-mono text-xs leading-relaxed text-[#d4d4d4]">
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
      className={`border ${isOpen ? "border-[#ff4500]/40" : "border-[#262626]"} transition-colors`}
      data-testid={`policy-section-${section.id}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-4 p-5 md:p-6 text-left hover:bg-[#0f0f0f] transition"
        data-testid={`policy-toggle-${section.id}`}
      >
        <span
          className={`w-10 h-10 flex items-center justify-center flex-shrink-0 border ${
            isOpen
              ? "bg-[#ff4500] text-[#0a0a0a] border-[#ff4500]"
              : "bg-[#1a1a1a] text-[#ff4500] border-[#262626]"
          }`}
        >
          <Icon size={18} />
        </span>
        <span className="flex-1 font-display text-xl md:text-2xl tracking-[-0.005em]">
          {section.title}
        </span>
        <ChevronDown
          size={20}
          className={`flex-shrink-0 text-[#a3a3a3] transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="px-5 md:px-6 pb-6 md:pb-8 pt-0 space-y-5">
          {section.intro && (
            <p className="font-mono text-sm text-[#d4d4d4] leading-relaxed">
              {section.intro}
            </p>
          )}

          {(section.blocks || []).map((block, i) => (
            <div key={i} className="space-y-3">
              {block.heading && (
                <h4 className="font-display text-base uppercase tracking-[0.02em] text-[#e5e5e5]">
                  {block.heading}
                </h4>
              )}
              {block.text && (
                <p className="font-mono text-sm text-[#d4d4d4] leading-relaxed">
                  {block.text}
                </p>
              )}
              {block.list && (
                <ul className="space-y-2 font-mono text-sm">
                  {block.list.map(([k, v], j) => (
                    <li key={j} className="flex gap-3 text-[#d4d4d4]">
                      <span className="text-[#ff4500] mt-1">▪</span>
                      <span>
                        <b className="text-[#e5e5e5]">{k}</b> {v}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {block.bullets && (
                <ul className="space-y-2 font-mono text-sm">
                  {block.bullets.map((b, j) => (
                    <li key={j} className="flex gap-3 text-[#d4d4d4]">
                      <span className="text-[#ff4500] mt-1">▪</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {section.callout && <Callout data={section.callout} />}

          {section.outro && (
            <p className="font-mono text-sm text-[#d4d4d4] leading-relaxed">
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
  const [open, setOpen] = useState({ shipping: true, returns: true, custom: true });
  const toggle = (id) => setOpen((s) => ({ ...s, [id]: !s[id] }));

  useStructuredData({
    title: "Site Policies · Shipping, Returns, Marketplace · Crafters Market",
    description: "Crafters Market policies — shipping, returns, custom orders, payments, Makers Market commission, privacy, prohibited items, IP, and seller/buyer conduct.",
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
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Policies
          </div>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[0.92] tracking-[-0.01em] mb-5">
            Site Policies
          </h1>
          <p className="font-mono text-sm md:text-base text-[#a3a3a3] max-w-2xl leading-relaxed">
            The full operating manual for buying and selling on Crafters
            Market. Each section opens to its full text — please read the ones
            relevant to your transaction. By using this site you agree to all
            policies below. Last updated <span className="text-[#e5e5e5]">April 2026</span>.
          </p>
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
        <div className="border border-[#262626] mt-12 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-5 md:gap-8">
          <span className="w-12 h-12 flex items-center justify-center bg-[#1a1a1a] text-[#ff4500] border border-[#262626] flex-shrink-0">
            <Mail size={20} />
          </span>
          <div className="flex-1">
            <div className="font-display text-2xl tracking-[-0.005em]">
              Question we didn't answer?
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] mt-1 leading-relaxed">
              Email us at{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#ff4500] hover:underline">
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
