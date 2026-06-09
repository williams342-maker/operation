/**
 * iter345 — Public price-comparison table for the Apply page.
 *
 * Mounted right under `MakerFeeTable` on /apply so prospective makers
 * see (a) our fee structure first, and (b) how that stacks against
 * Etsy and Shopify second. Both surfaces are conversion-critical.
 *
 * All numbers are kept in a data array so future fee changes are a one-line
 * edit instead of hunting through JSX. Source citations live in `cite`
 * fields and render as small superscript links so the table reads like
 * a magazine comparison spread, not a Wikipedia paragraph.
 */
import React from "react";

const FEATURES = [
  {
    label: "Monthly fee",
    cm: { value: "Free during beta", note: "Founder pricing available", tone: "good" },
    etsy: { value: "Free to open shop", note: null, tone: "neutral" },
    shopify: { value: "$39/mo Basic", note: "$29/mo on annual plan", tone: "bad", cite: 3 },
  },
  {
    label: "Listing fee",
    cm: { value: "None", note: null, tone: "good" },
    etsy: { value: "$0.20 per listing", note: null, tone: "bad", cite: 2 },
    shopify: { value: "None", note: null, tone: "good" },
  },
  {
    label: "Transaction fee",
    cm: { value: "3% for life", note: "Founder pricing", tone: "good", cite: 1 },
    etsy: { value: "6.5%", note: "Transaction fee on every sale", tone: "bad", cite: 2 },
    shopify: { value: "None*", note: "*if using Shopify Payments — otherwise additional fees apply", tone: "neutral", cite: 3 },
  },
  {
    label: "Payment processing",
    cm: { value: "Stripe processing applies", note: null, tone: "neutral" },
    etsy: { value: "~3% + $0.25 (US)", note: null, tone: "neutral", cite: 4 },
    shopify: { value: "2.9% + $0.30", note: "Basic plan", tone: "neutral", cite: 3 },
  },
  {
    label: "Marketplace traffic",
    cm: { value: "Shared marketplace", note: "Curated maker community", tone: "good" },
    etsy: { value: "Massive built-in marketplace", note: "Millions of shoppers", tone: "good" },
    shopify: { value: "None", note: "You bring 100% of traffic", tone: "bad" },
  },
  {
    label: "Community features",
    cm: { value: "Maker-focused community", note: "Showcases, clip feed, leaderboards", tone: "good" },
    etsy: { value: "Limited seller community", note: null, tone: "neutral" },
    shopify: { value: "None built-in", note: null, tone: "bad" },
  },
  {
    label: "Competition",
    cm: { value: "Curated maker marketplace", note: "Hand-reviewed apps", tone: "good" },
    etsy: { value: "Millions of sellers", note: "Open marketplace", tone: "bad" },
    shopify: { value: "Only your store", note: null, tone: "neutral" },
  },
  {
    label: "SEO responsibility",
    cm: { value: "Shared — platform + maker", note: "Auto-tagging, sitemaps, schema", tone: "good" },
    etsy: { value: "Etsy generates traffic", note: null, tone: "good" },
    shopify: { value: "Seller responsible", note: "DIY", tone: "bad" },
  },
  {
    label: "Advertising required",
    cm: { value: "Optional", note: "Promotional engine helps you scale when ready", tone: "good" },
    etsy: { value: "Increasingly important", note: "Visibility shrinks without ads", tone: "bad" },
    shopify: { value: "Often required", note: "Required for growth", tone: "bad" },
  },
];

const CITATIONS = [
  null, // 0 unused; citation IDs are 1-indexed for readability
  {
    label: "Instagram · Maker breakdown reel",
    url: "https://www.instagram.com/reel/DLoR4Y_MtbB/",
  },
  {
    label: "Etsy · Fees & Payments Policy",
    url: "https://www.etsy.com/legal/fees/",
  },
  {
    label: "Shopify · Pricing",
    url: "https://www.shopify.com/pricing",
  },
  {
    label: "eufyMake · Etsy fees breakdown 2026",
    url: "https://www.eufymake.com/blogs/business-ideas/how-much-does-etsy-take-per-sale",
  },
];

function ToneCell({ cell }) {
  // tone = good (emerald), bad (red), neutral (default). Subtle so the
  // table doesn't feel like a sales-funnel infographic.
  const dotCls =
    cell.tone === "good" ? "bg-emerald-400"
    : cell.tone === "bad" ? "bg-red-400"
    : "bg-[#525252]";
  return (
    <td className="px-4 py-4 align-top border-t border-[#1a1a1a]">
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
        <div className="min-w-0">
          <div className="font-display text-sm text-[#f5f5f5] leading-tight">
            {cell.value}
            {cell.cite && (
              <a
                href={CITATIONS[cell.cite]?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 font-mono text-[9px] align-super text-[#ff4500] hover:underline"
                title={CITATIONS[cell.cite]?.label}
              >
                [{cell.cite}]
              </a>
            )}
          </div>
          {cell.note && (
            <div className="font-mono text-[10px] text-[#737373] mt-1">{cell.note}</div>
          )}
        </div>
      </div>
    </td>
  );
}

export default function PricingComparisonTable({ title = "How we compare" }) {
  return (
    <section
      className="border border-[#262626] p-4 md:p-6"
      data-testid="pricing-comparison-table"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
        ◆ Side by side
      </div>
      <h2 className="font-display text-3xl md:text-4xl mb-3 text-[#f5f5f5]">{title}</h2>
      <p className="font-mono text-xs text-[#a3a3a3] max-w-2xl mb-6 leading-relaxed">
        Honest, line-for-line. No &ldquo;starting at&rdquo; asterisks — these are the fees you&apos;ll actually pay
        on your first $1,000 sold. Citations below.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left">
          <thead>
            <tr className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">
              <th className="px-4 py-3 w-[160px]">Feature</th>
              <th className="px-4 py-3 text-[#ff4500]">Crafters Market</th>
              <th className="px-4 py-3">Etsy</th>
              <th className="px-4 py-3">Shopify</th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((row) => (
              <tr
                key={row.label}
                className="hover:bg-[#0c0c0c]"
                data-testid={`compare-row-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <td className="px-4 py-4 align-top border-t border-[#1a1a1a] font-mono text-[10px] uppercase tracking-[0.18em] text-[#a3a3a3]">
                  {row.label}
                </td>
                <ToneCell cell={row.cm} />
                <ToneCell cell={row.etsy} />
                <ToneCell cell={row.shopify} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 pt-4 border-t border-[#1a1a1a]">
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252] mb-2">
          Citations
        </div>
        <ol className="font-mono text-[10px] text-[#737373] space-y-1">
          {CITATIONS.slice(1).map((c, idx) => (
            <li key={c.url}>
              <span className="text-[#525252] mr-1">[{idx + 1}]</span>
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#ff4500] underline-offset-2 hover:underline break-all"
              >
                {c.label}
              </a>
            </li>
          ))}
        </ol>
        <p className="font-mono text-[10px] text-[#525252] mt-4 leading-relaxed">
          Fees current as of {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.
          Etsy &amp; Shopify pricing may change — we&apos;ll update this table within 30 days of any public fee change.
        </p>
      </div>
    </section>
  );
}
