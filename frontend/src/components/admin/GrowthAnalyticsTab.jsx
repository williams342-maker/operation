/**
 * Growth Analytics — admin dashboard (iter427).
 *
 * Sections:
 *   1. Date-range control chips + custom date picker
 *   2. 8 summary cards (Visitors, Page views, Applications, Approved,
 *      New listings, Orders, Gross sales, Commission)
 *   3. Charts (Recharts): daily-trend line, applications-over-time bar,
 *      listings-over-time bar, revenue line, conversion funnel bar
 *   4. Top pages table
 *   5. Full data table with per-bucket rows + on-page CSV export buttons
 *
 * Backend contract: `/api/admin/analytics/growth` returns
 *   { range, grain, start, end, summary, rows[], top_pages[], funnel[] }.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip as RTooltip, CartesianGrid, Legend,
} from "recharts";

const API = process.env.REACT_APP_BACKEND_URL;

function _auth() {
  const t = localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
}
function _fmt(n, currency = false) {
  if (n == null) return "—";
  if (currency) return "$" + Number(n).toLocaleString(undefined, {maximumFractionDigits: 2});
  return Number(n).toLocaleString();
}

const RANGE_CHIPS = [
  { id: "today",       label: "Today",       kind: "shortcut" },
  { id: "7d",          label: "Last 7 days", kind: "shortcut" },
  { id: "30d",         label: "Last 30 days", kind: "shortcut" },
  { id: "this-month",  label: "This month",   kind: "shortcut" },
  { id: "last-month",  label: "Last month",   kind: "shortcut" },
];

function _resolveShortcut(id) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  if (id === "today") return { start: iso(today), end: iso(today), range: "daily" };
  if (id === "7d") {
    const s = new Date(today); s.setDate(s.getDate() - 6);
    return { start: iso(s), end: iso(today), range: "daily" };
  }
  if (id === "30d") {
    const s = new Date(today); s.setDate(s.getDate() - 29);
    return { start: iso(s), end: iso(today), range: "daily" };
  }
  if (id === "this-month") {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: iso(s), end: iso(today), range: "daily" };
  }
  if (id === "last-month") {
    const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: iso(s), end: iso(e), range: "daily" };
  }
  return { range: "daily" };
}

function Card({ label, value, sub, testid }) {
  return (
    <div className="border border-line p-4 min-w-0" data-testid={testid}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted truncate">{label}</div>
      <div className="font-display text-2xl md:text-3xl mt-1 tabular-nums text-ink truncate">{value}</div>
      {sub && <div className="mt-1 text-[10px] font-mono text-ink-muted truncate">{sub}</div>}
    </div>
  );
}

export default function GrowthAnalyticsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shortcut, setShortcut] = useState("30d");
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      let s, e, range;
      if (shortcut === "custom" && custom.start && custom.end) {
        s = custom.start; e = custom.end;
        params.set("start_date", s); params.set("end_date", e);
      } else if (shortcut === "weekly" || shortcut === "monthly") {
        range = shortcut; params.set("range", range);
      } else {
        const r = _resolveShortcut(shortcut);
        if (r.start && r.end) {
          params.set("start_date", r.start); params.set("end_date", r.end);
        } else {
          params.set("range", r.range || "daily");
        }
      }
      const r = await fetch(`${API}/api/admin/analytics/growth?${params.toString()}`,
                            { headers: _auth() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setData(d);
    } catch (e) { toast.error(`Load failed: ${e.message}`); }
    finally { setLoading(false); }
  }, [shortcut, custom]);

  useEffect(() => { load(); }, [load]);

  async function exportCsv(kind) {
    // kind is "daily" / "weekly" / "monthly" / "selected"
    setBusy(kind);
    try {
      const params = new URLSearchParams();
      if (kind === "selected" && data) {
        params.set("start_date", data.start.slice(0, 10));
        params.set("end_date", data.end.slice(0, 10));
      } else {
        params.set("range", kind);
      }
      const r = await fetch(`${API}/api/admin/analytics/growth/export?${params.toString()}`,
                            { headers: _auth() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `growth-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      toast.success(`Exported ${kind} CSV.`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  const rows       = data?.rows || [];
  const summary    = data?.summary || {};
  const topPages   = data?.top_pages || [];
  const funnel     = data?.funnel || [];
  const isEmpty    = rows.length === 0 || rows.every(r => (r.unique_visitors + r.page_views + r.applications + r.orders) === 0);

  return (
    <div className="space-y-6 min-w-0 overflow-x-hidden" data-testid="growth-analytics-tab">
      {/* ─────────── Header + date range chips ─────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGE_CHIPS.map(c => (
          <button
            key={c.id}
            onClick={() => { setShortcut(c.id); }}
            className={`px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] border transition
              ${shortcut === c.id ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-muted hover:border-ink-muted"}`}
            data-testid={`ga-range-${c.id}`}
          >{c.label}</button>
        ))}
        <button
          onClick={() => setShortcut("weekly")}
          className={`px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] border transition
            ${shortcut === "weekly" ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-muted hover:border-ink-muted"}`}
          data-testid="ga-range-weekly"
        >Weekly view</button>
        <button
          onClick={() => setShortcut("monthly")}
          className={`px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] border transition
            ${shortcut === "monthly" ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-muted hover:border-ink-muted"}`}
          data-testid="ga-range-monthly"
        >Monthly view</button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={custom.start}
            onChange={(e) => setCustom({ ...custom, start: e.target.value })}
            className="border border-line bg-paper px-2 py-1 font-mono text-xs"
            data-testid="ga-custom-start"
          />
          <span className="text-ink-muted text-xs">→</span>
          <input
            type="date"
            value={custom.end}
            onChange={(e) => setCustom({ ...custom, end: e.target.value })}
            className="border border-line bg-paper px-2 py-1 font-mono text-xs"
            data-testid="ga-custom-end"
          />
          <button
            onClick={() => custom.start && custom.end ? setShortcut("custom") : toast.error("Pick both dates")}
            className="border border-brand text-brand px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] hover:bg-brand/10"
            data-testid="ga-custom-apply"
          >Apply range</button>
        </div>
      </div>

      {loading && (
        <div className="border border-line p-6 text-center text-ink-muted font-mono text-xs" data-testid="ga-loading">
          Loading growth data…
        </div>
      )}

      {!loading && isEmpty && (
        <div className="border border-line p-8 text-center" data-testid="ga-empty">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">No traffic in range</div>
          <p className="text-ink-muted text-sm">
            No visitors or events recorded for the selected period.
            {" "}Wider your date range or check back once traffic accrues.
          </p>
        </div>
      )}

      {/* ─────────── Summary cards ─────────── */}
      {!loading && !isEmpty && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="ga-summary-cards">
          <Card label="Visitors" value={_fmt(summary.visitors)} sub={`${_fmt(summary.page_views)} page views`} testid="ga-card-visitors" />
          <Card label="Applications" value={_fmt(summary.applications)} sub={`${summary.conv_visitor_to_application}% of visitors`} testid="ga-card-applications" />
          <Card label="Approved makers" value={_fmt(summary.approved)} sub={`${summary.conv_application_to_approved}% approval rate`} testid="ga-card-approved" />
          <Card label="New listings" value={_fmt(summary.new_listings)} sub={`${_fmt(summary.active_listings)} active · ${_fmt(summary.draft_listings)} draft`} testid="ga-card-listings" />
          <Card label="Orders" value={_fmt(summary.orders)} sub={`${_fmt(summary.checkout_started)} checkouts started`} testid="ga-card-orders" />
          <Card label="Gross sales" value={_fmt(summary.gross_sales, true)} testid="ga-card-gross" />
          <Card label="Commission" value={_fmt(summary.commission, true)} testid="ga-card-commission" />
          <Card label="Add-to-cart" value={_fmt(summary.add_to_cart)} sub={`${summary.conv_pageview_to_cart}% of page views`} testid="ga-card-atc" />
        </div>
      )}

      {/* ─────────── Charts ─────────── */}
      {!loading && !isEmpty && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0" data-testid="ga-charts">
          <div className="border border-line p-4 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">Traffic — visitors & page views</div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line, #eee)" strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="unique_visitors" name="Visitors" stroke="#c97b3c" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="page_views" name="Page views" stroke="#7a5c46" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="border border-line p-4 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">Applications over time</div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line, #eee)" strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="applications" name="Applications" fill="#c97b3c" />
                  <Bar dataKey="approved_applications" name="Approved" fill="#4a7c4a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="border border-line p-4 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">Listings posted</div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line, #eee)" strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RTooltip />
                  <Bar dataKey="listings_posted" name="Listings" fill="#7a5c46" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="border border-line p-4 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">Revenue — orders & gross sales</div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line, #eee)" strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line yAxisId="left" type="monotone" dataKey="orders" name="Orders" stroke="#4a7c4a" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="gross_sales" name="Gross $" stroke="#c97b3c" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="border border-line p-4 min-w-0 lg:col-span-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">Conversion funnel — visitor → application → approved → listings posted</div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel} layout="vertical" margin={{ top: 8, right: 24, left: 80, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line, #eee)" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} width={140} />
                  <RTooltip />
                  <Bar dataKey="count" name="Count" fill="#c97b3c" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── Top pages ─────────── */}
      {!loading && !isEmpty && topPages.length > 0 && (
        <div className="border border-line p-4 min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
            Top pages by traffic
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono" data-testid="ga-top-pages">
              <thead>
                <tr className="text-ink-muted uppercase tracking-[0.18em] text-[10px]">
                  <th className="text-left px-2 py-2">Path</th>
                  <th className="text-right px-2 py-2">Views</th>
                  <th className="text-right px-2 py-2">Visitors</th>
                </tr>
              </thead>
              <tbody>
                {topPages.map((p, i) => (
                  <tr key={p.path + i} className="border-t border-line">
                    <td className="px-2 py-2 max-w-[400px] break-all">{p.path || "/"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(p.views)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(p.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────── Data table + CSV export ─────────── */}
      {!loading && !isEmpty && (
        <div className="border border-line p-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
              Growth table · {data?.grain}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={() => exportCsv("daily")}   disabled={busy}
                      className="border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] hover:bg-surface-2"
                      data-testid="ga-export-daily">
                {busy === "daily" ? "…" : "Export daily CSV"}
              </button>
              <button onClick={() => exportCsv("weekly")}  disabled={busy}
                      className="border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] hover:bg-surface-2"
                      data-testid="ga-export-weekly">
                {busy === "weekly" ? "…" : "Export weekly CSV"}
              </button>
              <button onClick={() => exportCsv("monthly")} disabled={busy}
                      className="border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] hover:bg-surface-2"
                      data-testid="ga-export-monthly">
                {busy === "monthly" ? "…" : "Export monthly CSV"}
              </button>
              <button onClick={() => exportCsv("selected")} disabled={busy}
                      className="border border-brand text-brand px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] hover:bg-brand/10"
                      data-testid="ga-export-selected">
                {busy === "selected" ? "…" : "Export selected range"}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono" data-testid="ga-table">
              <thead>
                <tr className="text-ink-muted uppercase tracking-[0.18em] text-[10px]">
                  <th className="text-left px-2 py-2">Date</th>
                  <th className="text-right px-2 py-2">Visitors</th>
                  <th className="text-right px-2 py-2">Views</th>
                  <th className="text-right px-2 py-2">Apps</th>
                  <th className="text-right px-2 py-2">Approved</th>
                  <th className="text-right px-2 py-2">Shops</th>
                  <th className="text-right px-2 py-2">Listings</th>
                  <th className="text-right px-2 py-2">Orders</th>
                  <th className="text-right px-2 py-2">Gross $</th>
                  <th className="text-right px-2 py-2">Commission</th>
                  <th className="text-right px-2 py-2">Conv %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.bucket} className="border-t border-line" data-testid={`ga-row-${r.bucket}`}>
                    <td className="px-2 py-2 whitespace-nowrap">{r.bucket}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(r.unique_visitors)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(r.page_views)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(r.applications)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(r.approved_applications)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(r.shops_created)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(r.listings_posted)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(r.orders)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(r.gross_sales, true)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{_fmt(r.commission, true)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.conversion_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
