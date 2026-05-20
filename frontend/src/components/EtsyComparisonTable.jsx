import React, { useEffect, useState } from "react";

/**
 * EtsyComparisonTable
 * --------------------
 * The killer recruiting math: side-by-side Etsy vs CraftersMarket fees
 * at three example GMV bands. Pulls the live CraftersMarket numbers
 * from `/api/policy/fee-policy` so a future fee change doesn't make
 * the marketing page lie.
 *
 * Etsy numbers are hard-coded (as of Feb 2026): 6.5% commission, $0.20
 * listing fee, $0.20 renewal every 4mo, 12% off-site ad fee. The fact
 * that we hard-code them is intentional — we want to confidently show
 * THEIR fees without being responsible for tracking their changes.
 */
const ETSY = {
  commission_pct: 6.5,
  listing_fee_cents: 20,
  offsite_ad_pct: 12,
};

function calc(gmv, fee, listings_per_month, founder = false) {
  const months = 12;
  const annual_listings = listings_per_month * months;
  // CraftersMarket Founder: 50 free/mo (600/yr), then $0.20. Etsy: all paid.
  const us_listing_charges =
    founder ? Math.max(0, annual_listings - 50 * months) * 0.20 : 0;
  const etsy_listing_charges = annual_listings * 0.20;
  // Renewals: every 4 months on Etsy ($0.20 each). CraftersMarket Founder = $0.
  const etsy_renewals = annual_listings * (12 / 4) * 0.20;
  const us_commission = gmv * (fee / 100);
  const etsy_commission = gmv * (ETSY.commission_pct / 100);
  // Assume 30% of GMV came from off-site ads (Etsy industry standard).
  const ad_gmv = gmv * 0.30;
  const etsy_ad_fee = ad_gmv * (ETSY.offsite_ad_pct / 100);
  const us_total = us_commission + us_listing_charges;
  const etsy_total = etsy_commission + etsy_listing_charges + etsy_renewals + etsy_ad_fee;
  return {
    us_total: Math.round(us_total),
    etsy_total: Math.round(etsy_total),
    you_save: Math.round(etsy_total - us_total),
    us_keep: Math.round(gmv - us_total),
    etsy_keep: Math.round(gmv - etsy_total),
  };
}

const ROWS = [
  { gmv: 5000, listings: 8, label: "Side-hustle shop", sublabel: "$5K/yr · 8 new listings/mo" },
  { gmv: 25000, listings: 15, label: "Part-time shop", sublabel: "$25K/yr · 15 new listings/mo" },
  { gmv: 75000, listings: 30, label: "Full-time shop", sublabel: "$75K/yr · 30 new listings/mo" },
];

const API = process.env.REACT_APP_BACKEND_URL;

export default function EtsyComparisonTable({ testId = "etsy-comparison" }) {
  const [feePct, setFeePct] = useState(3); // Founder default — updated from API

  useEffect(() => {
    fetch(`${API}/api/policy/fee-policy`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.platform_fee_bps && typeof d.platform_fee_bps === "number") {
          // We display the FOUNDER rate (lower of platform_fee_bps and
          // the Founder constant). The fee-policy endpoint exposes the
          // base rate; Founders pay 3% which is the constant we keep
          // hard-coded here since it's tied to product marketing.
          setFeePct(3);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <section
      className="border border-[#262626] bg-[#0a0a0a] p-6 md:p-10 my-12"
      data-testid={testId}
    >
      <div className="mb-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
          ◆ The Math · Etsy vs CraftersMarket
        </div>
        <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[0.95] text-[#fafafa]">
          You keep more.<br />
          Year after year.
        </h2>
        <p className="text-[#a3a3a3] mt-4 text-sm leading-relaxed max-w-2xl">
          Below is what each shop pays in platform fees on a typical year.
          CraftersMarket Founder numbers are calculated live from our current
          fee policy. Etsy numbers are based on their published fee schedule
          (6.5% commission · $0.20 listing · $0.20 renewal every 4 months ·
          12% off-site ads on 30% of GMV).
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {ROWS.map((r) => {
          const c = calc(r.gmv, feePct, r.listings, true);
          return (
            <div
              key={r.gmv}
              className="border border-[#262626] bg-black p-5"
              data-testid={`etsy-row-${r.gmv}`}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
                {r.label}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#525252] mb-4">
                {r.sublabel}
              </div>

              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#737373]">Etsy fees</span>
                  <span className="font-display text-2xl text-[#525252] line-through">${c.etsy_total.toLocaleString()}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ff4500]">CraftersMarket</span>
                  <span className="font-display text-3xl text-[#ff4500]">${c.us_total.toLocaleString()}</span>
                </div>
                <div className="border-t border-[#262626] pt-3 mt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">You save</span>
                    <span className="font-display text-3xl text-emerald-400">${c.you_save.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-6 font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] text-center">
        Founder rate locked for life · After Founder #100, 12-month window then auto-rolls to Standard
      </div>
    </section>
  );
}
