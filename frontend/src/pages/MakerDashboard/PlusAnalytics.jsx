import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, TrendingUp, Users, Target, Globe, Lock } from "lucide-react";
import { fetchMakerPlusAnalytics } from "../../lib/api";

/**
 * Crafters Plus advanced analytics panel. Lives inside StatsTab and is
 * gated server-side — non-Plus makers get a 403 with code `plus_required`,
 * which we surface as a polished upsell card.
 *
 * Four cards:
 *   1. Conversion rate (paid orders / unique sessions, last 30d)
 *   2. Repeat-buyer % (buyers with ≥2 orders, all-time)
 *   3. Revenue trend sparkline (30d, with 90d available via toggle)
 *   4. Traffic source breakdown (last 30d)
 *
 * The sparkline is a pure-SVG inline render — no chart library to keep
 * the bundle small. The grid + sparkline match the existing
 * industrial-dark aesthetic used elsewhere in the dashboard.
 */
export default function PlusAnalytics() {
  const [data, setData] = useState(null);
  const [locked, setLocked] = useState(false);
  const [err, setErr] = useState("");
  const [window, setWindow] = useState("30d"); // "30d" | "90d"

  useEffect(() => {
    fetchMakerPlusAnalytics()
      .then(setData)
      .catch((e) => {
        const code = e?.response?.data?.detail?.code;
        if (e?.response?.status === 403 && code === "plus_required") {
          setLocked(true);
        } else {
          setErr(e?.response?.data?.detail || "Failed to load Plus analytics.");
        }
      });
  }, []);

  if (locked) return <PlusLockedCard />;
  if (err) {
    return (
      <p className="font-mono text-sm text-red-400" data-testid="plus-analytics-error">
        {err}
      </p>
    );
  }
  if (!data) {
    return (
      <div
        className="border border-line bg-paper p-5 font-mono text-xs text-ink-muted"
        data-testid="plus-analytics-loading"
      >
        Loading Plus analytics…
      </div>
    );
  }

  const series = window === "30d" ? data.revenue_trend.series_30d : data.revenue_trend.series_90d;
  const totalTraffic = data.traffic_sources.reduce((s, r) => s + r.count, 0);

  return (
    <section className="space-y-5" data-testid="plus-analytics-section">
      <header className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-line">
        <div className="flex items-center gap-3">
          <Sparkles size={18} className="text-brand" />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
              ◆ Crafters Plus · advanced analytics
            </div>
            <h3 className="font-display text-2xl uppercase mt-1">Deep stats.</h3>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em]">
          {["30d", "90d"].map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-3 py-1.5 border transition ${
                window === w
                  ? "border-brand text-brand bg-brand/10"
                  : "border-line text-ink-muted hover:border-ink-muted"
              }`}
              data-testid={`plus-analytics-window-${w}`}
            >
              {w}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          icon={<Target size={16} />}
          label="Conversion rate · 30d"
          value={`${data.conversion.rate_pct.toFixed(2)}%`}
          sub={`${data.conversion.paid_orders_30d} sales · ${data.conversion.unique_sessions_30d.toLocaleString()} sessions`}
          testid="plus-metric-conversion"
        />
        <MetricCard
          icon={<Users size={16} />}
          label="Repeat-buyer rate · all-time"
          value={`${data.repeat_buyer.pct.toFixed(1)}%`}
          sub={`${data.repeat_buyer.repeat_buyers} of ${data.repeat_buyer.total_buyers} buyers came back`}
          testid="plus-metric-repeat"
        />
        <MetricCard
          icon={<TrendingUp size={16} />}
          label={`Revenue · last ${window}`}
          value={`$${series
            .reduce((s, p) => s + p.revenue, 0)
            .toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          sub="net of all-time fees"
          testid="plus-metric-revenue"
        />
      </div>

      {/* Revenue sparkline */}
      <div className="border border-line bg-paper p-5" data-testid="plus-revenue-sparkline">
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            ◆ Revenue trend · {window === "30d" ? "30 days" : "90 days"}
          </div>
          {series.length > 0 && (
            <div className="font-mono text-[10px] text-ink-muted">
              {series[0].date} → {series[series.length - 1].date}
            </div>
          )}
        </div>
        <Sparkline series={series} />
      </div>

      {/* Traffic sources */}
      <div className="border border-line bg-paper p-5" data-testid="plus-traffic-sources">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-4">
          <Globe size={12} /> ◆ Traffic source breakdown · 30 days
        </div>
        {data.traffic_sources.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted">
            No visits to your listing pages in the last 30 days yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.traffic_sources.map((row) => {
              const pct = totalTraffic > 0 ? (row.count / totalTraffic) * 100 : 0;
              return (
                <li key={row.medium} className="font-mono text-xs" data-testid={`plus-traffic-row-${row.medium}`}>
                  <div className="flex justify-between text-ink mb-1">
                    <span className="uppercase tracking-wider">{row.medium}</span>
                    <span>
                      <span className="text-brand">{row.count.toLocaleString()}</span>
                      <span className="text-ink-muted ml-2">{pct.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface">
                    <div
                      className="h-full bg-brand"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function MetricCard({ icon, label, value, sub, testid }) {
  return (
    <div className="border border-line bg-paper p-5" data-testid={testid}>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
        <span className="text-brand">{icon}</span>
        {label}
      </div>
      <div className="font-display text-3xl md:text-4xl text-ink">{value}</div>
      {sub && <div className="font-mono text-[10px] text-ink-muted mt-2">{sub}</div>}
    </div>
  );
}

/** Minimal pure-SVG sparkline. No deps. */
function Sparkline({ series }) {
  if (!series || series.length === 0) {
    return (
      <p className="font-mono text-xs text-ink-muted py-8 text-center">
        No revenue yet in this window.
      </p>
    );
  }
  const w = 720;
  const h = 120;
  const padX = 4;
  const padY = 8;
  const max = Math.max(1, ...series.map((p) => p.revenue));
  const stepX = (w - padX * 2) / Math.max(1, series.length - 1);
  const points = series.map((p, i) => {
    const x = padX + i * stepX;
    const y = h - padY - (p.revenue / max) * (h - padY * 2);
    return [x, y];
  });
  const path = points
    .map(([x, y], i) => (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`))
    .join(" ");
  const fill = `${path} L${(padX + (series.length - 1) * stepX).toFixed(1)},${h - padY} L${padX},${h - padY} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="120" preserveAspectRatio="none">
      <path d={fill} fill="rgba(255,69,0,0.15)" />
      <path d={path} stroke="#ff4500" strokeWidth="1.5" fill="none" />
      {/* baseline */}
      <line x1={padX} x2={w - padX} y1={h - padY} y2={h - padY} stroke="#1f1f1f" strokeWidth="1" />
    </svg>
  );
}

function PlusLockedCard() {
  return (
    <section
      className="border-2 border-dashed border-brand/40 bg-brand/5 p-6 md:p-8 text-center"
      data-testid="plus-analytics-locked"
    >
      <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
        <Lock size={12} /> Plus subscribers only
      </div>
      <h3 className="font-display text-2xl md:text-3xl uppercase mb-2">
        Advanced analytics.
      </h3>
      <p className="font-mono text-xs text-ink-muted mb-5 max-w-md mx-auto leading-relaxed">
        Conversion rate, repeat-buyer share, revenue trends, and a traffic
        source breakdown — surfaced only on the Plus plan so you can
        course-correct in real time.
      </p>
      <Link
        to="/maker/billing"
        className="btn-industrial btn-primary inline-block"
        data-testid="plus-analytics-upgrade-cta"
      >
        Start 3-month free trial →
      </Link>
    </section>
  );
}
