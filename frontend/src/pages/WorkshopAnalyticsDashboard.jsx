/**
 * Workshop-built analytics dashboard — isolated from the existing admin
 * Insights tab. Routed at `/admin/workshop-analytics`. Reuses the admin
 * JWT in localStorage so admins are auto-signed-in; non-admin visitors
 * are bounced to /admin/login.
 *
 * Sections (one per workshop endpoint):
 *   1. Overview — KPI tiles + 12-mo revenue + new-users
 *   2. Sales — monthly revenue/orders + top 10 products + categories
 *   3. Sellers — top 20 makers leaderboard
 *   4. Users — monthly signups + cumulative + retention cohorts
 *   5. Live — active visitors + per-page activity sparkline
 *   6. Traffic — sessions / device share / source breakdown
 *   7. Pageviews — totals + 24-h hourly heat
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  fetchWorkshopOverview, fetchWorkshopSales, fetchWorkshopSellers,
  fetchWorkshopUsers, fetchWorkshopLive, fetchWorkshopTraffic,
  fetchWorkshopPageviews,
} from "../lib/api";

const TABS = [
  { id: "overview",  label: "Overview"  },
  { id: "sales",     label: "Sales"     },
  { id: "sellers",   label: "Sellers"   },
  { id: "users",     label: "Users"     },
  { id: "live",      label: "Live"      },
  { id: "traffic",   label: "Traffic"   },
  { id: "pageviews", label: "Pageviews" },
];

// Brand-matching palette — orange accent on near-black ground
const C = {
  ink: "#0a0a0a", card: "#121212", line: "#262626",
  text: "#e5e5e5", mute: "#a3a3a3", dim: "#525252",
  accent: "#ff4500", accent2: "#ffa07a",
};

const tooltipProps = {
  contentStyle: {
    background: "#0a0a0a", border: `1px solid ${C.line}`, borderRadius: 0,
    fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: C.text,
  },
  labelStyle: { color: C.mute, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase" },
  cursor: { stroke: C.accent, strokeWidth: 1, strokeDasharray: "3 3" },
};

const axisProps = {
  tick: { fill: C.dim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
  axisLine: { stroke: C.line }, tickLine: { stroke: C.line },
};


export default function WorkshopAnalyticsDashboard() {
  const nav = useNavigate();
  const [tab, setTab] = useState("overview");
  // Period-over-period KPI window (in days). Affects the Overview tab's
  // delta tiles only — the 12-mo rollup charts are unaffected.
  const [rangeDays, setRangeDays] = useState(30);

  // Each tab fetches lazily so a slow endpoint can't block the rest.
  const [data, setData] = useState({});
  const [loading, setLoading] = useState({});
  const [errored, setErrored] = useState({});

  // Reset scroll on tab switch — keeps long-scrolling charts from
  // landing the next tab mid-page.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [tab]);

  useEffect(() => {
    if (!localStorage.getItem("cm_admin_jwt")) {
      toast.error("Admin sign-in required.");
      nav("/admin/login", { replace: true });
    }
  }, [nav]);

  useEffect(() => {
    if (data[tab] || loading[tab]) return;
    const fetcher = ({
      overview:  () => fetchWorkshopOverview(rangeDays),
      sales:     fetchWorkshopSales,
      sellers:   fetchWorkshopSellers,
      users:     fetchWorkshopUsers,
      live:      fetchWorkshopLive,
      traffic:   fetchWorkshopTraffic,
      pageviews: fetchWorkshopPageviews,
    })[tab];
    if (!fetcher) return;
    setLoading((s) => ({ ...s, [tab]: true }));
    fetcher()
      .then((d) => setData((s) => ({ ...s, [tab]: d })))
      .catch((e) => {
        const msg = e?.response?.data?.detail || `Failed to load ${tab}.`;
        toast.error(msg);
        setErrored((s) => ({ ...s, [tab]: msg }));
      })
      .finally(() => setLoading((s) => ({ ...s, [tab]: false })));
  }, [tab, data, loading, rangeDays]);

  // When the user picks a new range, drop the cached overview so the
  // next render re-fetches with the fresh window.
  const onPickRange = (n) => {
    setRangeDays(n);
    setData((s) => { const c = { ...s }; delete c.overview; return c; });
    setErrored((s) => { const c = { ...s }; delete c.overview; return c; });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] pt-32 pb-24" data-testid="workshop-analytics-page">
      {/* Header — non-sticky so the global Nav doesn't overlap our tab strip */}
      <div className="border-b border-[#262626] bg-[#0a0a0a]">
        <div className="max-w-[1400px] mx-auto px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
              ◆ Workshop · Analytics Dashboard
            </div>
            <h1 className="font-display text-3xl mt-1">Insights, in one place.</h1>
          </div>
          <div className="flex gap-2 shrink-0 items-center">
            {tab === "overview" && (
              <div className="flex gap-1 border border-[#262626]" data-testid="workshop-range-selector">
                {[7, 30, 90].map((n) => {
                  const active = rangeDays === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onPickRange(n)}
                      data-testid={`workshop-range-${n}`}
                      className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                        active ? "bg-[#ff4500] text-black" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
                      }`}
                    >
                      {n}d
                    </button>
                  );
                })}
              </div>
            )}
            <Link
              to="/admin/dashboard"
              data-testid="back-to-admin"
              className="px-3 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
            >
              ← Admin
            </Link>
          </div>
        </div>
        {/* Tab strip */}
        <div className="max-w-[1400px] mx-auto px-6 flex gap-1 overflow-x-auto" data-testid="workshop-tabs">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                data-testid={`workshop-tab-${t.id}`}
                className={`px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] transition border-b-2 whitespace-nowrap ${
                  active
                    ? "border-[#ff4500] text-[#ff4500]"
                    : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5]"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">
        {loading[tab] && !data[tab] && (
          <div className="font-mono text-xs text-[#525252] py-12 text-center" data-testid="workshop-loading">
            Loading {tab}…
          </div>
        )}
        {errored[tab] && !data[tab] && (
          <div className="border border-[#ff4500]/40 bg-[#ff4500]/5 p-5 font-mono text-xs text-[#e5e5e5]" data-testid="workshop-error">
            {errored[tab]}
          </div>
        )}
        {data[tab] && (
          <>
            {tab === "overview"  && <OverviewSection  d={data.overview}  />}
            {tab === "sales"     && <SalesSection     d={data.sales}     />}
            {tab === "sellers"   && <SellersSection   d={data.sellers}   />}
            {tab === "users"     && <UsersSection     d={data.users}     />}
            {tab === "live"      && <LiveSection      d={data.live}      />}
            {tab === "traffic"   && <TrafficSection   d={data.traffic}   />}
            {tab === "pageviews" && <PageviewsSection d={data.pageviews} />}
          </>
        )}
      </div>
    </div>
  );
}


