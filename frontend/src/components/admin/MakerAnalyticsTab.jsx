import React, { useEffect, useState } from "react";
import { fetchMakers, fetchAdminMakerAnalytics } from "../../lib/api";
import { Sparkline } from "../Charts";
import { Stat } from "./_shared";

// ===================== MAKER ANALYTICS (per-maker drill-in) =====================
export default function MakerAnalyticsTab() {
  const [makers, setMakers] = useState([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetchMakers().then((m) => {
      setMakers(m);
      if (m.length && !selectedSlug) setSelectedSlug(m[0].slug);
    }).catch(() => setMakers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    setLoading(true); setErr("");
    fetchAdminMakerAnalytics(selectedSlug)
      .then(setData)
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load."))
      .finally(() => setLoading(false));
  }, [selectedSlug]);

  return (
    <div className="space-y-8" data-testid="maker-analytics-tab">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mr-2">
          ◆ Maker:
        </span>
        <select
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
          data-testid="maker-analytics-select"
        >
          {makers.map((m) => (
            <option key={m.slug} value={m.slug} className="bg-[#0a0a0a]">
              {m.name} · {m.slug}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="font-mono text-xs text-[#a3a3a3]">Loading…</p>}
      {err && <p className="font-mono text-xs text-red-400">{err}</p>}

      {data && !loading && (
        <>
          {/* Header */}
          <div className="border border-[#262626] p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
              ◆ {data.maker.slug}
            </div>
            <h3 className="font-display text-3xl mt-2 uppercase">{data.maker.name}.</h3>
            <p className="font-mono text-xs text-[#a3a3a3] mt-2">
              {data.maker.email || "no email on file"} · {data.maker.location || "—"}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 items-center">
              <span className={`font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border ${
                data.maker.stripe_payouts_enabled
                  ? "border-emerald-400 text-emerald-400"
                  : data.maker.stripe_account_id
                    ? "border-yellow-400 text-yellow-400"
                    : "border-[#525252] text-[#525252]"
              }`} data-testid="maker-an-stripe-status">
                {data.maker.stripe_payouts_enabled
                  ? "Stripe payouts active"
                  : data.maker.stripe_account_id
                    ? "Stripe onboarding incomplete"
                    : "No Stripe account"}
              </span>
              {data.maker.stripe_account_id && (
                <span className="font-mono text-[10px] text-[#525252]">
                  {data.maker.stripe_account_id}
                </span>
              )}
            </div>
          </div>

          {/* Revenue stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Gross Revenue" value={`$${data.gross_revenue.toFixed(0)}`} testId="man-gross" />
            <Stat label="Last 30d" value={`$${data.gross_revenue_30d.toFixed(0)}`} testId="man-30d" />
            <Stat label="Last 7d" value={`$${data.gross_revenue_7d.toFixed(0)}`} testId="man-7d" />
            <Stat label="Paid Orders" value={data.paid_orders_count} testId="man-orders" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-6 border-t border-[#262626]">
            <Stat label="Maker Share" value={`$${data.maker_share_gross.toFixed(0)}`} testId="man-share" />
            <Stat label="After Refunds" value={`$${data.maker_share_after_refunds.toFixed(0)}`} testId="man-share-net" />
            <Stat label="Refunded" value={`$${data.refunded_amount.toFixed(0)}`} testId="man-refunded" />
            <Stat label="Listings" value={data.products_count} testId="man-listings" />
          </div>

          {/* Weekly GMV mini-chart */}
          {data.weekly_gmv && (
            <Sparkline data={data.weekly_gmv} label={data.maker.name} testId="man-weekly-gmv" />
          )}

          {/* Top products */}
          <div className="border border-[#262626] p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-4">
              ◆ Top Products
            </div>
            {data.top_products.length === 0 ? (
              <p className="font-mono text-xs text-[#525252]">No paid orders for this maker yet.</p>
            ) : (
              <ul className="divide-y divide-[#262626]" data-testid="man-top-products">
                {data.top_products.map((p) => (
                  <li key={p.slug} className="py-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-[#e5e5e5] truncate">{p.title}</span>
                    <span className="font-mono text-[10px] text-[#a3a3a3]">
                      × {p.units} · ${p.revenue.toFixed(0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Payouts summary + recent */}
          <div className="border border-[#262626] p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-4">
              ◆ Payouts
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6" data-testid="man-payout-totals">
              <Stat label="Succeeded" value={`$${data.payout_totals.succeeded.toFixed(0)}`} testId="man-payout-succeeded" />
              <Stat label="Deferred" value={`$${data.payout_totals.deferred.toFixed(0)}`} testId="man-payout-deferred" />
              <Stat label="Reversed" value={`$${data.payout_totals.reversed.toFixed(0)}`} testId="man-payout-reversed" />
              <Stat label="Errored" value={`$${data.payout_totals.error.toFixed(0)}`} testId="man-payout-error" />
              <Stat label="Cancelled" value={`$${data.payout_totals.cancelled.toFixed(0)}`} testId="man-payout-cancelled" />
            </div>
            {data.recent_payouts.length === 0 ? (
              <p className="font-mono text-xs text-[#525252]" data-testid="man-recent-payouts-empty">
                No payouts yet.
              </p>
            ) : (
              <ul className="divide-y divide-[#262626]" data-testid="man-recent-payouts">
                {data.recent_payouts.map((p) => (
                  <li
                    key={`${p.session_id}-${p.maker_slug}`}
                    className="py-2 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-[#e5e5e5] truncate">
                        {p.session_id}
                      </div>
                      <div className="font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.18em]">
                        {p.status}{p.reason ? ` · ${p.reason}` : ""}
                      </div>
                    </div>
                    <div className="font-display text-lg text-[#e5e5e5]">
                      ${(Number(p.amount_cents || 0) / 100).toFixed(2)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

