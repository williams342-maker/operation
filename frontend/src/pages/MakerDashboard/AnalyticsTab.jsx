/**
 * iter452 — Maker Dashboard → Analytics (Phase 3).
 * Store overview (vs previous period), per-section performance, product
 * performance lists, Customer Search Insights, and rule-based
 * recommendations with an AI-phrased weekly summary.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, Minus, Sparkles, Search as SearchIcon,
  Folder, AlertTriangle, RefreshCw,
} from "lucide-react";
import { fetchStoreAnalytics } from "../../lib/api";

const RANGE_KEY = "cm_analytics_range";
const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
})();

const fmtMoney = (v) => `$${Number(v || 0).toFixed(2)}`;
const fmtNum = (v) => Number(v || 0).toLocaleString();

const Delta = ({ v }) => {
  if (v === null || v === undefined) return <span className="text-ink-muted text-[10px] font-mono">—</span>;
  const up = v > 0, flat = v === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10px] ${
      flat ? "text-ink-muted" : up ? "text-green-500" : "text-red-400"}`}>
      <Icon size={11} />{up ? "+" : ""}{v}%
    </span>
  );
};

const StatCard = ({ label, value, delta, testId }) => (
  <div className="border border-line bg-paper p-4" data-testid={testId}>
    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mb-2">{label}</div>
    <div className="flex items-end justify-between gap-2">
      <span className="font-mono text-xl text-ink">{value}</span>
      <Delta v={delta} />
    </div>
  </div>
);

const SectionHead = ({ children }) => (
  <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">◆ {children}</h3>
);

const PRIORITY_STYLE = {
  high: "border-red-400/50 text-red-400",
  medium: "border-amber-400/50 text-amber-400",
  low: "border-line text-ink-muted",
};

export default function AnalyticsTab() {
  const [days, setDays] = useState(() => {
    const v = Number(localStorage.getItem(RANGE_KEY));
    return [7, 30, 90].includes(v) ? v : 30;
  });
  const [overview, setOverview] = useState(null);
  const [sections, setSections] = useState(null);
  const [products, setProducts] = useState(null);
  const [search, setSearch] = useState(null);
  const [recos, setRecos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [perfList, setPerfList] = useState("most_viewed");

  useEffect(() => {
    localStorage.setItem(RANGE_KEY, String(days));
    let cancelled = false;
    setLoading(true);
    const params = { days, tz: TZ };
    Promise.all([
      fetchStoreAnalytics("overview", params),
      fetchStoreAnalytics("sections", params),
      fetchStoreAnalytics("products", params),
      fetchStoreAnalytics("search-insights", params),
    ]).then(([o, s, p, si]) => {
      if (cancelled) return;
      setOverview(o); setSections(s); setProducts(p); setSearch(si);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setLoading(false); toast.error("Could not load analytics."); } });
    // recommendations may take a few seconds (AI summary) — load separately
    setRecos(null);
    fetchStoreAnalytics("recommendations", params)
      .then((r) => { if (!cancelled) setRecos(r); })
      .catch(() => { if (!cancelled) setRecos({ recommendations: [], ai_summary: null }); });
    return () => { cancelled = true; };
  }, [days]);

  const cur = overview?.current || {};
  const d = overview?.deltas || {};
  const range = overview?.range;

  const PERF_LISTS = useMemo(() => ([
    ["most_viewed", "Most Viewed"], ["most_purchased", "Most Purchased"],
    ["highest_revenue", "Highest Revenue"], ["highest_conversion", "Highest Conversion"],
    ["lowest_conversion", "Lowest Conversion"], ["no_views_30d", "No Views · 30d"],
    ["no_sales_60d", "No Sales · 60d"],
  ]), []);

  return (
    <div className="space-y-10" data-testid="analytics-tab">
      {/* Range selector + analyzed window */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Store Analytics</h2>
          {range && (
            <p className="font-mono text-[10px] text-ink-muted mt-1" data-testid="analytics-range-label">
              {range.start} → {range.end} · compared to the previous {range.days} days · {range.tz}
            </p>
          )}
        </div>
        <div className="flex border border-line" data-testid="analytics-range-selector">
          {[7, 30, 90].map((n) => (
            <button key={n} onClick={() => setDays(n)}
                    className={`px-4 py-2 font-mono text-xs transition ${
                      days === n ? "bg-brand text-paper" : "text-ink hover:text-brand"}`}
                    data-testid={`analytics-range-${n}`}>
              {n}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="font-mono text-xs text-ink-muted py-16 text-center" data-testid="analytics-loading">
          ◆ Crunching the numbers…
        </div>
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="analytics-overview-cards">
            <StatCard label="Store Views" value={fmtNum(cur.store_views)} delta={d.store_views} testId="stat-store-views" />
            <StatCard label="Unique Visitors" value={fmtNum(cur.unique_visitors)} delta={d.unique_visitors} testId="stat-unique-visitors" />
            <StatCard label="Product Views" value={fmtNum(cur.product_views)} delta={d.product_views} testId="stat-product-views" />
            <StatCard label="Searches" value={fmtNum(cur.searches)} delta={d.searches} testId="stat-searches" />
            <StatCard label="Search → Click" value={`${cur.search_to_click_rate ?? 0}%`} delta={d.search_to_click_rate} testId="stat-search-click" />
            <StatCard label="Add to Cart" value={fmtNum(cur.add_to_cart)} delta={d.add_to_cart} testId="stat-add-to-cart" />
            <StatCard label="Orders" value={fmtNum(cur.orders)} delta={d.orders} testId="stat-orders" />
            <StatCard label="Revenue" value={fmtMoney(cur.revenue)} delta={d.revenue} testId="stat-revenue" />
            <StatCard label="Conversion Rate" value={`${cur.conversion_rate ?? 0}%`} delta={d.conversion_rate} testId="stat-conversion" />
            <StatCard label="Avg Order Value" value={fmtMoney(cur.avg_order_value)} delta={d.avg_order_value} testId="stat-aov" />
          </div>

          {/* Recommendations */}
          <div className="border border-line bg-paper p-5" data-testid="analytics-recommendations">
            <div className="flex items-center justify-between mb-3">
              <SectionHead>Recommendations</SectionHead>
              <Sparkles size={14} className="text-brand" />
            </div>
            {!recos ? (
              <p className="font-mono text-xs text-ink-muted" data-testid="recommendations-loading">
                Generating recommendations…
              </p>
            ) : (
              <>
                {recos.ai_summary && (
                  <div className="border border-brand/30 bg-brand/[0.04] p-4 mb-4" data-testid="ai-summary">
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-brand mb-2">
                      This week's focus
                    </div>
                    <p className="text-sm text-ink leading-relaxed">{recos.ai_summary}</p>
                  </div>
                )}
                {recos.recommendations?.length === 0 ? (
                  <p className="font-mono text-xs text-ink-muted">
                    No recommendations yet — they appear as your store collects views, searches and sales.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {recos.recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-3 border border-line/60 px-3 py-2.5"
                          data-testid={`recommendation-${rec.type}-${i}`}>
                        <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] shrink-0 mt-0.5 ${PRIORITY_STYLE[rec.priority]}`}>
                          {rec.priority}
                        </span>
                        <span className="text-sm text-ink flex-1">{rec.message}</span>
                        <span className="font-mono text-[9px] text-ink-muted shrink-0 mt-1">{rec.confidence}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Section analytics */}
          <div data-testid="analytics-sections">
            <SectionHead>Section performance</SectionHead>
            {(sections?.sections || []).length === 0 ? (
              <p className="font-mono text-xs text-ink-muted border border-dashed border-line p-6">
                No sections yet — create Store Sections or enable Smart Sections to see per-section performance.
              </p>
            ) : (
              <div className="overflow-x-auto border border-line">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line">
                      {["Section", "Views", "Clicks", "Carts", "Orders", "Revenue", "Conv.", "Avg Browse", "Top Product"].map((h) => (
                        <th key={h} className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {sections.sections.map((s) => (
                      <tr key={s.slug} data-testid={`section-row-${s.slug}`}>
                        <td className="px-3 py-2 font-mono text-xs text-ink whitespace-nowrap">
                          {s.smart && <span className="text-brand/70 mr-1" title="Smart section">✦</span>}
                          {s.name}
                          <span className="text-ink-muted ml-1">({s.products})</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-ink">{fmtNum(s.views)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink">{fmtNum(s.product_clicks)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink">{fmtNum(s.add_to_cart)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink">{fmtNum(s.orders)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-brand">{fmtMoney(s.revenue)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink">{s.conversion_rate}%</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-muted">
                          {s.avg_dwell_seconds != null ? `${s.avg_dwell_seconds}s` : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-ink-muted max-w-[180px] truncate">
                          {s.top_products?.[0]?.title || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Product performance */}
          <div data-testid="analytics-products">
            <SectionHead>Product performance</SectionHead>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {PERF_LISTS.map(([key, label]) => (
                <button key={key} onClick={() => setPerfList(key)}
                        className={`border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition ${
                          perfList === key ? "border-brand text-brand bg-brand/[0.06]" : "border-line text-ink-muted hover:text-ink"}`}
                        data-testid={`perf-list-${key}`}>
                  {label}
                </button>
              ))}
            </div>
            {(products?.[perfList] || []).length === 0 ? (
              <p className="font-mono text-xs text-ink-muted border border-dashed border-line p-6"
                 data-testid="perf-empty">Nothing here for this period.</p>
            ) : (
              <div className="border border-line divide-y divide-line/60" data-testid="perf-rows">
                {products[perfList].map((p, i) => (
                  <div key={p.slug} className="flex items-center gap-3 px-3 py-2" data-testid={`perf-row-${p.slug}`}>
                    <span className="font-mono text-[10px] text-ink-muted w-5">{i + 1}.</span>
                    <span className="font-mono text-xs text-ink flex-1 truncate">{p.title}</span>
                    {p.views !== undefined && (
                      <span className="font-mono text-[10px] text-ink-muted whitespace-nowrap">
                        {fmtNum(p.views)} views · {fmtNum(p.purchases)} sold · {fmtMoney(p.revenue)}
                        {p.conversion_rate != null && ` · ${p.conversion_rate}%`}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Customer Search Insights */}
          <div className="border border-line bg-paper p-5" data-testid="search-insights">
            <div className="flex items-center gap-2 mb-4">
              <SearchIcon size={14} className="text-brand" />
              <SectionHead>Customer search insights</SectionHead>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <TermList title="Top search terms" testId="si-top" rows={search?.top_terms}
                        render={(t) => `${t.q} · ${t.count}× (avg ${t.avg_results} results)`} />
              <TermList title="Zero-result searches" testId="si-zero" rows={search?.zero_result_terms}
                        render={(t) => `${t.q} · ${t.count}× with no results`} warn />
              <TermList title="Trending · last 7 days" testId="si-trend7" rows={search?.trending_7d}
                        render={(t) => `${t.q} · ${t.count}× ${t.growth_pct === null ? "(new)" : `(${t.growth_pct > 0 ? "+" : ""}${t.growth_pct}%)`}`} />
              <TermList title="Trending · last 30 days" testId="si-trend30" rows={search?.trending_30d}
                        render={(t) => `${t.q} · ${t.count}× ${t.growth_pct === null ? "(new)" : `(${t.growth_pct > 0 ? "+" : ""}${t.growth_pct}%)`}`} />
              <TermList title="Searches that converted" testId="si-converted"
                        rows={(search?.converted_terms || []).map((q) => ({ q }))}
                        render={(t) => t.q} />
              <TermList title="Searched but didn't convert" testId="si-not-converted"
                        rows={(search?.not_converted_terms || []).map((q) => ({ q }))}
                        render={(t) => t.q} />
            </div>
            {(search?.recommendations || []).length > 0 && (
              <div className="mt-5 border-t border-line pt-4 space-y-2" data-testid="si-recommendations">
                {search.recommendations.map((msg, i) => (
                  <p key={i} className="flex items-start gap-2 text-sm text-ink">
                    <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />{msg}
                  </p>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const TermList = ({ title, rows, render, warn, testId }) => (
  <div data-testid={testId}>
    <div className={`font-mono text-[9px] uppercase tracking-[0.16em] mb-2 ${warn ? "text-amber-400" : "text-ink-muted"}`}>
      {title}
    </div>
    {(rows || []).length === 0 ? (
      <p className="font-mono text-[11px] text-ink-muted/70">None in this period.</p>
    ) : (
      <ul className="space-y-1">
        {rows.slice(0, 8).map((t, i) => (
          <li key={i} className="font-mono text-[11px] text-ink">{render(t)}</li>
        ))}
      </ul>
    )}
  </div>
);
