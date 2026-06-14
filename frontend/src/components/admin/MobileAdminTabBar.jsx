import React, { useEffect, useMemo, useState } from "react";
import {
  Inbox, FileText, ShieldAlert, ListChecks, MoreHorizontal,
  Search, X, Pin, PinOff,
} from "lucide-react";
import {
  recordTabPick, partitionByPins, togglePin, getPinnedIds,
} from "../../lib/adminTabFrecency";

/**
 * MobileAdminTabBar — fixed bottom navigation for the admin dashboard
 * on small screens (sm + below). Mirrors iOS / native app patterns: 5
 * thumb-reachable buttons with icon + tiny label.
 *
 * The slot list is fixed to the 4 highest-frequency admin tabs + a
 * "More" button that opens a full-tab sheet (iter413q) — previously
 * scrolled the page back to the top horizontal nav, which forced the
 * admin to thumb through a sideways scroller. Now a slide-up sheet
 * lists every tab with a search filter for power users.
 *
 * Hidden on lg+ where the sidebar is always visible.
 *
 * Visibility is also gated by capabilities: if the signed-in admin's
 * `visibleTabs` doesn't include a given quick-action tab, that slot
 * is replaced with a fallback so the bar always shows 5 reachable
 * destinations.
 */
const PREFERRED_ORDER = [
  { id: "applications", icon: Inbox, label: "Apps" },
  { id: "orders", icon: FileText, label: "Orders" },
  { id: "showcase-mod", icon: ShieldAlert, label: "Mod" },
  { id: "listings", icon: ListChecks, label: "Listings" },
];

