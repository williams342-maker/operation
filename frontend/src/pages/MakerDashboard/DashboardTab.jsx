import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingBag, Box, MessageSquare, AlertTriangle, DollarSign,
  ArrowUpRight, Sparkles,
} from "lucide-react";
import PlusUpgradeNudge from "./PlusUpgradeNudge";

/**
 * Maker Dashboard "home" view — at-a-glance overview of the shop.
 *
 * Pure presentational component. Reads from props the parent already loads
 * for the other tabs (`maker`, `orders`, `products`) — no extra API calls.
 * Drives traffic to the deeper tabs via inline CTAs, so this is both the
 * landing surface AND the routing hub for new makers who don't yet know
 * where Stats / Financials / Marketing live.
 *
 * Sections:
 *   1. Welcome header (greets by shop name, surfaces account status)
 *   2. KPI grid: live listings · open orders · unread messages · revenue
 *   3. "Get started" checklist (collapses when complete) — same flags the
 *      header status badges read from, but with an actionable next-step.
 *   4. Recent orders (last 5) + quick links into Listings / Marketing / Help
 */
export default function DashboardTab({
  maker = {},
  orders = [],
  products = [],
  unreadMessages = 0,
  fresh = {},
  freshKey = 0,
  onTabChange,
}) {
  const live = useMemo(
    () => products.filter((p) => !p.deleted_at && p.status !== "draft"),
    [products],
  );
  const drafts = useMemo(
    () => products.filter((p) => !p.deleted_at && p.status === "draft"),
    [products],
  );
  const openOrders = useMemo(
    () => orders.filter((o) => (o.status || "").toLowerCase() !== "shipped"
                            && (o.status || "").toLowerCase() !== "delivered"),
    [orders],
  );
  const totalRevenue = useMemo(
    () => orders.reduce((s, o) => s + (Number(o.total_cents || 0) / 100), 0),
    [orders],
  );
  const recentOrders = useMemo(
    () => [...orders]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, 5),
    [orders],
  );

  // Onboarding checklist — flips green when satisfied.
  const checklist = [
    {
      id: "products",
      label: "Add at least 3 products",
      done: live.length >= 3,
      hint: live.length === 0
        ? "Your shop is empty — buyers can't find you yet."
        : `${live.length} live · ${3 - live.length} more to clear the bar`,
      cta: { label: "Manage listings →", target: "listings" },
    },
    {
      id: "profile",
      label: "Complete your shop profile",
      done: !!(maker?.bio && maker?.location && maker?.portrait),
      hint: "Bio + location + portrait — buyers trust filled-out shops.",
      cta: { label: "Edit shop →", target: "__profile" },
    },
    {
      id: "payouts",
      label: "Connect Stripe for payouts",
      done: !!(maker?.stripe_charges_enabled && maker?.stripe_payouts_enabled),
      hint: "Required to receive money from sales. ~5 minutes.",
      cta: { label: "Set up payouts →", target: "financials" },
    },
    {
      id: "approved",
      label: "Get approved as a seller",
      done: maker?.approved !== false,
      hint: "Auto-completes once an admin reviews your application.",
      cta: null,
    },
  ];
  const remaining = checklist.filter((c) => !c.done);

  const handleCta = (target) => {
    if (target === "__profile") {
      // Special: opens the profile drawer rather than switching tabs.
      window.dispatchEvent(new CustomEvent("cm:open-profile-drawer"));
      return;
    }
    onTabChange?.(target);
  };

  return (
    <div className="space-y-6" data-testid="dashboard-tab">
      {/* COMPACT HEADER + KPI STRIP — was previously a full-bleed h1 +
          intro paragraph + 4-up oversized KPI grid that ate ~30% of the
          viewport before any actionable content. Now collapsed into a
          single horizontal strip so the checklist / orders / quick links
          land above the fold. */}
      <header
        className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-[#1f1f1f]"
        data-testid="dashboard-header"
      >
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-1">
            ◆ Workshop · Overview
          </div>
          <h1 className="font-display text-xl md:text-2xl uppercase leading-tight truncate">
            Welcome back, <span className="text-[#ff4500]">{maker?.name || "maker"}</span>
          </h1>
        </div>
        <KpiStrip
          live={live.length}
          drafts={drafts.length}
          openOrders={openOrders.length}
          totalOrders={orders.length}
          unreadMessages={unreadMessages}
          totalRevenue={totalRevenue}
          fresh={fresh}
          freshKey={freshKey}
          onTabChange={onTabChange}
        />
      </header>

      {/* CRAFTERS PLUS UPGRADE NUDGE — always visible for Free makers, never
          dismissible (per spec: surfacing is the point). Hidden for Plus
          subscribers since they already have it. CTA dispatches a custom
          event so the parent can switch to Settings AND pre-select the
          subscription sub-section in one shot. */}
      <PlusUpgradeNudge
        maker={maker}
        orders={orders}
        onUpgrade={() => {
          window.dispatchEvent(
            new CustomEvent("cm:open-settings", { detail: { section: "subscription" } }),
          );
        }}
      />

      {/* GET STARTED CHECKLIST — collapses to a "✓ Setup complete" badge once done */}
      {remaining.length > 0 ? (
        <section
          className="border border-[#262626] p-5 md:p-6 space-y-4"
          data-testid="dashboard-checklist"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
                ◆ Get Started
              </div>
              <h2 className="font-display text-xl md:text-2xl uppercase">
                {remaining.length} step{remaining.length > 1 ? "s" : ""} to a launch-ready shop
              </h2>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              {checklist.length - remaining.length} of {checklist.length} done
            </div>
          </div>
          <ul className="space-y-2">
            {checklist.map((c) => (
              <li
                key={c.id}
                className={`border p-3 flex items-start gap-3 ${
                  c.done
                    ? "border-emerald-700/50 bg-emerald-900/10 opacity-60"
                    : "border-[#262626] hover:border-[#ff4500] transition"
                }`}
                data-testid={`checklist-${c.id}`}
              >
                <span className={`mt-0.5 font-mono text-xs ${c.done ? "text-emerald-400" : "text-[#525252]"}`}>
                  {c.done ? "✓" : "○"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-[#e5e5e5]">{c.label}</div>
                  <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">{c.hint}</div>
                </div>
                {!c.done && c.cta && (
                  <button
                    onClick={() => handleCta(c.cta.target)}
                    className="shrink-0 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.2em] transition"
                    data-testid={`checklist-cta-${c.id}`}
                  >
                    {c.cta.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section
          className="border border-emerald-700/50 bg-emerald-900/10 p-5 flex items-center gap-3"
          data-testid="dashboard-checklist-complete"
        >
          <Sparkles size={18} className="text-emerald-400 shrink-0" />
          <div className="font-mono text-xs text-emerald-300">
            ✓ Setup complete — you're launch-ready. Now drive traffic from the Marketing tab.
          </div>
        </section>
      )}

      {/* RECENT ORDERS + QUICK LINKS */}
      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 border border-[#262626] p-5 md:p-6" data-testid="dashboard-recent-orders">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
                ◆ Recent
              </div>
              <h2 className="font-display text-xl md:text-2xl uppercase">Orders</h2>
            </div>
            <button
              onClick={() => onTabChange?.("orders")}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
              data-testid="dashboard-orders-all"
            >
              View all →
            </button>
          </div>
          {recentOrders.length === 0 ? (
            <div className="font-mono text-xs text-[#525252] py-6 text-center">
              No orders yet — once buyers start purchasing, they'll show up here.
            </div>
          ) : (
            <ul className="divide-y divide-[#1f1f1f]">
              {recentOrders.map((o) => (
                <li
                  key={o.id}
                  className="py-3 flex items-center justify-between gap-3"
                  data-testid={`dashboard-order-${o.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-[#e5e5e5] truncate">
                      #{(o.id || "").slice(0, 8)} · {o.buyer_email || "—"}
                    </div>
                    <div className="font-mono text-[10px] text-[#a3a3a3] mt-0.5">
                      {o.status?.toUpperCase() || "PENDING"} · {(o.created_at || "").slice(0, 10)}
                    </div>
                  </div>
                  <div className="font-display text-lg shrink-0">
                    ${((o.total_cents || 0) / 100).toFixed(0)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3" data-testid="dashboard-quicklinks">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
              ◆ Quick links
            </div>
            <h2 className="font-display text-xl md:text-2xl uppercase">Jump to</h2>
          </div>
          <QuickLink to="listings" onClick={onTabChange} icon={Box} label="Manage listings" testId="ql-listings" />
          <QuickLink to="marketing" onClick={onTabChange} icon={Sparkles} label="Marketing tools" testId="ql-marketing" />
          <QuickLink to="violations" onClick={onTabChange} icon={AlertTriangle} label="Policy violations" testId="ql-violations" />
          <Link
            to="/journal"
            className="block px-4 py-3 border border-[#262626] hover:border-[#ff4500] transition"
            data-testid="ql-journal"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-[#e5e5e5] uppercase tracking-[0.18em]">
                ↗ Read the maker journal
              </span>
              <ArrowUpRight size={14} className="text-[#a3a3a3]" />
            </div>
            <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">
              Tips, case studies, and beta announcements
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}

function KpiStrip({ live, drafts, openOrders, totalOrders, unreadMessages, totalRevenue, fresh, freshKey, onTabChange }) {
  return (
    <div
      className="flex items-stretch divide-x divide-[#1f1f1f] border border-[#1f1f1f] overflow-x-auto"
      data-testid="dashboard-kpis"
    >
      <KpiPill
        icon={Box}
        label="Live"
        value={live}
        sub={drafts ? `${drafts} draft${drafts > 1 ? "s" : ""}` : null}
        onClick={() => onTabChange?.("listings")}
        testId="kpi-listings"
      />
      <KpiPill
        icon={ShoppingBag}
        label="Orders"
        value={openOrders}
        sub={totalOrders ? `${totalOrders} total` : "open"}
        onClick={() => onTabChange?.("orders")}
        testId="kpi-orders"
        accent={openOrders > 0}
        pulseKey={fresh.orders ? `o-${freshKey}` : null}
      />
      <KpiPill
        icon={MessageSquare}
        label="DMs"
        value={unreadMessages}
        sub="unread"
        onClick={() => onTabChange?.("messages")}
        testId="kpi-messages"
        accent={unreadMessages > 0}
        pulseKey={fresh.messages ? `m-${freshKey}` : null}
      />
      <KpiPill
        icon={DollarSign}
        label="Revenue"
        value={`$${totalRevenue.toFixed(0)}`}
        sub="all-time"
        onClick={() => onTabChange?.("financials")}
        testId="kpi-revenue"
      />
    </div>
  );
}

// Compact horizontal KPI cell. Was previously a 4-up `KPI` card grid with
// `text-3xl/4xl` numbers that ate the top of the viewport. The strip
// version keeps every number clickable and pulse-able while collapsing
// to ~36% of the previous vertical footprint.
function KpiPill({ icon: Icon, label, value, sub, onClick, testId, accent = false, pulseKey = null }) {
  return (
    <button
      onClick={onClick}
      // `key={pulseKey}` forces a remount when a new event arrives so the
      // CSS animation can re-fire even if the maker is sitting on the
      // dashboard across multiple polling cycles.
      key={pulseKey || testId}
      className={`min-w-[7rem] px-4 py-2.5 text-left transition relative ${
        accent
          ? "bg-[#ff4500]/10 hover:bg-[#ff4500]/20"
          : "hover:bg-[#161616]"
      } ${pulseKey ? "kpi-pulse" : ""}`}
      data-testid={testId}
      data-fresh={pulseKey ? "true" : undefined}
    >
      <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3]">
        <Icon size={10} />
        <span>{label}</span>
        {pulseKey && (
          <span
            className="ml-1 px-1 py-0.5 bg-[#ff4500] text-black font-bold text-[8px] tracking-[0.2em] animate-pulse"
            data-testid={`${testId}-new-flag`}
          >
            NEW
          </span>
        )}
      </div>
      <div className={`font-display text-xl leading-tight mt-0.5 ${accent ? "text-[#ff4500]" : ""}`}>
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[9px] text-[#525252] truncate">{sub}</div>
      )}
    </button>
  );
}

function QuickLink({ to, onClick, icon: Icon, label, testId }) {
  return (
    <button
      onClick={() => onClick?.(to)}
      className="w-full text-left px-4 py-3 border border-[#262626] hover:border-[#ff4500] transition flex items-center justify-between gap-3"
      data-testid={testId}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Icon size={14} className="text-[#a3a3a3] shrink-0" />
        <span className="font-mono text-xs text-[#e5e5e5] uppercase tracking-[0.18em] truncate">
          {label}
        </span>
      </div>
      <span className="font-mono text-[10px] text-[#a3a3a3]">→</span>
    </button>
  );
}
