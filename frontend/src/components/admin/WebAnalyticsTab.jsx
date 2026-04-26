import React, { useEffect, useState } from "react";
import { fetchAdminWebAnalytics } from "../../lib/api";
import { DeltaBadge } from "../Charts";
import { Stat } from "./_shared";

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
    return <p className="font-mono text-xs text-[#a3a3a3]" data-testid="web-analytics-loading">Loading…</p>;
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
