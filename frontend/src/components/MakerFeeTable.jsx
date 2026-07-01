import React, { useEffect, useState } from "react";
import { fetchFeePolicy } from "../lib/api";

// Sane fallback that mirrors backend/.env defaults so the component
// still renders meaningfully if the public fee-policy endpoint is slow.
const FALLBACK = {
  platform_fee_bps: 500,
  processing_fee_bps: 300,
  plus_platform_fee_bps: 400,
  offsite_ad_fee_bps: 1200,
  listing_fee_cents: 20,
  listing_free_quota: 10,
  plus_monthly_listing_quota: 15,
  plus_price_usd: 12,
  promotion_weekly_fee_cents: 500,
};

const fmtPct = (bps) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
const fmtCents = (c) => `$${(c / 100).toFixed(2)}`;

/**
 * Public, source-of-truth fee disclosure for prospective and active makers.
 * Renders the same numbers found in /policy and in `backend/.env` so makers
 * see EXACTLY what they will be charged before they apply or before they
 * hand over banking details to Stripe Connect.
 *
 * Props:
 *   variant: "compact" | "full"   default "full"
 *   title:   override the header label (optional)
 */
export default function MakerFeeTable({ variant = "full", title }) {
  const [p, setP] = useState(FALLBACK);

  useEffect(() => {
    let mounted = true;
    fetchFeePolicy()
      .then((data) => { if (mounted && data) setP({ ...FALLBACK, ...data }); })
      .catch(() => { /* fall back silently */ });
    return () => { mounted = false; };
  }, []);

  const totalFreeBps = p.platform_fee_bps + p.processing_fee_bps;
  const totalPlusBps = p.plus_platform_fee_bps + p.processing_fee_bps;

  const rows = [
    {
      k: "Listing fee · Free tier",
      v: `First ${p.listing_free_quota} listings free for life · ${fmtCents(p.listing_fee_cents)} per additional listing or renewal`,
    },
    {
      k: "Listing fee · Crafters Plus",
      v: `First ${p.plus_monthly_listing_quota}/month free · ${fmtCents(p.listing_fee_cents)} after`,
    },
    {
      k: "Monthly fee",
      v: `$0 on Free tier · Crafters Plus optional at $${p.plus_price_usd}/mo`,
    },
    {
      k: "Commission",
      v: `${fmtPct(p.platform_fee_bps)} on Free · ${fmtPct(p.plus_platform_fee_bps)} on Plus`,
    },
    {
      k: "Payment processing",
      v: `${fmtPct(p.processing_fee_bps)} (Stripe processing — applies to all tiers)`,
    },
    {
      k: "Total deducted per sale",
      v: `Free: ${fmtPct(totalFreeBps)} · Plus: ${fmtPct(totalPlusBps)}`,
      emphasis: true,
    },
    {
      k: "Off-site ad fee",
      v: `${fmtPct(p.offsite_ad_fee_bps)} only on sales attributed to off-site ads we run for you (Google / Meta)`,
    },
    {
      k: "Promoted listing",
      v: `${fmtCents(p.promotion_weekly_fee_cents)} / week (optional, opt-in only)`,
    },
  ];

  const display = variant === "compact"
    ? rows.filter((r) => ["Listing fee · Free tier", "Commission", "Payment processing", "Total deducted per sale"].includes(r.k))
    : rows;

  return (
    <div
      className="border border-line bg-paper p-6 md:p-7"
      data-testid="maker-fee-table"
    >
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand">
          ◆ {title || "What you'll pay"}
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/fees.pdf"
            target="_blank"
            rel="noopener"
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition"
            data-testid="maker-fee-table-pdf-link"
          >
            ↓ PDF
          </a>
          <a
            href="/policies/fee-pricing"
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition"
            data-testid="maker-fee-table-policy-link"
          >
            Full policy ↗
          </a>
        </div>
      </div>

      <ul className="divide-y divide-[#1f1f1f]">
        {display.map((r) => (
          <li
            key={r.k}
            className="py-3 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-1 md:gap-6"
            data-testid={`maker-fee-row-${r.k.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">
              {r.k}
            </div>
            <div className={`font-mono text-xs leading-relaxed ${r.emphasis ? "text-brand" : "text-ink"}`}>
              {r.v}
            </div>
          </li>
        ))}
      </ul>

      <p className="font-mono text-[10px] text-ink-muted mt-5 leading-relaxed">
        Fees are calculated on the item subtotal (excluding shipping &amp; sales tax)
        and deducted automatically from each payout via Stripe Connect. Listing-fee
        charges accrue and settle against your next payout — never billed to a card.
      </p>
    </div>
  );
}
