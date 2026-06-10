import React from "react";
import {
  Inbox, FileText, ShieldAlert, ListChecks, MoreHorizontal,
} from "lucide-react";

/**
 * MobileAdminTabBar — fixed bottom navigation for the admin dashboard
 * on small screens (sm + below). Mirrors iOS / native app patterns: 5
 * thumb-reachable buttons with icon + tiny label.
 *
 * The slot list is fixed to the 4 highest-frequency admin tabs + a
 * "More" button that scrolls the top horizontal nav back into view
 * (where every other tab lives). The fixed 4 are chosen to cover the
 * three actionable moderation surfaces (applications · contact inbox ·
 * showcase mod) plus the most-checked queue (paid orders).
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
  // Build the 4 actionable slots, falling back to the first visible
  // unused tab if any of the preferred IDs are hidden by capabilities.
  const visibleIds = new Set(visibleTabs.map((t) => t.id));
  const used = new Set();
  const slots = PREFERRED_ORDER.map((slot) => {
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

  const onMore = () => {
    // Scroll the top horizontal tab nav into view so the admin can
    // pick anything not in the quick-action set.
    const nav = document.querySelector('[data-testid="admin-tabs"]');
    if (nav) {
      nav.scrollIntoView({ behavior: "smooth", block: "start" });
      // Add a brief highlight pulse so the eye lands on it
      nav.animate(
        [
          { boxShadow: "0 0 0 2px rgba(255,69,0,0.6)" },
          { boxShadow: "0 0 0 0 rgba(255,69,0,0)" },
        ],
        { duration: 1100, easing: "ease-out" },
      );
    }
  };

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 bg-paper border-t border-line z-30"
      data-testid="mobile-admin-tab-bar"
      aria-label="Admin quick navigation"
    >
      <div className="grid grid-cols-5">
        {slots.map(({ id, icon: Icon, label }) => {
          const active = current === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className={`flex flex-col items-center gap-0.5 py-2.5 transition ${
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
          onClick={onMore}
          className="flex flex-col items-center gap-0.5 py-2.5 text-ink-muted hover:text-ink"
          data-testid="mobile-admin-tab-more"
          title="Scroll the full tab list into view"
        >
          <MoreHorizontal size={18} strokeWidth={1.7} />
          <span className="font-mono text-[9px] uppercase tracking-[0.18em]">More</span>
        </button>
      </div>
    </nav>
  );
}
