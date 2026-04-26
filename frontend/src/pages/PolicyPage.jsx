import React, { useState } from "react";

const SECTIONS = [
  {
    id: "privacy",
    title: "Privacy",
    body: [
      "We collect only what we need to ship your order: name, address, and email. Nothing is sold or rented to third parties — ever.",
      "Payments are processed by Stripe. We never see, store, or log your card details.",
      "Site analytics are first-party and aggregated. No cross-site tracking. No ad pixels.",
      "Email receipts and shipping notifications are sent via Resend with a verified Crafters Market domain.",
      "Right to be forgotten: email team@craftersmarket.org and we'll purge your data within 30 days.",
    ],
  },
  {
    id: "terms",
    title: "Terms of Service",
    body: [
      "By using Crafters Market you agree to these terms. The marketplace connects buyers with approved CNC artisan makers; we facilitate discovery, payment, and ops, but each piece is built by an independent maker.",
      "Listings are accurate to the best of our makers' ability. Slight variations are part of handmade craft and are not defects.",
      "Misuse — fraud, chargebacks without contact, abusive behaviour toward makers — terminates your account and may be reported to law enforcement where applicable.",
    ],
  },
  {
    id: "shipping",
    title: "Shipping",
    body: [
      "Continental US shipping. Hawaii, Alaska, and international: contact team@craftersmarket.org for a custom quote.",
      "Free shipping on orders ≥ $250. Standard rates: Wall Art $25, Custom Signs $35, Outdoor Art $55.",
      "Lead time 5–10 business days from purchase to dispatch — every piece is built to order.",
      "Carrier: USPS / UPS depending on dimensions. Tracking emailed at dispatch.",
    ],
  },
  {
    id: "returns",
    title: "Returns",
    body: [
      "Stock pieces (Wall Art, Outdoor Art): 14-day return window. Buyer covers return shipping; we refund the item once it's back in the workshop intact.",
      "Custom / made-to-order pieces (Custom Signs and any project routed through /custom-order): non-returnable unless defective. We send a digital proof before cutting on every custom piece — speak now, not later.",
      "30-day craftsmanship guarantee on all work. If a piece arrives damaged or fails under normal use within 30 days, we replace or refund — your call.",
    ],
  },
];

export default function PolicyPage() {
  const [tab, setTab] = useState("privacy");
  const active = SECTIONS.find((s) => s.id === tab) || SECTIONS[0];
  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="policy-page">
      <div className="max-w-[1100px] mx-auto px-4 md:px-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ The Fine Print
        </div>
        <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] uppercase mb-12">
          Policies.
        </h1>

        <div className="grid md:grid-cols-12 gap-8">
          <ul className="md:col-span-3 flex md:flex-col flex-row overflow-x-auto md:overflow-visible md:border-r border-[#262626]" data-testid="policy-tabs">
            {SECTIONS.map((s) => (
              <li key={s.id} className="md:w-full">
                <button
                  onClick={() => setTab(s.id)}
                  className={`block w-full md:text-left px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] transition whitespace-nowrap ${
                    tab === s.id
                      ? "text-[#ff4500] border-b-2 md:border-b-0 md:border-l-2 border-[#ff4500]"
                      : "text-[#a3a3a3] hover:text-[#e5e5e5]"
                  }`}
                  data-testid={`policy-tab-${s.id}`}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
          <div className="md:col-span-9 space-y-5">
            <h2 className="font-display text-4xl">{active.title}</h2>
            {active.body.map((p, i) => (
              <p key={i} className="font-mono text-sm text-[#a3a3a3] leading-relaxed">{p}</p>
            ))}
            <p className="pt-6 border-t border-[#262626] font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
              Last updated 2026-04-26 · Questions? team@craftersmarket.org
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
