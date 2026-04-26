import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  fetchAdminMe,
  fetchAdminApplications,
  fetchAdminCustomOrders,
  fetchAdminOrders,
  fetchAdminAnalytics,
  fetchAdminMakerAnalytics,
  fetchAdminWebAnalytics,
  fetchAdminLiveNow,
  adminPatchProduct,
  adminDeleteProduct,
  adminCreateReview,
  adminDeleteReview,
  adminRefundOrder,
  decideMakerApplication,
  quoteCustomOrder,
  fetchProducts,
  fetchMakers,
  fetchReviews,
} from "../lib/api";
import { Sparkline, DeltaBadge } from "../components/Charts";
import { Stat } from "../components/admin/_shared";
import UsersTab from "../components/admin/UsersTab";
import DigestsTab from "../components/admin/DigestsTab";
import SettingsTab from "../components/admin/SettingsTab";

const TABS = [
  { id: "analytics", label: "Analytics" },
  { id: "web", label: "Web Analytics" },
  { id: "makers", label: "Maker Analytics" },
  { id: "applications", label: "Applications" },
  { id: "custom", label: "Custom Orders" },
  { id: "orders", label: "Paid Orders" },
  { id: "listings", label: "Listings" },
  { id: "users", label: "Users" },
  { id: "reviews", label: "Reviews" },
  { id: "digests", label: "Digests" },
  { id: "settings", label: "Settings" },
];

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("applications");
  const [me, setMe] = useState(null);
  const [apps, setApps] = useState([]);
  const [custom, setCustom] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const logout = () => {
    localStorage.removeItem("cm_admin_jwt");
    navigate("/admin/login", { replace: true });
  };

  const refresh = async () => {
    const [meRes, appRes, custRes, ordRes] = await Promise.all([
      fetchAdminMe(),
      fetchAdminApplications(),
      fetchAdminCustomOrders(),
      fetchAdminOrders(),
    ]);
    setMe(meRes);
    setApps(appRes);
    setCustom(custRes);
    setOrders(ordRes);
  };

  useEffect(() => {
    if (!localStorage.getItem("cm_admin_jwt")) {
      navigate("/admin/login", { replace: true });
      return;
    }
    (async () => {
      try {
        await refresh();
      } catch (e) {
        if (e?.response?.status === 401 || e?.response?.status === 403) {
          logout();
          return;
        }
        setErr(e?.response?.data?.detail || "Failed to load.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="pt-40 pb-24 min-h-screen grain text-center" data-testid="admin-dashboard-loading">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
          ◆ Loading console…
        </div>
      </div>
    );
  }

  if (err && !me) {
    return (
      <div className="pt-40 pb-24 min-h-screen grain text-center px-4">
        <p className="font-mono text-sm text-red-400">{err}</p>
        <button onClick={logout} className="btn-industrial btn-primary mt-6 inline-flex">
          Sign in again
        </button>
      </div>
    );
  }

  const totalRevenue = orders.reduce((s, o) => s + (o.amount || 0), 0);
  const pendingApps = apps.filter((a) => !a.status).length;
  const pendingCustom = custom.filter((c) => c.status !== "quoted").length;

  return (
    <div className="pt-32 pb-24 min-h-screen grain" data-testid="admin-dashboard">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10 pb-6 border-b border-[#262626]"
        >
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
              ◆ Admin Console · {me?.email}
            </div>
            <h1 className="font-display text-[44px] md:text-[72px] leading-[0.9] uppercase">
              Operations.
            </h1>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <LiveNowBadge />
            <button
              onClick={logout}
              className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
              data-testid="admin-logout-btn"
            >
              Sign Out
            </button>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-10">
          <Stat label="Pending Apps" value={pendingApps} testId="stat-pending-apps" />
          <Stat label="Open Briefs" value={pendingCustom} testId="stat-pending-custom" />
          <Stat label="Paid Orders" value={orders.length} testId="stat-paid-orders" />
          <Stat label="Revenue" value={`$${totalRevenue.toFixed(0)}`} testId="stat-revenue" />
        </div>

        <div className="flex border-b border-[#262626] mb-8 overflow-x-auto" data-testid="admin-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] border-b-2 transition whitespace-nowrap ${
                tab === t.id
                  ? "border-[#ff4500] text-[#ff4500]"
                  : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
              data-testid={`admin-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "analytics" && <AnalyticsTab />}
        {tab === "web" && <WebAnalyticsTab />}
        {tab === "makers" && <MakerAnalyticsTab />}
        {tab === "applications" && (
          <ApplicationsList items={apps} onChange={refresh} />
        )}
        {tab === "custom" && <CustomOrdersList items={custom} onChange={refresh} />}
        {tab === "orders" && <PaidOrdersList items={orders} />}
        {tab === "listings" && <ListingsTab />}
        {tab === "users" && <UsersTab />}
        {tab === "reviews" && <ReviewsTab />}
        {tab === "digests" && <DigestsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}

// ===================== ANALYTICS =====================
function AnalyticsTab() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetchAdminAnalytics().then(setData).catch(() => setData(null));
  }, []);
  if (!data) {
    return <p className="font-mono text-sm text-[#a3a3a3]" data-testid="analytics-loading">Loading…</p>;
  }
  return (
    <div className="space-y-8" data-testid="analytics-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="GMV (all-time)" value={`$${data.gmv.toFixed(0)}`} testId="an-gmv" />
        <Stat label="GMV · 30d" value={`$${data.gmv_30d.toFixed(0)}`} testId="an-gmv-30" />
        <Stat label="GMV · 7d" value={`$${data.gmv_7d.toFixed(0)}`} testId="an-gmv-7" />
        <Stat label="Avg Order" value={`$${data.avg_order.toFixed(0)}`} testId="an-avg-order" />
        <Stat label="Paid Orders" value={data.paid_orders} testId="an-orders" />
        <Stat label="Community" value={data.community_users} testId="an-users" />
        <Stat label="Showcase" value={data.showcase_posts} testId="an-showcase" />
        <Stat label="Forum" value={data.forum_threads} testId="an-forum" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-display text-2xl mb-4">Top Products</h3>
          {!data.top_products.length ? (
            <p className="font-mono text-xs text-[#a3a3a3]">No paid orders yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="an-top-products">
              {data.top_products.map((p) => (
                <li key={p.slug} className="border border-[#262626] p-3 flex justify-between items-center">
                  <div>
                    <div className="font-display text-base">{p.title}</div>
                    <div className="font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.22em]">
                      by {p.maker_slug}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-xl text-[#ff4500]">${p.revenue.toFixed(0)}</div>
                    <div className="font-mono text-[10px] text-[#525252]">{p.units} sold</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="font-display text-2xl mb-4">Top Makers</h3>
          {!data.top_makers.length ? (
            <p className="font-mono text-xs text-[#a3a3a3]">No paid orders yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="an-top-makers">
              {data.top_makers.map((m) => (
                <li key={m.slug} className="border border-[#262626] p-3 flex justify-between items-center">
                  <div className="font-display text-base">{m.name}</div>
                  <div className="font-display text-xl text-[#ff4500]">${m.revenue.toFixed(0)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-6 border-t border-[#262626]">
        <Stat label="Pending Apps" value={data.applications_pending} testId="an-pending-apps" />
        <Stat label="Open Briefs" value={data.custom_orders_open} testId="an-pending-custom" />
        <Stat label="Listings" value={data.products_count} testId="an-listings" />
        <Stat label="Files" value={data.design_files} testId="an-files" />
      </div>

      {data.weekly_gmv && (
        <Sparkline data={data.weekly_gmv} label="Marketplace" testId="an-weekly-gmv" />
      )}
    </div>
  );
}

// ===================== WEB ANALYTICS (pageviews, visitors, geo, sources) =====
function WebAnalyticsTab() {
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


// ===================== MAKER ANALYTICS (per-maker drill-in) =====================
function MakerAnalyticsTab() {
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


// ===================== LISTINGS =====================
function ListingsTab() {
  const [products, setProducts] = useState([]);
  const refresh = () => fetchProducts().then(setProducts);
  useEffect(() => { refresh(); }, []);
  return (
    <div data-testid="listings-tab" className="space-y-3">
      {products.map((p) => (
        <ListingRow key={p.slug} p={p} onChange={refresh} />
      ))}
    </div>
  );
}

function ListingRow({ p, onChange }) {
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState(p.in_stock);
  const toggleFeatured = async () => {
    setBusy(true);
    try { await adminPatchProduct(p.slug, { featured: !p.featured }); onChange(); }
    finally { setBusy(false); }
  };
  const saveStock = async () => {
    setBusy(true);
    try { await adminPatchProduct(p.slug, { in_stock: parseInt(stock || 0, 10) }); onChange(); }
    finally { setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm(`Delete listing "${p.title}"? This can't be undone.`)) return;
    setBusy(true);
    try { await adminDeleteProduct(p.slug); onChange(); }
    finally { setBusy(false); }
  };
  return (
    <div
      className={`border ${p.featured ? "border-[#ff4500]/40" : "border-[#262626]"} hover:border-[#ff4500] transition p-4 flex flex-col md:flex-row md:items-center gap-4`}
      data-testid={`listing-${p.slug}`}
    >
      <img src={p.images?.[0]} alt="" className="w-full md:w-24 h-24 object-cover" />
      <div className="flex-1 min-w-0">
        <div className="font-display text-xl truncate">{p.title}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1">
          {p.category} · {p.technique} · by {p.maker_slug}
          {p.model_url && <span className="text-[#ff4500] ml-2">· 3D</span>}
        </div>
        <div className="font-display text-2xl text-[#ff4500] mt-2">${p.price.toFixed(0)}</div>
      </div>
      <div className="flex flex-col gap-2 md:items-end">
        <button
          onClick={toggleFeatured}
          disabled={busy}
          className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border transition disabled:opacity-50 ${
            p.featured ? "border-[#ff4500] text-[#ff4500]" : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]"
          }`}
          data-testid={`listing-featured-${p.slug}`}
        >
          {p.featured ? "★ Featured" : "☆ Feature"}
        </button>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            min="0"
            className="w-16 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-2 py-1 font-mono text-[11px]"
            data-testid={`listing-stock-${p.slug}`}
          />
          <button
            onClick={saveStock}
            disabled={busy || stock === p.in_stock}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] disabled:opacity-50"
            data-testid={`listing-stock-save-${p.slug}`}
          >
            save
          </button>
        </div>
        <button
          onClick={del}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-200 disabled:opacity-50"
          data-testid={`listing-delete-${p.slug}`}
        >
          ⊗ delete
        </button>
      </div>
    </div>
  );
}


// ===================== REVIEWS =====================
function ReviewsTab() {
  const [reviews, setReviews] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const refresh = () => fetchReviews().then(setReviews);
  useEffect(() => { refresh(); }, []);
  return (
    <div data-testid="reviews-tab" className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="font-mono text-xs text-[#a3a3a3]">{reviews.length} reviews</p>
        <button onClick={() => setShowNew((s) => !s)} className="btn-industrial btn-primary inline-flex" data-testid="reviews-new-btn">
          {showNew ? "Cancel" : "+ Add review"}
        </button>
      </div>
      {showNew && <NewReviewForm onSaved={() => { setShowNew(false); refresh(); }} />}
      {reviews.map((r) => (
        <div key={r.id} className="border border-[#262626] p-4" data-testid={`review-${r.id}`}>
          <div className="flex justify-between items-baseline">
            <div>
              <div className="font-display text-lg">{r.name}</div>
              <div className="font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.22em]">
                {r.location} · {"★".repeat(r.rating)}
              </div>
            </div>
            <button
              onClick={async () => {
                if (window.confirm("Delete this review?")) {
                  await adminDeleteReview(r.id);
                  refresh();
                }
              }}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-200"
              data-testid={`review-delete-${r.id}`}
            >
              ⊗ delete
            </button>
          </div>
          <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-2">{r.text}</p>
        </div>
      ))}
    </div>
  );
}

function NewReviewForm({ onSaved }) {
  const [r, setR] = useState({ name: "", location: "", rating: 5, text: "", product_slug: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await adminCreateReview({ ...r, rating: parseInt(r.rating, 10) || 5 }); onSaved(); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="border border-[#262626] p-4 grid md:grid-cols-2 gap-3" data-testid="review-new-form">
      <input required placeholder="Reviewer name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-name" />
      <input required placeholder="Location (City, ST)" value={r.location} onChange={(e) => setR({ ...r, location: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-location" />
      <input type="number" min="1" max="5" value={r.rating} onChange={(e) => setR({ ...r, rating: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-rating" />
      <input placeholder="Product slug (optional)" value={r.product_slug} onChange={(e) => setR({ ...r, product_slug: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-product" />
      <textarea required rows={3} placeholder="Review text…" value={r.text} onChange={(e) => setR({ ...r, text: e.target.value })}
                className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                data-testid="review-text" />
      <button type="submit" disabled={busy} className="btn-industrial btn-primary md:col-span-2 disabled:opacity-50" data-testid="review-submit">
        {busy ? "Saving…" : "Add review →"}
      </button>
    </form>
  );
}

// ===================== LIVE-NOW BADGE (admin nav real-time pulse) =====
function LiveNowBadge() {
  const [data, setData] = useState({ live_5m: 0, live_1m: 0 });
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetch = () => {
      fetchAdminLiveNow()
        .then((d) => { if (!cancelled) { setData(d); setErr(false); } })
        .catch(() => { if (!cancelled) setErr(true); });
    };
    fetch();
    const id = setInterval(() => {
      if (document.hidden) return;     // pause when tab hidden
      fetch();
    }, 30000);
    const onVis = () => { if (!document.hidden) fetch(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (err) return null;
  const pulse = data.live_1m > 0;
  const dotCls = pulse ? "bg-emerald-400 animate-pulse" : "bg-[#525252]";
  return (
    <div
      className="hidden md:flex items-center gap-2 px-3 py-2 border border-[#262626]"
      title={`${data.live_5m} visitors in last 5 min, ${data.live_1m} active in last 1 min`}
      data-testid="admin-live-now"
    >
      <span className={`inline-block w-2 h-2 rounded-full ${dotCls}`} />
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
        Live · <span className="text-[#e5e5e5]" data-testid="admin-live-now-count">{data.live_5m}</span>
      </span>
    </div>
  );
}


function ApplicationsList({ items, onChange }) {
  if (!items.length) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="apps-empty">
        No applications yet.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="apps-list">
      {items.map((a) => (
        <ApplicationRow key={a.id} app={a} onChange={onChange} />
      ))}
    </div>
  );
}

function ApplicationRow({ app, onChange }) {
  const [note, setNote] = useState(app.note || "");
  const [busy, setBusy] = useState(false);
  const decided = app.status === "approved" || app.status === "rejected";
  const decide = async (approved) => {
    setBusy(true);
    try {
      await decideMakerApplication(app.id, { approved, note });
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="border border-[#262626] hover:border-[#ff4500] transition p-5"
      data-testid={`app-${app.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-[#262626]">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ {app.status ? `Decided · ${app.status}` : "Pending"} · {formatDate(app.created_at)}
          </div>
          <div className="font-display text-2xl mt-1">{app.studio_name}</div>
          <div className="font-mono text-xs text-[#a3a3a3] mt-1">
            {app.name} · {app.location} ·{" "}
            <a href={`mailto:${app.email}`} className="underline hover:text-[#ff4500]">
              {app.email}
            </a>
          </div>
          {app.techniques?.length ? (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-2">
              {app.techniques.join(" · ")}
            </div>
          ) : null}
          {app.portfolio_url ? (
            <div className="font-mono text-[10px] mt-1">
              <a
                href={app.portfolio_url}
                target="_blank"
                rel="noreferrer"
                className="text-[#ff4500] hover:underline"
              >
                Portfolio ↗
              </a>
            </div>
          ) : null}
        </div>
      </div>
      <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-3">{app.about}</p>

      {!decided && (
        <div className="mt-4 space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional note (sent to applicant)"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`app-note-${app.id}`}
          />
          <div className="flex gap-3">
            <button
              onClick={() => decide(true)}
              disabled={busy}
              className="btn-industrial btn-primary disabled:opacity-50"
              data-testid={`app-approve-${app.id}`}
            >
              Approve
            </button>
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="px-5 py-3 border border-[#262626] hover:border-red-500 hover:text-red-400 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid={`app-reject-${app.id}`}
            >
              Reject
            </button>
          </div>
        </div>
      )}
      {decided && app.note && (
        <div className="mt-3 font-mono text-xs text-[#a3a3a3] border-l-2 border-[#ff4500] pl-3">
          {app.note}
        </div>
      )}
    </div>
  );
}

function CustomOrdersList({ items, onChange }) {
  if (!items.length) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="custom-empty">
        No custom briefs yet.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="custom-list">
      {items.map((c) => (
        <CustomOrderRow key={c.id} order={c} onChange={onChange} />
      ))}
    </div>
  );
}

function CustomOrderRow({ order, onChange }) {
  const [quote, setQuote] = useState(order.quote || "");
  const [message, setMessage] = useState(order.quote_note || "");
  const [busy, setBusy] = useState(false);
  const submitQuote = async () => {
    if (!quote || isNaN(Number(quote))) return;
    setBusy(true);
    try {
      await quoteCustomOrder(order.id, { quote: Number(quote), message });
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="border border-[#262626] hover:border-[#ff4500] transition p-5"
      data-testid={`custom-${order.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-[#262626]">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ {order.status === "quoted" ? `Quoted · $${order.quote}` : "Open"} · {formatDate(order.created_at)}
          </div>
          <div className="font-display text-2xl mt-1">{order.project_type}</div>
          <div className="font-mono text-xs text-[#a3a3a3] mt-1">
            {order.name} ·{" "}
            <a href={`mailto:${order.email}`} className="underline hover:text-[#ff4500]">
              {order.email}
            </a>{" "}
            {order.phone ? `· ${order.phone}` : ""}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-2">
            {order.material} · {order.size || "size n/a"} · {order.budget || "budget n/a"}
          </div>
        </div>
      </div>
      <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-3">{order.description}</p>

      <div className="mt-4 grid md:grid-cols-3 gap-3 items-start">
        <input
          type="number"
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          placeholder="Quote ($)"
          min="0"
          step="0.01"
          className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
          data-testid={`custom-quote-${order.id}`}
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder="Optional message to buyer"
          className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
          data-testid={`custom-msg-${order.id}`}
        />
      </div>
      <button
        onClick={submitQuote}
        disabled={busy || !quote}
        className="btn-industrial btn-primary mt-3 disabled:opacity-50"
        data-testid={`custom-send-quote-${order.id}`}
      >
        {order.status === "quoted" ? "Re-Send Quote" : "Send Quote"}
      </button>
    </div>
  );
}

function PaidOrdersList({ items }) {
  const [refunding, setRefunding] = useState("");
  const [refunded, setRefunded] = useState(() =>
    new Set(items.filter((o) => o.refund_status === "refunded").map((o) => o.session_id))
  );
  const [err, setErr] = useState({});

  const refund = async (sid) => {
    if (!window.confirm(
      "Full refund: this will reverse the buyer's charge AND every maker payout for this order. Platform fee is also refunded. Continue?"
    )) return;
    setRefunding(sid); setErr((e) => ({ ...e, [sid]: "" }));
    try {
      await adminRefundOrder(sid);
      setRefunded((r) => new Set(r).add(sid));
    } catch (e) {
      setErr((p) => ({ ...p, [sid]: e?.response?.data?.detail || "Refund failed." }));
    } finally {
      setRefunding("");
    }
  };

  if (!items.length) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="orders-empty-admin">
        No paid orders yet.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="orders-list-admin">
      {items.map((o) => {
        const isRefunded = refunded.has(o.session_id) || o.refund_status === "refunded";
        return (
          <div
            key={o.session_id}
            className={`border border-[#262626] transition p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2 ${
              isRefunded ? "opacity-60" : "hover:border-[#ff4500]"
            }`}
            data-testid={`paid-order-${o.session_id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
                ◆ {isRefunded ? "Refunded" : "Paid"} · {formatDate(o.created_at)}
              </div>
              <div className="font-mono text-xs text-[#e5e5e5] mt-1 truncate">{o.summary}</div>
              <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">
                {o.customer_email || "no buyer email"} ·{" "}
                <span className="text-[#525252]">{o.session_id?.slice(0, 16)}…</span>
              </div>
              {err[o.session_id] && (
                <p className="font-mono text-[10px] text-red-400 mt-1">{err[o.session_id]}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="font-display text-3xl text-[#ff4500]">
                ${(o.amount || 0).toFixed(2)}
              </div>
              {!isRefunded ? (
                <button
                  onClick={() => refund(o.session_id)}
                  disabled={refunding === o.session_id}
                  className="font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-2 border border-[#262626] hover:border-red-400 hover:text-red-400 transition disabled:opacity-50"
                  data-testid={`order-refund-btn-${o.session_id}`}
                >
                  {refunding === o.session_id ? "Refunding…" : "⊗ Refund"}
                </button>
              ) : (
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400"
                  data-testid={`order-refunded-${o.session_id}`}
                >
                  ✓ Refunded
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
