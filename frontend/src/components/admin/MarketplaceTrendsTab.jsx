/**
 * iter452 — Admin → Marketplace Trends. Anonymous, aggregated storefront
 * intelligence across all makers: search demand, section momentum,
 * conversion leaders and trending categories.
 */
import React, { useEffect, useState } from "react";
import { fetchMarketplaceTrends } from "../../lib/api";

const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
})();

const Card = ({ title, children, testId }) => (
  <div className="border border-line bg-paper p-4" data-testid={testId}>
    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-brand mb-3">◆ {title}</div>
    {children}
  </div>
);

const Empty = () => <p className="font-mono text-[11px] text-ink-muted">No data in this period.</p>;

export default function MarketplaceTrendsTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setData(null); setErr(null);
    fetchMarketplaceTrends({ days, tz: TZ })
      .then(setData)
      .catch(() => setErr("Could not load marketplace trends."));
  }, [days]);

  const growth = (g) => g === null ? "(new)" : `(${g > 0 ? "+" : ""}${g}%)`;

  return (
    <div className="space-y-6" data-testid="marketplace-trends-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Marketplace Trends</h2>
          {data?.range && (
            <p className="font-mono text-[10px] text-ink-muted mt-1">
              {data.range.start} → {data.range.end} · vs previous {data.range.days} days
            </p>
          )}
        </div>
        <div className="flex border border-line">
          {[7, 30, 90].map((n) => (
            <button key={n} onClick={() => setDays(n)}
                    className={`px-4 py-2 font-mono text-xs transition ${
                      days === n ? "bg-brand text-paper" : "text-ink hover:text-brand"}`}
                    data-testid={`trends-range-${n}`}>
              {n}d
            </button>
          ))}
        </div>
      </div>

      {err && <p className="font-mono text-xs text-red-400">{err}</p>}
      {!data && !err && <p className="font-mono text-xs text-ink-muted">Loading trends…</p>}

      {data && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Most searched terms (in-store search)" testId="trends-top-terms">
            {data.top_search_terms.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {data.top_search_terms.map((t, i) => (
                  <li key={t.q} className="font-mono text-[11px] text-ink">
                    {i + 1}. {t.q} · {t.count}× (avg {t.avg_results} results)
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Empty searches marketplace-wide" testId="trends-empty-searches">
            {data.empty_searches.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {data.empty_searches.map((t) => (
                  <li key={t.q} className="font-mono text-[11px] text-amber-400">
                    {t.q} · {t.count}× with zero results
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Fastest growing store sections" testId="trends-growing-sections">
            {data.fastest_growing_sections.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {data.fastest_growing_sections.map((s, i) => (
                  <li key={`${s.maker_slug}-${s.section}-${i}`} className="font-mono text-[11px] text-ink">
                    {s.section} <span className="text-ink-muted">@ {s.maker_slug}</span> · {s.views} views {growth(s.growth_pct)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Highest converting store sections (cart-add rate)" testId="trends-converting-sections">
            {data.highest_converting_sections.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {data.highest_converting_sections.map((s, i) => (
                  <li key={`${s.maker_slug}-${s.section}-${i}`} className="font-mono text-[11px] text-ink">
                    {s.section} <span className="text-ink-muted">@ {s.maker_slug}</span> · {s.atc_rate}% ({s.add_to_cart}/{s.views})
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Trending product categories" testId="trends-categories">
            {data.trending_categories.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {data.trending_categories.map((c) => (
                  <li key={c.category} className="font-mono text-[11px] text-ink">
                    {c.category} · {c.clicks} clicks {growth(c.growth_pct)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
