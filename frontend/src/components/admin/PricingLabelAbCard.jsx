import React, { useEffect, useState } from "react";
import { FlaskConical, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchAdminPricingLabelStats } from "../../lib/api";

/**
 * iter334s — A/B test status card for the "From $X" vs "$X – $Y"
 * pricing-label experiment.
 *
 * Shows first-party click counts per variant. Full impressions + CTR
 * live in GA4 (event `experiment_view`) and Bing UET
 * (`ab_pricing_label_view`) since those tools sample better — this card
 * exists as a fast sanity check.
 */
export default function PricingLabelAbCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(14);

  const load = async (d = days) => {
    setLoading(true);
    try {
      setData(await fetchAdminPricingLabelStats(d));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load A/B stats.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days]);

  const from = data?.variants?.find((v) => v.variant === "from") || {};
  const range = data?.variants?.find((v) => v.variant === "range") || {};
  const totalClicks = (from.clicks || 0) + (range.clicks || 0);

  return (
    <div
      className="border border-line bg-paper p-4 space-y-4"
      data-testid="pricing-label-ab-card"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 border border-purple-400/40 bg-purple-400/[0.06] flex items-center justify-center shrink-0">
          <FlaskConical size={14} className="text-purple-700" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg md:text-xl mb-1">A/B · Pricing Label</h3>
          <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
            <code className="text-purple-700">"From $23"</code> vs{" "}
            <code className="text-purple-700">"$23 – $32"</code> headline framing on shop cards.
            First-party click tally only — full impressions in GA4 & Bing UET.
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-1 font-mono text-[9px] uppercase tracking-[0.22em] border ${
                days === d
                  ? "border-purple-400 text-purple-700 bg-purple-500/5"
                  : "border-line text-ink-muted hover:border-ink-muted"
              }`}
              data-testid={`ab-window-${d}`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={() => load(days)}
            disabled={loading}
            className="px-2 py-1 border border-line hover:border-ink-muted text-ink-muted hover:text-ink font-mono text-[9px] uppercase tracking-[0.22em] inline-flex items-center gap-1 disabled:opacity-40"
            data-testid="ab-refresh"
          >
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3" data-testid="ab-variants">
        <Variant
          label="From $X"
          accent="emerald"
          clicks={from.clicks || 0}
          uniqueVisitors={from.unique_visitors || 0}
          uniqueListings={from.unique_listings || 0}
          totalClicks={totalClicks}
        />
        <Variant
          label="$X – $Y"
          accent="amber"
          clicks={range.clicks || 0}
          uniqueVisitors={range.unique_visitors || 0}
          uniqueListings={range.unique_listings || 0}
          totalClicks={totalClicks}
        />
      </div>

      {totalClicks === 0 && (
        <p className="font-mono text-[10px] text-ink-muted" data-testid="ab-empty">
          No click events yet — once buyers click product cards, this'll populate.
        </p>
      )}
    </div>
  );
}

function Variant({ label, accent, clicks, uniqueVisitors, uniqueListings, totalClicks }) {
  const share = totalClicks ? Math.round((clicks / totalClicks) * 100) : 0;
  const aMap = {
    emerald: { border: "border-emerald-400/40", text: "text-emerald-700", bg: "bg-emerald-500/[0.04]" },
    amber: { border: "border-amber-400/40", text: "text-brand", bg: "bg-amber-500/[0.04]" },
  }[accent];
  return (
    <div
      className={`border ${aMap.border} ${aMap.bg} px-3 py-3`}
      data-testid={`ab-variant-${label}`}
    >
      <div className={`font-mono text-[10px] uppercase tracking-[0.22em] ${aMap.text}`}>{label}</div>
      <div className="font-display text-3xl mt-1 text-ink">{clicks}</div>
      <div className="font-mono text-[9px] text-ink-muted mt-0.5">clicks · {share}% share</div>
      <div className="border-t border-line mt-2 pt-2 grid grid-cols-2 gap-1 font-mono text-[9px] text-ink-muted">
        <div>Visitors: <span className="text-ink-muted">{uniqueVisitors}</span></div>
        <div>Listings: <span className="text-ink-muted">{uniqueListings}</span></div>
      </div>
    </div>
  );
}