// ---------- Section: Overview ----------
function OverviewSection({ d }) {
  const k = d.kpis;
  const dl = d.deltas || {};
  return (
    <div className="space-y-6" data-testid="workshop-overview">
      <KpiGrid items={[
        { label: "Buyers",        value: k.total_users.toLocaleString(),  testId: "kpi-users",    delta: dl.users    },
        { label: "Paid Orders",   value: k.total_orders.toLocaleString(), testId: "kpi-orders",   delta: dl.orders   },
        { label: "Listings",      value: k.total_listings,                testId: "kpi-listings" },
        { label: "Makers",        value: k.total_makers,                  testId: "kpi-makers"   },
        { label: "Revenue",       value: `$${k.total_revenue.toLocaleString()}`,                       testId: "kpi-revenue", delta: dl.revenue          },
        { label: "Avg Order",     value: `$${k.avg_order_value.toFixed(2)}`,                            testId: "kpi-aov",     delta: dl.avg_order_value  },
      ]} />
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]" data-testid="delta-explainer">
        ◆ Δ vs prior {d.range_days || 30} days · trailing-window comparison
      </p>
      <div className="grid lg:grid-cols-2 gap-6">
        <ChartCard title="Monthly Revenue · 12 mo">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={d.monthly_revenue} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.accent} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipProps} formatter={(v) => `$${v.toLocaleString()}`} />
              <Area type="monotone" dataKey="revenue" stroke={C.accent} strokeWidth={2} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="New Buyers · 12 mo">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.new_users} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="users" fill={C.accent} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}


