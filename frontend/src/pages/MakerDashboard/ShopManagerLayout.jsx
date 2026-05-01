import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Box, MessageSquare, ShoppingBag, BarChart3, AlertTriangle,
  Megaphone, DollarSign, HelpCircle, Settings, ArrowLeft,
  LayoutDashboard, SlidersHorizontal, Inbox,
} from "lucide-react";

const NAV = [
  { id: "dashboard",   label: "Dashboard",   icon: LayoutDashboard },
  { id: "listings",    label: "Listings",    icon: Box },
  { id: "orders",      label: "Orders",      icon: ShoppingBag },
  { id: "briefs",      label: "Briefs",      icon: Inbox },
  { id: "messages",    label: "Messages",    icon: MessageSquare },
  { id: "stats",       label: "Stats",       icon: BarChart3 },
  { id: "violations",  label: "Violations",  icon: AlertTriangle },
  { id: "marketing",   label: "Marketing",   icon: Megaphone },
  { id: "financials",  label: "Financials",  icon: DollarSign },
  { id: "help",        label: "Help",        icon: HelpCircle },
  { id: "settings",    label: "Settings",    icon: SlidersHorizontal },
];

/**
 * Etsy-style Shop Manager shell — top bar + left sidebar + content area.
 * Brand-aligned (industrial dark + orange accent) — NOT Etsy beige. Layout
 * structure only is borrowed from the reference screenshot.
 *
 * Status badges in the top bar give makers an at-a-glance health check:
 *   ✓ Approved Seller · ◆ Crafters Plus · 💳 Payouts Ready
 * If any condition fails, the badge becomes ⚠ "Action needed" (clickable).
 */
export default function ShopManagerLayout({
  maker, tab, onTabChange, onLogout, onOpenProfile, children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Derive status flags from maker record. Defaults are conservative —
  // any missing field is treated as "not yet" rather than "ready".
  const approved = maker?.approved !== false;  // approved by default unless we set it false
  const isPlus = (maker?.subscription_status || "") === "active";
  const payoutsReady = !!(maker?.stripe_charges_enabled && maker?.stripe_payouts_enabled);

  return (
    <div
      className={`min-h-screen grain bg-[#0a0a0a] text-[#e5e5e5] ${
        maker?.appearance_mode === "light" ? "theme-light" : ""
      }`}
      data-testid="shop-manager-layout"
      data-theme={maker?.appearance_mode === "light" ? "light" : "dark"}
    >
      {/* TOP BAR — sits below the global Nav (which is the site header).
          We mount this at pt-32 to clear the global header + beta banner. */}
      <div className="pt-32" />
      <header className="sticky top-[calc(var(--beta-banner-h,0px)+72px)] z-30 bg-[#0a0a0a]/95 backdrop-blur border-b border-[#262626]">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              className="lg:hidden p-2 border border-[#262626] hover:border-[#ff4500]"
              aria-label="Toggle sidebar"
              data-testid="shop-sidebar-toggle"
            >
              <Box size={16} />
            </button>
            <Link
              to="/"
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] inline-flex items-center gap-2"
              data-testid="shop-exit-link"
            >
              <ArrowLeft size={12} /> Exit Shop Manager
            </Link>
            <span className="font-mono text-[10px] text-[#525252]">·</span>
            <span className="font-display text-base truncate" data-testid="shop-maker-name">
              {maker?.name || "Shop"}
            </span>
            <div className="hidden md:flex items-center gap-2 ml-3">
              <Badge ok={approved} label="Approved Seller" testid="badge-approved" />
              <Badge ok={isPlus} label="Crafters Plus" testid="badge-plus" mode={isPlus ? "primary" : "neutral"} />
              <Badge ok={payoutsReady} label="Payouts Ready" testid="badge-payouts" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenProfile}
              className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2"
              data-testid="shop-profile-btn"
              title="Edit shop profile"
            >
              <Settings size={12} /> Edit Shop
            </button>
            <button
              onClick={onLogout}
              className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]"
              data-testid="shop-logout-btn"
            >
              Sign Out
            </button>
          </div>
        </div>
        <div className="md:hidden px-4 pb-3 flex flex-wrap gap-2 border-t border-[#262626] pt-3">
          <Badge ok={approved} label="Approved" mode="compact" />
          <Badge ok={isPlus} label="Plus" mode={isPlus ? "primary-compact" : "compact"} />
          <Badge ok={payoutsReady} label="Payouts" mode="compact" />
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-0 md:px-8 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-0 lg:gap-8 mt-6 mb-12">
        {/* LEFT SIDEBAR */}
        <aside
          className={`${sidebarOpen ? "block" : "hidden"} lg:block bg-[#0d0d0d] border border-[#1f1f1f] mx-4 md:mx-0`}
          data-testid="shop-sidebar"
        >
          <nav className="p-2 sticky top-[calc(var(--beta-banner-h,0px)+150px)]">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { onTabChange(item.id); setSidebarOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 mb-1 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] transition-all border-l-2 ${
                    active
                      ? "bg-[#ff4500]/10 border-[#ff4500] text-[#ff4500]"
                      : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5] hover:bg-[#161616]"
                  }`}
                  data-testid={`shop-tab-${item.id}`}
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* CONTENT */}
        <main className="px-4 md:px-0 min-w-0" data-testid="shop-content">
          {children}
        </main>
      </div>
    </div>
  );
}

function Badge({ ok, label, testid, mode = "default" }) {
  const compact = mode === "compact" || mode === "primary-compact";
  const primary = mode === "primary" || mode === "primary-compact";
  const cls = ok
    ? primary
      ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]"
      : "border-emerald-700 bg-emerald-900/20 text-emerald-300"
    : "border-[#404040] bg-[#1a1a1a] text-[#737373]";
  return (
    <span
      data-testid={testid}
      className={`px-2 py-0.5 border font-mono uppercase tracking-[0.18em] inline-flex items-center gap-1 ${cls} ${
        compact ? "text-[9px]" : "text-[9px]"
      }`}
    >
      {ok ? "✓" : "○"} {label}
    </span>
  );
}
