import React, { useEffect, useState } from "react";
import { fetchAdminWebAnalytics, fetchAdminSeoLandingAnalytics } from "../../lib/api";
import { SEO_LANDING_PAGES } from "../../pages/seoLandingConfig";
import { DeltaBadge } from "../Charts";
import { Stat } from "./_shared";
import { StatsSkeleton, RowsSkeleton } from "../Skeleton";

// ===================== WEB ANALYTICS (pageviews, visitors, geo, sources) =====
export default function WebAnalyticsTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminWebAnalytics()
      .then(setData)
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6" data-testid="web-analytics-loading">
        <StatsSkeleton count={4} />
        <StatsSkeleton count={3} />
        <RowsSkeleton count={4} />
      </div>
    );
  }
  if (err || !data) {
    return <p className="font-mono text-xs text-red-400" data-testid="web-analytics-error">{err || "No data."}</p>;
  }

  return (
    <div className="space-y-8" data-testid="web-analytics-tab">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
        ◆ Pageviews & Visitors — Last {data.window_days} days
      </div>

      {/* Headline numbers (with 7d-vs-prior-7d deltas) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total Page Views" value={data.total_views.toLocaleString()} testId="wa-total-views" />
        <Stat
          label={<>Unique Visitors <DeltaBadge delta={data.deltas?.visitors} testId="wa-delta-visitors" /></>}
          value={data.unique_visitors.toLocaleString()}
          testId="wa-unique-visitors"
        />
        <Stat
          label={<>7-Day Views <DeltaBadge delta={data.deltas?.views} testId="wa-delta-views" /></>}
          value={data.views_7d.toLocaleString()}
          testId="wa-views-7d"
        />
        <Stat
          label={<>Sessions <DeltaBadge delta={data.deltas?.sessions} testId="wa-delta-sessions" /></>}
          value={data.sessions.toLocaleString()}
          testId="wa-sessions"
        />
      </div>

      {/* Engagement subrow: bounce-rate, pages-per-session, bounces */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-6 border-t border-[#262626]">
        <Stat
          label="Bounce Rate"
          value={`${(data.bounce_rate_pct ?? 0).toFixed(1)}%`}
          testId="wa-bounce-rate"
        />
        <Stat
          label="Pages / Session"
          value={(data.pages_per_session ?? 0).toFixed(2)}
          testId="wa-pages-per-session"
        />
        <Stat
          label="Bounces"
          value={(data.bounces ?? 0).toLocaleString()}
          testId="wa-bounces"
        />
      </div>

      {data.total_views === 0 && (
        <div className="border border-dashed border-[#262626] p-6 text-center">
          <p className="font-mono text-xs text-[#a3a3a3]">
            No tracked pageviews yet. Browse the public site once and refresh —
            or wait for real visitors to land on the home / shop pages.
          </p>
        </div>
      )}

      {/* Top pages + Devices */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ListPanel title="Top Pages" rows={data.top_pages} testId="wa-top-pages"
                   format={(r) => r.key}
                   secondary={(r) => r.avg_dwell_s !== undefined && r.avg_dwell_s > 0
                     ? `${r.count.toLocaleString()} · ${formatDwell(r.avg_dwell_s)}`
                     : r.count.toLocaleString()}
                   emptyHint="No pageviews yet." />
        <ListPanel title="Device Types" rows={data.devices} testId="wa-devices"
                   format={(r) => r.key.charAt(0).toUpperCase() + r.key.slice(1)}
                   showBar emptyHint="No device data yet." />
      </div>

      {/* Countries + Cities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ListPanel title="Top Countries" rows={data.top_countries} testId="wa-top-countries"
                   format={(r) => r.key} emptyHint="No geo data yet." />
        <ListPanel title="Top Cities" rows={data.top_cities} testId="wa-top-cities"
                   format={(r) => r.key} emptyHint="No geo data yet." />
      </div>

      {/* Traffic sources */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ListPanel title="Traffic Sources" rows={data.traffic_sources} testId="wa-traffic-sources"
                   format={(r) => r.key.charAt(0).toUpperCase() + r.key.slice(1)}
                   showBar emptyHint="No traffic yet." />
        <ListPanel title="Top Referrers" rows={data.top_referrers} testId="wa-top-referrers"
                   format={(r) => r.key} emptyHint="Direct traffic only so far." />
      </div>

      {/* SEO landing-page performance */}
      <SeoLandingPanel />

      {/* Privacy footer */}
      <p className="font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em] pt-4 border-t border-[#262626]">
        Privacy · IPs anonymized at ingest (last octet truncated, IPv6 → /48). Geo lookups cached. Bots filtered by UA.
      </p>
    </div>
  );
}

function formatDwell(s) {
  if (!s || s <= 0) return "";
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r === 0 ? `${m}m` : `${m}m${r}s`;
}

function ListPanel({ title, rows, format, secondary, testId, showBar, emptyHint }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count || 0), 0) || 1;
  return (
    <div className="border border-[#262626] p-6" data-testid={testId}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-4">
        ◆ {title}
      </div>
      {rows.length === 0 ? (
        <p className="font-mono text-xs text-[#525252]" data-testid={`${testId}-empty`}>
          {emptyHint}
        </p>
      ) : (
        <ul className="divide-y divide-[#262626]">
          {rows.map((r, i) => (
            <li key={`${r.key}-${i}`} className="py-2"
                data-testid={`${testId}-row-${i}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-[#e5e5e5] truncate">
                  {format ? format(r) : r.key}
                </span>
                <span className="font-mono text-[10px] text-[#a3a3a3]">
                  {secondary ? secondary(r) : r.count.toLocaleString()}
                </span>
              </div>
              {showBar && (
                <div className="mt-1 h-1 bg-[#1a1a1a]">
                  <div
                    className="h-full bg-[#ff4500]"
                    style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


// ============================================================================
// SEO landing-page performance — one row per buyer-intent SEO page,
// shows how each is converting organic + referral traffic. The slug→keyword
// label map comes straight from the same config the pages render from, so
// new SEO pages added there automatically show up here once they collect
// pageviews.
// ============================================================================
function SeoLandingPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    setErr("");
    fetchAdminSeoLandingAnalytics(days)
      .then(setData)
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load."))
      .finally(() => setLoading(false));
  }, [days]);

  const totals = data?.totals;
  const pages = data?.pages || [];
  const ranked = pages.filter((p) => p.views > 0);
  const dormant = pages.filter((p) => p.views === 0);

  return (
    <div className="pt-8 border-t border-[#262626]" data-testid="seo-landing-panel">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
          ◆ SEO Landing-Page Performance — Last {days} days
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-1 border ${
                days === d
                  ? "border-[#ff4500] text-[#ff4500]"
                  : "border-[#262626] text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
              data-testid={`seo-landing-window-${d}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="font-mono text-xs text-[#a3a3a3]" data-testid="seo-landing-loading">
          Loading SEO landing-page analytics…
        </p>
      )}
      {err && (
        <p className="font-mono text-xs text-red-400" data-testid="seo-landing-error">{err}</p>
      )}

      {!loading && !err && totals && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat
              label="Pages Tracked"
              value={totals.pages.toLocaleString()}
              testId="seo-landing-pages-tracked"
            />
            <Stat
              label="SEO Views"
              value={totals.total_views.toLocaleString()}
              testId="seo-landing-total-views"
            />
            <Stat
              label="Visitors"
              value={totals.total_visitors.toLocaleString()}
              testId="seo-landing-total-visitors"
            />
            <Stat
              label="Sessions"
              value={totals.total_sessions.toLocaleString()}
              testId="seo-landing-total-sessions"
            />
          </div>

          {ranked.length === 0 ? (
            <div className="border border-dashed border-[#262626] p-6 text-center">
              <p className="font-mono text-xs text-[#a3a3a3]">
                No SEO landing-page traffic in the last {days} days. As Google indexes the new
                pages and organic visitors arrive, rows will populate here.
              </p>
            </div>
          ) : (
            <div className="border border-[#262626] overflow-x-auto" data-testid="seo-landing-table">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.22em] text-[#525252] border-b border-[#262626]">
                    <th className="text-left py-2 px-3">Keyword / Page</th>
                    <th className="text-right py-2 px-3">Views</th>
                    <th className="text-right py-2 px-3">Visitors</th>
                    <th className="text-right py-2 px-3">Sessions</th>
                    <th className="text-right py-2 px-3">Avg Dwell</th>
                    <th className="text-left py-2 px-3">Top Referrer</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((p, i) => {
                    const cfg = SEO_LANDING_PAGES[p.slug];
                    return (
                      <tr
                        key={p.slug}
                        className="border-b border-[#1a1a1a] hover:bg-[#0f0f0f]"
                        data-testid={`seo-landing-row-${p.slug}`}
                      >
                        <td className="py-2 px-3">
                          <a
                            href={p.path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#e5e5e5] hover:text-[#ff4500] truncate inline-block max-w-[260px] align-middle"
                            title={p.path}
                          >
                            {cfg?.keyword || p.slug}
                          </a>
                          <div className="text-[10px] text-[#525252] truncate">{p.path}</div>
                        </td>
                        <td className="py-2 px-3 text-right text-[#e5e5e5]">
                          {p.views.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right text-[#a3a3a3]">
                          {p.unique_visitors.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right text-[#a3a3a3]">
                          {p.sessions.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right text-[#a3a3a3]">
                          {formatDwell(p.avg_dwell_s)}
                        </td>
                        <td className="py-2 px-3 text-[#a3a3a3]">
                          {p.top_referrer === "—" ? (
                            <span className="text-[#525252]">direct</span>
                          ) : (
                            <span>
                              {p.top_referrer}{" "}
                              <span className="text-[#525252]">
                                ({p.top_referrer_count})
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {dormant.length > 0 && (
            <details className="mt-4" data-testid="seo-landing-dormant">
              <summary className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] cursor-pointer hover:text-[#e5e5e5]">
                {dormant.length} page{dormant.length === 1 ? "" : "s"} with zero traffic ▾
              </summary>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {dormant.map((p) => {
                  const cfg = SEO_LANDING_PAGES[p.slug];
                  return (
                    <a
                      key={p.slug}
                      href={p.path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[11px] text-[#525252] hover:text-[#a3a3a3] truncate"
                      data-testid={`seo-landing-dormant-${p.slug}`}
                    >
                      · {cfg?.keyword || p.slug}
                    </a>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
