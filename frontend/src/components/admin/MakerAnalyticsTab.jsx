import React, { useEffect, useState } from "react";
import { fetchMakers, fetchAdminMakerAnalytics } from "../../lib/api";
import { Sparkline } from "../Charts";
import { Stat } from "./_shared";
import { StatsSkeleton, RowsSkeleton } from "../Skeleton";

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
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mr-2">
          ◆ Maker:
        </span>
        <select
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
          data-testid="maker-analytics-select"
        >
          {makers.map((m) => (
            <option key={m.slug} value={m.slug} className="bg-paper">
              {m.name} · {m.slug}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="space-y-6" data-testid="maker-analytics-loading">
          <StatsSkeleton count={4} />
          <RowsSkeleton count={4} />
        </div>
      )}
      {err && <p className="font-mono text-xs text-red-400">{err}</p>}

      {data && !loading && (
        <>
          {/* Header */}
          <div className="border border-line p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
              ◆ {data.maker.slug}
            </div>
            <h3 className="font-display text-3xl mt-2 uppercase">{data.maker.name}.</h3>
            <p className="font-mono text-xs text-ink-muted mt-2">
              {data.maker.email || "no email on file"} · {data.maker.location || "—"}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 items-center">
              <span className={`font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border ${
                data.maker.stripe_payouts_enabled
                  ? "border-emerald-400 text-emerald-700"
                  : data.maker.stripe_account_id
                    ? "border-yellow-400 text-brand"
                    : "border-line text-ink-muted"
              }`} data-testid="maker-an-stripe-status">
                {data.maker.stripe_payouts_enabled
                  ? "Stripe payouts active"
                  : data.maker.stripe_account_id
                    ? "Stripe onboarding incomplete"
                    : "No Stripe account"}
              </span>
              {data.maker.stripe_account_id && (
                <span className="font-mono text-[10px] text-ink-muted">
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-6 border-t border-line">
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
          <div className="border border-line p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-4">
              ◆ Top Products
            </div>
            {data.top_products.length === 0 ? (
              <div
                className="bg-paper border border-line p-4 text-center"
                data-testid="man-top-products-empty"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mb-1">◇ Nothing yet</div>
                <p className="font-mono text-[11px] text-ink-muted">
                  Once paid orders land for this maker, their best-selling listings will rank here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line" data-testid="man-top-products">
                {data.top_products.map((p) => (
                  <li key={p.slug} className="py-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-ink truncate">{p.title}</span>
                    <span className="font-mono text-[10px] text-ink-muted">
                      × {p.units} · ${p.revenue.toFixed(0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Payouts summary + recent */}
          <div className="border border-line p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-4">
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
              <p className="font-mono text-xs text-ink-muted" data-testid="man-recent-payouts-empty">
                No payouts yet.
              </p>
            ) : (
              <ul className="divide-y divide-line" data-testid="man-recent-payouts">
                {data.recent_payouts.map((p) => (
                  <li
                    key={`${p.session_id}-${p.maker_slug}`}
                    className="py-2 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-ink truncate">
                        {p.session_id}
                      </div>
                      <div className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.18em]">
                        {p.status}{p.reason ? ` · ${p.reason}` : ""}
                      </div>
                    </div>
                    <div className="font-display text-lg text-ink">
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