// ---------- Section: Sales ----------
function SalesSection({ d }) {
  return (
    <div className="space-y-6" data-testid="workshop-sales">
      <ChartCard title="Revenue + Orders · 12 mo">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={d.monthly} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" {...axisProps} />
            <YAxis yAxisId="l" {...axisProps} />
            <YAxis yAxisId="r" orientation="right" {...axisProps} />
            <Tooltip {...tooltipProps} />
            <Legend wrapperStyle={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: C.mute }} />
            <Bar yAxisId="l" dataKey="revenue" name="Revenue ($)" fill={C.accent}  radius={[2, 2, 0, 0]} />
            <Bar yAxisId="r" dataKey="orders"  name="Orders"      fill={C.accent2} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="grid lg:grid-cols-2 gap-6">
        <ChartCard title="Top 10 Products · all-time">
          {d.top_products.length === 0 ? (
            <EmptyState text="No paid orders yet — top products will appear once buyers check out." />
          ) : (
            <table className="w-full font-mono text-xs" data-testid="top-products-table">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.22em] text-[#525252] border-b border-[#262626]">
                  <th className="text-left py-2 pr-3">Product</th>
                  <th className="text-right py-2 pr-3">Sales</th>
                  <th className="text-right py-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {d.top_products.map((p, i) => (
                  <tr key={i} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a]/40">
                    <td className="py-2 pr-3 text-[#e5e5e5] truncate">{p.name}</td>
                    <td className="py-2 pr-3 text-right text-[#a3a3a3]">{p.sales}</td>
                    <td className="py-2 text-right text-[#ff4500]">${p.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>
        <ChartCard title="Revenue by Category">
          {d.by_category.length === 0 ? (
            <EmptyState text="Categories appear once orders are placed." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={d.by_category} layout="vertical" margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={C.line} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" {...axisProps} />
                <YAxis type="category" dataKey="category" width={120} {...axisProps} />
                <Tooltip {...tooltipProps} formatter={(v) => `$${v.toLocaleString()}`} />
                <Bar dataKey="revenue" fill={C.accent} radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}


// ---------- Section: Sellers ----------
function SellersSection({ d }) {
  return (
    <div className="space-y-6" data-testid="workshop-sellers">
      <KpiGrid items={[
        { label: "Total Makers",         value: d.total_makers,                              testId: "kpi-total-makers" },
        { label: "Avg Revenue / Maker",  value: `$${d.avg_revenue_per_maker.toLocaleString()}`, testId: "kpi-avg-rev"   },
        { label: "Active Sellers",       value: d.top_sellers.length,                        testId: "kpi-active"       },
      ]} />
      <ChartCard title="Top Sellers · by GMV">
        {d.top_sellers.length === 0 ? (
          <EmptyState text="No paid orders yet." />
        ) : (
          <table className="w-full font-mono text-xs" data-testid="top-sellers-table">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.22em] text-[#525252] border-b border-[#262626]">
                <th className="text-left py-2 pr-3">#</th>
                <th className="text-left py-2 pr-3">Maker</th>
                <th className="text-right py-2 pr-3">Orders</th>
                <th className="text-right py-2 pr-3">Avg Order</th>
                <th className="text-right py-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {d.top_sellers.map((s, i) => (
                <tr key={s.slug || i} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a]/40">
                  <td className="py-2 pr-3 text-[#525252]">{i + 1}</td>
                  <td className="py-2 pr-3 text-[#e5e5e5]">
                    <Link to={`/makers/${s.slug}`} className="hover:text-[#ff4500]">{s.seller}</Link>
                  </td>
                  <td className="py-2 pr-3 text-right text-[#a3a3a3]">{s.orders}</td>
                  <td className="py-2 pr-3 text-right text-[#a3a3a3]">${s.avg_order.toLocaleString()}</td>
                  <td className="py-2 text-right text-[#ff4500]">${s.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartCard>
    </div>
  );
}


// ---------- Section: Users ----------
function UsersSection({ d }) {
  return (
    <div className="space-y-6" data-testid="workshop-users">
      <KpiGrid items={[
        { label: "Total Buyers", value: d.total_users.toLocaleString(), testId: "kpi-total-users" },
      ]} />
      <ChartCard title="Cumulative Buyer Growth">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={d.monthly_signups} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip {...tooltipProps} />
            <Legend wrapperStyle={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: C.mute }} />
            <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke={C.accent} strokeWidth={2} dot={{ fill: C.accent, r: 3 }} />
            <Line type="monotone" dataKey="signups"    name="New / mo"   stroke={C.accent2} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Retention Cohorts (real)">
        <div className="grid grid-cols-4 gap-3" data-testid="retention-grid">
          {d.retention.map((c) => (
            <div key={c.cohort} className="border border-[#262626] p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">{c.cohort}</div>
              <div className="font-display text-3xl text-[#ff4500] mt-1">{c.rate}%</div>
              {typeof c.denom === "number" && (
                <div className="font-mono text-[10px] text-[#525252] mt-1">
                  {c.retained}/{c.denom} eligible
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="font-mono text-[10px] text-[#525252] mt-3 leading-relaxed">
          Denominator is users whose signup is old enough to have been able to come back at week N. A user is "retained" if their last_seen ≥ signup + N weeks.
        </p>
      </ChartCard>
    </div>
  );
}


// ---------- Section: Live ----------
function LiveSection({ d }) {
  const sparklineData = useMemo(
    () => d.sparkline.map((v, i) => ({ i, v })),
    [d.sparkline],
  );
  return (
    <div className="space-y-6" data-testid="workshop-live">
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 border border-[#262626] p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-[#ff4500] rounded-full animate-pulse" />
            Active Visitors · Now
          </div>
          <div className="font-display text-6xl text-[#e5e5e5] mt-2" data-testid="active-visitors-count">
            {d.active_visitors.toLocaleString()}
          </div>
          <div className="mt-4 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <Line type="monotone" dataKey="v" stroke={C.accent} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <ChartCard title="Top Active Pages" className="lg:col-span-2">
          <ul className="space-y-2 font-mono text-xs">
            {d.active_pages.map((p) => (
              <li key={p.page} className="flex items-center justify-between border-b border-[#1a1a1a] py-2">
                <span className="text-[#e5e5e5]">{p.page}</span>
                <span className="text-[#ff4500]">{p.visitors} visitor{p.visitors === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>
      <ChartCard title="Recent Events">
        <ul className="space-y-2 font-mono text-xs">
          {d.recent_events.map((e, i) => (
            <li key={i} className="flex items-center justify-between border-b border-[#1a1a1a] py-2">
              <span>
                <span className="text-[#525252] mr-3">{e.time}</span>
                <span className="text-[#e5e5e5]">{e.event}</span>
                <span className="text-[#a3a3a3]"> · {e.page}</span>
              </span>
              <span className="text-[#525252]">{e.location}</span>
            </li>
          ))}
        </ul>
      </ChartCard>
    </div>
  );
}


// ---------- Section: Traffic ----------
function TrafficSection({ d }) {
  return (
    <div className="space-y-6" data-testid="workshop-traffic">
      <ChartCard title="Sessions · 12 mo">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={d.monthly}>
            <defs>
              <linearGradient id="sess" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.accent} stopOpacity={0.5} />
                <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip {...tooltipProps} />
            <Area type="monotone" dataKey="sessions" stroke={C.accent} strokeWidth={2} fill="url(#sess)" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="grid lg:grid-cols-2 gap-6">
        <ChartCard title="Devices">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={d.devices}
                dataKey="share"
                nameKey="device"
                cx="50%" cy="50%"
                innerRadius={50} outerRadius={90}
                label={(e) => `${e.device} · ${e.share}%`}
                labelLine={false}
              >
                {d.devices.map((_, i) => (
                  <Cell key={i} fill={[C.accent, C.accent2, "#7FAF7E"][i % 3]} />
                ))}
              </Pie>
              <Tooltip {...tooltipProps} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Sources">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.sources} layout="vertical" margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={C.line} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" {...axisProps} />
              <YAxis type="category" dataKey="source" {...axisProps} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="sessions" radius={[0, 2, 2, 0]}>
                {d.sources.map((s, i) => (
                  <Cell key={i} fill={s.color || C.accent} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}


// ---------- Section: Pageviews ----------
function PageviewsSection({ d }) {
  return (
    <div className="space-y-6" data-testid="workshop-pageviews">
      <KpiGrid items={[
        { label: "Total Pageviews",  value: d.totals.total_pageviews.toLocaleString(),  testId: "kpi-pv-total"  },
        { label: "Unique Pageviews", value: d.totals.unique_pageviews.toLocaleString(), testId: "kpi-pv-unique" },
        { label: "Pages / Session",  value: d.totals.pages_per_session,                 testId: "kpi-pv-ratio"  },
        { label: "Avg Time on Page", value: d.totals.avg_time_on_page,                  testId: "kpi-pv-time"   },
      ]} />
      <ChartCard title="Hourly · 24-hour pattern">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={d.hourly} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="hour" {...axisProps} interval={2} />
            <YAxis {...axisProps} />
            <Tooltip {...tooltipProps} />
            <Bar dataKey="pageviews" fill={C.accent} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Top Pages">
        <table className="w-full font-mono text-xs" data-testid="top-pages-table">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.22em] text-[#525252] border-b border-[#262626]">
              <th className="text-left py-2 pr-3">Page</th>
              <th className="text-right py-2 pr-3">Views</th>
              <th className="text-right py-2 pr-3">Unique</th>
              <th className="text-right py-2 pr-3">Bounce</th>
              <th className="text-right py-2">Avg Time</th>
            </tr>
          </thead>
          <tbody>
            {d.top_pages.map((p, i) => (
              <tr key={i} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a]/40">
                <td className="py-2 pr-3 text-[#e5e5e5]">{p.page}</td>
                <td className="py-2 pr-3 text-right text-[#a3a3a3]">{p.views.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right text-[#a3a3a3]">{p.unique.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right text-[#a3a3a3]">{p.exits ?? p.bounce}%</td>
                <td className="py-2 text-right text-[#a3a3a3]">{p.avg_time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </div>
  );
}


// ---------- Reusable bits ----------
function KpiGrid({ items }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="kpi-grid">
      {items.map((it) => (
        <div key={it.label} className="border border-[#262626] p-4 hover:border-[#ff4500] transition" data-testid={it.testId}>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">{it.label}</div>
          <div className="font-display text-2xl text-[#e5e5e5] mt-1 break-words">{it.value}</div>
          {it.delta !== undefined && <DeltaPill delta={it.delta} />}
        </div>
      ))}
    </div>
  );
}

/**
 * Delta pill — renders the period-over-period change as a colored chip:
 *   • +X.X% on green when current > prior
 *   • -X.X% on red   when current < prior
 *   • flat   on grey when delta=0
 *   • new    on orange when prior=0 (pct is null — there's no meaningful %)
 *   • —      neutral when delta is missing
 */
function DeltaPill({ delta }) {
  if (!delta) return <div className="h-4 mt-1.5" />;
  const { pct, current, prior } = delta;
  // pct is null when prior was 0 (no meaningful base — show "new" pill)
  if (pct === null || pct === undefined) {
    if (current > 0 && (prior === 0 || prior === null)) {
      return (
        <div className="mt-1.5 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#ff4500]" data-testid="delta-pill-new">
          ◆ NEW
        </div>
      );
    }
    return <div className="h-4 mt-1.5" />;
  }
  const up = pct > 0;
  const flat = pct === 0;
  const color = flat ? "text-[#525252]" : up ? "text-[#7FAF7E]" : "text-[#E8875A]";
  const arrow = flat ? "→" : up ? "▲" : "▼";
  const pctText = flat ? "flat" : `${up ? "+" : ""}${pct}%`;
  return (
    <div
      className={`mt-1.5 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] ${color}`}
      title={`30d: ${current} · prior 30d: ${prior}`}
      data-testid="delta-pill"
    >
      <span>{arrow}</span>
      <span>{pctText}</span>
    </div>
  );
}

function ChartCard({ title, children, className = "" }) {
  return (
    <div className={`border border-[#262626] p-5 ${className}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-4">{title}</div>
      {children}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="font-mono text-xs text-[#525252] py-8 text-center">{text}</div>
  );
}