export default function MobileAdminTabBar({ visibleTabs = [], current, onPick }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  // iter413ab — `pinsTick` bumps on every pin toggle so the
  // bottom-bar slot computation (which reads pins via getPinnedIds)
  // re-runs without state thrash. Declared up here so both the slot
  // memo below AND the sheet partition memo below that can depend on it.
  const [pinsTick, setPinsTick] = useState(0);

  // Lock body scroll while the all-tabs sheet is open so the page
  // behind doesn't scroll-jack when users flick through the list.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [sheetOpen]);

  // ESC closes the sheet (keyboard accessibility on tablet keyboards).
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setSheetOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  // iter413ab — Auto-promote pinned tabs into the bottom-bar slots.
  // If admin has 4+ pinned tabs, the bottom bar swaps the hardcoded
  // PREFERRED_ORDER quick-actions for their top-4 pins. Power users
  // get a personalized launcher; first-time admins keep the sensible
  // defaults. The "More" sheet still lists everything regardless of
  // mode. Re-computes on every pinsTick bump so toggling a pin
  // updates the bottom bar live.
  const visibleIds = new Set(visibleTabs.map((t) => t.id));
  const promotedFromPins = (() => {
    const pinIds = getPinnedIds();
    // Only fire promote-mode when 4+ pins exist AND they map to
    // currently-visible tabs (capability-gated tabs may be hidden).
    const reachable = pinIds.filter((id) => visibleIds.has(id));
    if (reachable.length < 4) return null;
    return reachable.slice(0, 4).map((id) => {
      const tab = visibleTabs.find((t) => t.id === id);
      const preset = PREFERRED_ORDER.find((p) => p.id === id);
      return {
        id,
        icon: preset?.icon || ListChecks,  // fallback for tabs not in PREFERRED_ORDER
        label: preset?.label || tab.label,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })();
  // Re-run when pinsTick changes so toggling a pin updates the bottom
  // bar immediately. Reference pinsTick here to register the dep.
  void pinsTick;

  const used = new Set();
  const slots = promotedFromPins || PREFERRED_ORDER.map((slot) => {
    if (visibleIds.has(slot.id)) {
      used.add(slot.id);
      return slot;
    }
    // Find a usable fallback that isn't already in `used`
    const fallback = visibleTabs.find((t) => !used.has(t.id) && !PREFERRED_ORDER.some((s) => s.id === t.id));
    if (fallback) {
      used.add(fallback.id);
      return { id: fallback.id, icon: ListChecks, label: fallback.label };
    }
    return null;
  }).filter(Boolean);

  const pickFromSheet = (id) => {
    // iter413t — Record the tap for frecency reordering. The next time
    // the sheet opens, this tab will be promoted toward the top.
    recordTabPick(id);
    onPick(id);
    setSheetOpen(false);
    setQuery("");
  };

  // iter413v — Partition tabs into PINNED zone + frecency-sorted
  // ALL-OTHERS zone, snapshotted at sheet-open + on pin-toggle. Pinned
  // tabs always sit at top, in pin-order; everything else follows
  // recency × frequency ranking. Bumping `pinsTick` after a toggle
  // forces re-partitioning without reopening the sheet.
  const { pinned, others } = useMemo(() => {
    if (!sheetOpen) return { pinned: [], others: visibleTabs };
    return partitionByPins(visibleTabs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen, visibleTabs.length, pinsTick]);

  const filterFn = (t) => !query.trim()
    || (t.label || "").toLowerCase().includes(query.trim().toLowerCase());
  const filteredPinned = pinned.filter(filterFn);
  const filteredOthers = others.filter(filterFn);
  const totalFiltered = filteredPinned.length + filteredOthers.length;

  const handleTogglePin = (e, id) => {
    // Prevent the row click (which would navigate) from firing.
    e.stopPropagation();
    e.preventDefault();
    togglePin(id);
    setPinsTick((n) => n + 1);
  };

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 bg-paper border-t border-line z-30"
        data-testid="mobile-admin-tab-bar"
        aria-label="Admin quick navigation"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="grid grid-cols-5">
          {slots.map(({ id, icon: Icon, label }) => {
            const active = current === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => { recordTabPick(id); onPick(id); }}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 transition ${
                  active
                    ? "text-brand"
                    : "text-ink-muted hover:text-ink"
                }`}
                aria-current={active ? "page" : undefined}
                data-testid={`mobile-admin-tab-${id}`}
              >
                <Icon size={18} strokeWidth={active ? 2.2 : 1.7} />
                <span className="font-mono text-[9px] uppercase tracking-[0.18em]">{label}</span>
                {active && (
                  <span className="absolute bottom-0 h-[2px] w-8 bg-brand" aria-hidden />
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2.5 text-ink-muted hover:text-ink"
            data-testid="mobile-admin-tab-more"
            title="Browse all admin tabs"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
          >
            <MoreHorizontal size={18} strokeWidth={1.7} />
            <span className="font-mono text-[9px] uppercase tracking-[0.18em]">More</span>
          </button>
        </div>
      </nav>

      {/* iter413q — All-tabs sheet. Renders only when open so the
          200px+ DOM lump isn't paid for on every render. */}
      {sheetOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 flex items-end"
          role="dialog"
          aria-modal="true"
          aria-label="All admin tabs"
          data-testid="mobile-admin-tabs-sheet"
        >
          {/* Backdrop — tap to dismiss */}
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-paper/80 backdrop-blur-sm"
            aria-label="Close tab sheet"
            data-testid="mobile-admin-tabs-sheet-backdrop"
          />
          <div
            className="relative w-full bg-paper border-t border-line max-h-[80vh] flex flex-col animate-[slideUp_0.18s_ease-out]"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            {/* Drag handle (visual only) */}
            <div className="pt-2 pb-1 flex justify-center">
              <div className="w-10 h-1 bg-line rounded-full" aria-hidden />
            </div>
            {/* Sheet header */}
            <div className="flex items-center justify-between px-4 pb-3 border-b border-line">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">
                ◆ All Tabs · {visibleTabs.length}
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-brand transition"
                aria-label="Close"
                data-testid="mobile-admin-tabs-sheet-close"
              >
                <X size={16} />
              </button>
            </div>
            {/* Search */}
            <div className="px-4 py-3 border-b border-line">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
                  aria-hidden
                />
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter tabs…"
                  className="w-full pl-8 pr-3 py-2 bg-surface border border-line focus:border-brand outline-none font-mono text-xs text-ink placeholder:text-ink-muted transition"
                  data-testid="mobile-admin-tabs-sheet-search"
                />
              </div>
            </div>
            {/* Tab list — Pinned zone above All-Others zone */}
            <ul
              className="flex-1 overflow-y-auto"
              data-testid="mobile-admin-tabs-sheet-list"
            >
              {totalFiltered === 0 ? (
                <li className="px-4 py-8 text-center font-mono text-xs text-ink-muted">
                  No tabs match &ldquo;{query}&rdquo;.
                </li>
              ) : (
                <>
                  {filteredPinned.length > 0 && (
                    <li
                      className="px-4 py-2 font-mono text-[9px] uppercase tracking-[0.3em] text-brand bg-surface border-b border-line/50"
                      data-testid="mobile-admin-tabs-sheet-pinned-header"
                    >
                      ◆ Pinned · {filteredPinned.length}
                    </li>
                  )}
                  {filteredPinned.map((t) => (
                    <TabRow
                      key={`pin-${t.id}`}
                      tab={t}
                      pinned
                      active={current === t.id}
                      onPick={pickFromSheet}
                      onTogglePin={handleTogglePin}
                    />
                  ))}
                  {filteredPinned.length > 0 && filteredOthers.length > 0 && (
                    <li
                      className="px-4 py-2 font-mono text-[9px] uppercase tracking-[0.3em] text-ink-muted bg-surface border-b border-line/50"
                      data-testid="mobile-admin-tabs-sheet-others-header"
                    >
                      ◆ All Tabs · {filteredOthers.length}
                    </li>
                  )}
                  {filteredOthers.map((t) => (
                    <TabRow
                      key={t.id}
                      tab={t}
                      pinned={false}
                      active={current === t.id}
                      onPick={pickFromSheet}
                      onTogglePin={handleTogglePin}
                    />
                  ))}
                </>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Single tab row inside the sheet. Renders the label as a tap target
 * (selects the tab) and a small pin handle on the right (toggles pin
 * state without selecting). The pin button uses `stopPropagation` in
 * the handler so a careful tap on the handle never accidentally
 * triggers a navigation.
 */
function TabRow({ tab, active, pinned, onPick, onTogglePin }) {
  return (
    <li className="flex items-stretch border-b border-line/50">
      <button
        type="button"
        onClick={() => onPick(tab.id)}
        className={`flex-1 text-left px-4 py-3 font-mono text-xs uppercase tracking-[0.2em] transition flex items-center justify-between ${
          active ? "text-brand bg-brand/5" : "text-ink hover:bg-surface"
        }`}
        data-testid={`mobile-admin-tabs-sheet-${tab.id}`}
      >
        <span>{tab.label}</span>
        {active && <span aria-hidden className="text-brand">●</span>}
      </button>
      <button
        type="button"
        onClick={(e) => onTogglePin(e, tab.id)}
        aria-label={pinned ? `Unpin ${tab.label}` : `Pin ${tab.label} to top`}
        title={pinned ? "Unpin" : "Pin to top"}
        className={`shrink-0 w-12 flex items-center justify-center transition border-l border-line/50 ${
          pinned ? "text-brand hover:bg-brand/10" : "text-ink-muted hover:text-brand hover:bg-surface"
        }`}
        data-testid={`mobile-admin-tabs-sheet-pin-${tab.id}`}
      >
        {pinned ? <Pin size={13} fill="currentColor" /> : <PinOff size={13} />}
      </button>
    </li>
  );
}
