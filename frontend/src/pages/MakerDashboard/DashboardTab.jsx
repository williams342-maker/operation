import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingBag, Box, MessageSquare, AlertTriangle, DollarSign,
  ArrowUpRight, Sparkles, Clock, Package, ChevronDown, Hourglass,
} from "lucide-react";
import PlusUpgradeNudge from "./PlusUpgradeNudge";
import ReferralCard from "./ReferralCard";
import ClipsIncentiveCard from "./ClipsIncentiveCard";
import MakerRankCard from "../../components/maker/MakerRankCard";

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
  pendingBackorders = 0,
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
    // Orders expose `order_status` (pending|fulfilled), not a flat
    // `status` field — fulfilled = the maker has marked it shipped.
    () => orders.filter((o) => (o.order_status || "pending").toLowerCase() !== "fulfilled"),
    [orders],
  );
  const totalRevenue = useMemo(
    () => orders.reduce((s, o) => s + (Number(o.total_cents || 0) / 100), 0),
    [orders],
  );
  // Split the "recent orders" surface into two purposeful columns:
  //   • Awaiting shipment — un-fulfilled paid orders, oldest-first so the
  //     ones rotting longest land at the top. This is the maker's daily
  //     to-do list — it should never get buried under fulfilled rows.
  //   • Recent fulfilled — last 5 shipped orders, newest-first. Provides
  //     dopamine + audit trail without competing for attention.
  // Refunded/cancelled rows are excluded from both — they live in the
  // Orders tab archive where they belong.
  const awaitingShipment = useMemo(
    () => orders
      .filter((o) => {
        const fulfilled = (o.order_status || "pending").toLowerCase() === "fulfilled";
        const pay = (o.payment_status || "").toLowerCase();
        return !fulfilled && pay !== "refunded" && pay !== "cancelled";
      })
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))
      .slice(0, 5),
    [orders],
  );
  const recentFulfilled = useMemo(
    () => orders
      .filter((o) => (o.order_status || "").toLowerCase() === "fulfilled")
      .sort((a, b) => (b.shipped_at || b.created_at || "").localeCompare(a.shipped_at || a.created_at || ""))
      .slice(0, 5),
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
          pendingBackorders={pendingBackorders}
          totalRevenue={totalRevenue}
          fresh={fresh}
          freshKey={freshKey}
          onTabChange={onTabChange}
        />
      </header>

      {/* iter335.17 — Maker rank widget (closes leaderboard feedback loop) */}
      <MakerRankCard />

      {/* TODAY — actionable alerts surface. Defaults open when there are
          high-priority items, collapsed when everything's quiet (so it
          never adds noise on a clean dashboard). Each alert has a CTA
          that jumps to the relevant tab. */}
      <TodayAlerts
        maker={maker}
        orders={orders}
        products={products}
        unreadMessages={unreadMessages}
        onTabChange={onTabChange}
      />

      {/* FOUNDING-50 CLIPS — promotes the new Clip Feed incentive to every
          approved maker. Self-hides once the cap is hit or the maker
          dismisses it (localStorage). Sits above the Plus nudge so it
          gets visible-without-scroll real estate during launch. */}
      <ClipsIncentiveCard />

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

      {/* Plus trial referral program — open to all makers (free-tier
          can also bank invites, applied once they start their own trial). */}
      <ReferralCard />

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

      {/* RECENT ORDERS · split into two columns + QUICK LINKS sidebar.
          Left column = action items (awaiting shipment, oldest-first).
          Right column = recently fulfilled (audit trail, newest-first).
          Quick links column hugs the right edge as before. */}
      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 grid md:grid-cols-2 gap-4" data-testid="dashboard-recent-orders">
          <OrderColumn
            tone="orange"
            eyebrow="◆ Action needed"
            title="Awaiting shipment"
            count={awaitingShipment.length}
            orders={awaitingShipment}
            emptyText="Nothing waiting — every paid order is shipped."
            onTabChange={onTabChange}
            testId="dashboard-awaiting-orders"
          />
          <OrderColumn
            tone="emerald"
            eyebrow="◆ Recent"
            title="Fulfilled"
            count={recentFulfilled.length}
            orders={recentFulfilled}
            emptyText="No fulfilled orders yet — they'll land here after you ship."
            onTabChange={onTabChange}
            testId="dashboard-fulfilled-orders"
          />
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
          {/* Authoring CTA — sits directly under the read link so the
              two journal-related actions cluster naturally. Orange accent
              + ✏ glyph mark this as an action (vs. the read links above
              which just navigate away). */}
          <Link
            to="/maker/journal/new"
            className="block px-4 py-3 border border-[#ff4500]/40 bg-[#1a0a05] hover:border-[#ff4500] transition"
            data-testid="ql-journal-write"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-[#ff4500] uppercase tracking-[0.18em]">
                ✏ Write a journal post
              </span>
              <ArrowUpRight size={14} className="text-[#ff4500]" />
            </div>
            <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">
              Publish a process, technique, or shop story to /journal
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}

/** Two-up "recent orders" column — same density as the old single list,
 *  but partitioned so action items can never get buried under fulfilled
 *  rows. Tone drives the eyebrow accent: orange for "ship now", emerald
 *  for the audit trail. */
function OrderColumn({ tone, eyebrow, title, count, orders, emptyText, onTabChange, testId }) {
  const accent = tone === "emerald" ? "text-emerald-400" : "text-[#ff4500]";
  return (
    <div className="border border-[#262626] p-5" data-testid={testId}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className={`font-mono text-[10px] uppercase tracking-[0.22em] ${accent} mb-1`}>
            {eyebrow}
          </div>
          <h2 className="font-display text-lg uppercase">
            {title} {count > 0 && <span className={`${accent}`}>· {count}</span>}
          </h2>
        </div>
        <button
          onClick={() => onTabChange?.("orders")}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition shrink-0"
          data-testid={`${testId}-all`}
        >
          View all →
        </button>
      </div>
      {orders.length === 0 ? (
        <div className="font-mono text-xs text-[#525252] py-6 text-center">{emptyText}</div>
      ) : (
        <ul className="divide-y divide-[#1f1f1f]">
          {orders.map((o, idx) => (
            <li
              key={`${o.session_id || o.id || o.created_at || "order"}-${idx}`}
              className="py-3 flex items-center justify-between gap-3"
              data-testid={`${testId}-row-${o.session_id || o.id || idx}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-[#e5e5e5] truncate">
                  #{(o.session_id || o.id || "").slice(0, 8)} · {o.buyer_email || "—"}
                </div>
                <div className="font-mono text-[10px] text-[#a3a3a3] mt-0.5">
                  {(o.order_status || "pending").toUpperCase()} · {(o.created_at || "").slice(0, 10)}
                </div>
              </div>
              <div className="font-display text-lg shrink-0">
                ${((o.total_cents || 0) / 100).toFixed(0)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiStrip({ live, drafts, openOrders, totalOrders, unreadMessages, pendingBackorders, totalRevenue, fresh, freshKey, onTabChange }) {
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
      {/* Backorders KPI — only renders when the maker has at least one
          pending request. Keeps the strip clean for makers who never
          enabled backorders, but immediately surfaces incoming requests
          for those who did. */}
      {pendingBackorders > 0 && (
        <KpiPill
          icon={Hourglass}
          label="Backorders"
          value={pendingBackorders}
          sub="pending"
          onClick={() => onTabChange?.("orders")}
          testId="kpi-backorders"
          accent
        />
      )}
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


// ---------------------------------------------------------------------------
// TODAY alerts — Etsy-style "action items" panel
// ---------------------------------------------------------------------------
//
// Why a panel instead of just dropping these into the existing checklist?
// The checklist is one-shot onboarding (clears once you complete it). The
// Today panel is recurring — it re-fires daily for shipping deadlines,
// expiring listings, low stock, etc. They're different mental categories
// and conflating them dilutes both.
//
// Tone hierarchy:
//   • danger — late shipments, payout setup missing → red border
//   • warn   — listings expiring this week, low stock, unread DMs → amber
//   • info   — gentle nudges (no orders yet, etc.) → neutral grey
//
// Default behavior:
//   • If any DANGER alerts → panel auto-expands.
//   • If only WARN/INFO   → panel collapsed (one-line summary only).
//   • If zero alerts      → renders nothing (silent on a healthy dashboard).
function TodayAlerts({ maker, orders, products, unreadMessages, onTabChange }) {
  const alerts = useMemo(() => {
    const out = [];
    const now = Date.now();
    const dayMs = 86400 * 1000;

    // --- Late shipments: orders pending > 3 days ---
    // Maker orders expose `order_status` ("pending" | "fulfilled") and
    // `payment_status` ("paid" | "unpaid" | "refunded") — there is NO
    // flat `status` field, so the previous `o.status` lookup always
    // returned "" and shipped orders kept showing as "awaiting
    // shipment". Filter on the actual lifecycle fields instead.
    orders.forEach((o) => {
      const orderStatus = (o.order_status || "pending").toLowerCase();
      const paymentStatus = (o.payment_status || "").toLowerCase();
      // Only nudge for orders that are paid AND still pending fulfillment.
      // Skip anything fulfilled (shipped) / refunded / cancelled.
      if (orderStatus === "fulfilled") return;
      if (paymentStatus === "refunded" || paymentStatus === "cancelled") return;
      const created = o.created_at ? new Date(o.created_at).getTime() : 0;
      if (!created) return;
      const ageDays = Math.floor((now - created) / dayMs);
      if (ageDays >= 3) {
        out.push({
          tone: "danger",
          icon: Clock,
          label: `Order #${(o.session_id || o.id || "").slice(0, 8)} awaiting shipment`,
          detail: `${ageDays} day${ageDays > 1 ? "s" : ""} since the buyer paid.`,
          cta: { label: "Ship now →", target: "orders" },
          key: `late-${o.session_id || o.id}`,
        });
      }
    });

    // --- Stripe payouts not connected ---
    if (!maker?.stripe_charges_enabled || !maker?.stripe_payouts_enabled) {
      out.push({
        tone: "danger",
        icon: DollarSign,
        label: "Connect Stripe to receive payouts",
        detail: "We can't send money until your Stripe account is set up.",
        cta: { label: "Set up payouts →", target: "financials" },
        key: "stripe-missing",
      });
    }

    // --- Listings expiring this week ---
    const expiringSoon = (products || []).filter((p) => {
      if (p.deleted_at || p.status === "draft") return false;
      if (!p.expires_at) return false;
      const exp = new Date(p.expires_at).getTime();
      return exp > now && exp - now < 7 * dayMs;
    });
    if (expiringSoon.length > 0) {
      out.push({
        tone: "warn",
        icon: Clock,
        label: `${expiringSoon.length} listing${expiringSoon.length > 1 ? "s" : ""} expiring within 7 days`,
        detail: "Renew them to keep buyers landing on the page.",
        cta: { label: "Manage listings →", target: "listings" },
        key: "expiring",
      });
    }

    // --- Low stock (in_stock <= 1, only on live listings) ---
    const lowStock = (products || []).filter(
      (p) => !p.deleted_at && p.status !== "draft" && (p.in_stock || 0) <= 1,
    );
    if (lowStock.length > 0) {
      out.push({
        tone: "warn",
        icon: Package,
        label: `${lowStock.length} listing${lowStock.length > 1 ? "s" : ""} low on stock`,
        detail: "1 unit or fewer — bump the count or buyers will see 'sold out'.",
        cta: { label: "Update stock →", target: "listings" },
        key: "lowstock",
      });
    }

    // --- Unread DMs (only flag when count is non-trivial) ---
    if (unreadMessages > 0) {
      out.push({
        tone: "warn",
        icon: MessageSquare,
        label: `${unreadMessages} unread message${unreadMessages > 1 ? "s" : ""}`,
        detail: "Buyers expect a reply within 24 hours.",
        cta: { label: "Open messages →", target: "messages" },
        key: "unread-dms",
      });
    }

    // --- Beta countdown ---
    // Field on the Maker model is `beta_expires_at` (not
    // `maker_beta_expires_at`) — the previous prefix typo meant this
    // alert never fired even when a maker's Founding Seller window
    // was about to lapse.
    if (maker?.beta_expires_at) {
      const exp = new Date(maker.beta_expires_at).getTime();
      const daysLeft = Math.ceil((exp - now) / dayMs);
      if (daysLeft > 0 && daysLeft <= 14) {
        out.push({
          tone: "warn",
          icon: AlertTriangle,
          label: `Founding Seller beta ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          detail: "Your reduced commission rate expires soon.",
          cta: { label: "Plan ahead →", target: "settings" },
          key: "beta-soon",
        });
      }
    }

    return out;
  }, [maker, orders, products, unreadMessages]);

  const hasDanger = alerts.some((a) => a.tone === "danger");
  // Default open whenever there's something to show — auto-collapses
  // entirely when the maker hits zero alerts (handled below).
  const [open, setOpen] = useState(true);

  if (alerts.length === 0) return null;

  const dangerCount = alerts.filter((a) => a.tone === "danger").length;
  const warnCount = alerts.filter((a) => a.tone === "warn").length;

  return (
    <section
      className={`border ${hasDanger ? "border-red-700/60" : "border-amber-700/40"} bg-[#0d0d0d]`}
      data-testid="today-alerts"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#161616] transition"
        aria-expanded={open}
        data-testid="today-alerts-toggle"
      >
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.22em] ${
            hasDanger ? "text-red-400" : "text-amber-400"
          }`}
        >
          ◆ Today
        </span>
        <span className="font-mono text-[11px] text-[#e5e5e5]">
          {alerts.length} item{alerts.length > 1 ? "s" : ""} need{alerts.length === 1 ? "s" : ""} you
          {dangerCount > 0 && <span className="text-red-400 ml-2">· {dangerCount} urgent</span>}
          {warnCount > 0 && <span className="text-amber-400 ml-2">· {warnCount} warning{warnCount > 1 ? "s" : ""}</span>}
        </span>
        <ChevronDown
          size={14}
          className={`ml-auto text-[#a3a3a3] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul className="divide-y divide-[#1f1f1f] border-t border-[#1f1f1f]" data-testid="today-alerts-list">
          {alerts.map((a) => (
            <AlertRow key={a.key} alert={a} onTabChange={onTabChange} />
          ))}
        </ul>
      )}
    </section>
  );
}

const TONE_STYLE = {
  danger: { dot: "bg-red-500", text: "text-red-400" },
  warn: { dot: "bg-amber-500", text: "text-amber-400" },
  info: { dot: "bg-[#525252]", text: "text-[#a3a3a3]" },
};

function AlertRow({ alert, onTabChange }) {
  const style = TONE_STYLE[alert.tone] || TONE_STYLE.info;
  const Icon = alert.icon;
  return (
    <li
      className="flex items-start gap-3 px-4 py-3"
      data-testid={`today-alert-${alert.key}`}
    >
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
      <Icon size={14} className={`mt-0.5 shrink-0 ${style.text}`} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-[#e5e5e5]">{alert.label}</div>
        <div className="font-mono text-[10px] text-[#737373] mt-0.5">{alert.detail}</div>
      </div>
      {alert.cta && (
        <button
          type="button"
          onClick={() => onTabChange?.(alert.cta.target)}
          className="shrink-0 px-3 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.22em] transition"
          data-testid={`today-alert-cta-${alert.key}`}
        >
          {alert.cta.label}
        </button>
      )}
    </li>
  );
}
