import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Hammer, Check, Mail, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import ProductEditCard from "./ProductEditCard";
import EmptyState from "../../components/EmptyState";
import { useConfirm } from "./useConfirm";
import {
  restoreMakerProduct, purgeMakerProduct, fetchMakerRestockWaitlist,
  fetchMakerProductsStats, fetchMakerProductsIndexingStatus,
  fetchListingBudgets,
} from "../../lib/api";

/**
 * Listings hub for makers, with three top-level views:
 *   • Live     — published, not deleted (default — what buyers see)
 *   • Drafts   — saved but not yet published
 *   • Archived — soft-deleted (recoverable from this view)
 *
 * Why a tab toggle instead of stacking sections vertically?
 * Active makers eventually accumulate dozens of archived listings (sold-out
 * runs, seasonal pieces, deprecated SKUs). Stacking them inline pushed the
 * useful "live" listings above the fold off-screen the moment a maker had
 * 5+ products. The toggle keeps the default view tight while preserving
 * one-click access to the archive for restoration.
 *
 * Archived view also enables a bulk-action toolbar (Restore selected /
 * Delete permanently). Selection state lives here, not on the card, so
 * the toolbar can also drive Select all / Clear without each card
 * re-managing its own checkbox.
 */
const VIEWS = [
  { key: "live", label: "Live", color: "text-[#e5e5e5]" },
  { key: "drafts", label: "Drafts", color: "text-amber-400" },
  { key: "archived", label: "Archived", color: "text-red-400" },
];

export default function ProductsList({ products, onChanged, onRefresh }) {
  const navigate = useNavigate();
  const refresh = onChanged || onRefresh || (() => {});
  const goNew = () => navigate("/maker/listings/new");
  const [view, setView] = useState("live");
  // Slugs the maker has selected in the Archived view. Reset on view switch
  // and on every refresh so we don't keep ghost slugs that no longer exist.
  const [selected, setSelected] = useState(new Set());
  // Etsy-style: toggle the per-card stats overlay (visits/sales/renewals).
  // Persisted in localStorage so the preference survives reloads.
  const [showStats, setShowStats] = useState(() => {
    try { return localStorage.getItem("cm_listing_stats_on") === "1"; } catch { return false; }
  });
  const [statsMap, setStatsMap] = useState({});
  useEffect(() => {
    if (!showStats) return;
    let cancelled = false;
    fetchMakerProductsStats()
      .then((d) => { if (!cancelled) setStatsMap(d || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showStats, products.length]);

  // Indexing status — always fetched (cheap, single call). Drives the small
  // sitemap-status badge on each card so makers can see at a glance which
  // listings have been submitted to search engines vs are stuck in drafts.
  const [indexingMap, setIndexingMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    fetchMakerProductsIndexingStatus()
      .then((d) => { if (!cancelled) setIndexingMap(d || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [products.length]);

  // iter315b — Per-listing marketing budgets. Fetched once per
  // listing list mount + after the inline "Save budget" popover
  // commits (via `refreshBudgets`). Keyed by `product_slug` so the
  // ProductEditCard can light up the "$ Budget · $X/mo" pill and
  // preload the popover with current values.
  const [budgetMap, setBudgetMap] = useState({});
  const [budgetVersion, setBudgetVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchListingBudgets()
      .then((d) => {
        if (cancelled) return;
        const map = {};
        for (const b of d?.budgets || []) {
          map[b.product_slug] = b;
        }
        setBudgetMap(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [products.length, budgetVersion]);
  const refreshBudgets = () => setBudgetVersion((v) => v + 1);
  const toggleStats = () => {
    setShowStats((v) => {
      const next = !v;
      try { localStorage.setItem("cm_listing_stats_on", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const live = products.filter((p) => !p.deleted_at && p.status !== "draft");
  const drafts = products.filter((p) => !p.deleted_at && p.status === "draft");
  const archived = products.filter((p) => p.deleted_at);

  const counts = { live: live.length, drafts: drafts.length, archived: archived.length };
  const totalAll = counts.live + counts.drafts + counts.archived;

  // Restock waitlist demand — surfaces buyers waiting on 0-stock SKUs
  // so the maker knows which listings to refill. One aggregate banner
  // keeps the view uncluttered; per-listing breakdown is one click away.
  const [restockDemand, setRestockDemand] = useState(null);
  useEffect(() => {
    fetchMakerRestockWaitlist()
      .then((d) => setRestockDemand(d))
      .catch(() => setRestockDemand(null));
  }, []);

  const switchView = (k) => {
    setView(k);
    setSelected(new Set());
  };

  const refreshAndClear = () => {
    setSelected(new Set());
    refresh();
  };

  return (
    <div className="space-y-8" data-testid="products-list">
      {restockDemand && restockDemand.total_pending > 0 && (
        <div
          className="border border-[#ff4500]/40 bg-[#ff4500]/5 px-4 py-3 flex items-start gap-3"
          data-testid="restock-demand-banner"
        >
          <Mail size={16} className="text-[#ff4500] mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500]">
              ◆ Restock demand · {restockDemand.total_pending} {restockDemand.total_pending === 1 ? "buyer" : "buyers"} waiting
            </div>
            <div className="font-mono text-xs text-[#e5e5e5] mt-1.5 leading-relaxed">
              {restockDemand.products.slice(0, 3).map((p, i) => (
                <span key={p.product_id}>
                  {i > 0 && " · "}
                  <span className="text-[#e5e5e5]">{p.product_title}</span>
                  <span className="text-[#a3a3a3]"> ({p.count})</span>
                </span>
              ))}
              {restockDemand.products.length > 3 && (
                <span className="text-[#525252]"> +{restockDemand.products.length - 3} more</span>
              )}
            </div>
            <p className="font-mono text-[10px] text-[#a3a3a3] mt-1.5 leading-relaxed">
              Raise stock on any of these listings → every waitlisted buyer gets an automatic "back in stock" email.
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          ◆ {counts.live} live
          {counts.drafts > 0 && ` · ${counts.drafts} draft${counts.drafts > 1 ? "s" : ""}`}
          {counts.archived > 0 && ` · ${counts.archived} archived`}
        </div>
        <div className="flex items-center gap-3">
          {/* Stats toggle — mirrors Etsy's "Stats" switch on the listings
              table. When ON, every card overlays its 30-day visits, all-time
              sales, revenue, and lifetime renewals. */}
          <button
            type="button"
            onClick={toggleStats}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
              showStats
                ? "border-[#ff4500] bg-[#ff4500] text-[#0a0a0a]"
                : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500] hover:text-[#ff4500]"
            }`}
            data-testid="products-stats-toggle"
            aria-pressed={showStats}
          >
            <BarChart3 size={12} /> Stats {showStats ? "ON" : "OFF"}
          </button>
          <button
            onClick={goNew}
            className="btn-industrial btn-primary"
            data-testid="new-listing-btn"
          >
            + New Listing
          </button>
        </div>
      </div>

      {totalAll === 0 ? (
        <EmptyState
          icon={Hammer}
          eyebrow="◆ Workshop"
          title="Time to build."
          body="Your shop is live but empty. Add your first piece — buyers and our auto-newsletter will see it the moment you publish."
          cta={{ label: "+ New Listing", onClick: goNew, testId: "products-empty-cta" }}
          testId="products-empty"
        />
      ) : (
        <>
          <ViewSwitcher view={view} setView={switchView} counts={counts} />
          {view === "live" && (
            <Bucket
              items={live}
              testId="live-section"
              empty={
                <p className="font-mono text-xs text-[#525252]" data-testid="live-empty">
                  No live listings yet — publish a draft or create a new one.
                </p>
              }
              onChanged={refresh}
              onBudgetChanged={refreshBudgets}
              showStats={showStats}
              statsMap={statsMap}
              indexingMap={indexingMap}
              budgetMap={budgetMap}
            />
          )}
          {view === "drafts" && (
            <Bucket
              items={drafts}
              testId="drafts-section"
              empty={
                <p className="font-mono text-xs text-[#525252]" data-testid="drafts-empty">
                  No drafts. New listings save here automatically until you publish.
                </p>
              }
              onChanged={refresh}
              onBudgetChanged={refreshBudgets}
              cardProps={{ draft: true }}
              showStats={showStats}
              statsMap={statsMap}
              indexingMap={indexingMap}
              budgetMap={budgetMap}
            />
          )}
          {view === "archived" && (
            <ArchivedView
              items={archived}
              selected={selected}
              setSelected={setSelected}
              onChanged={refreshAndClear}
            />
          )}
        </>
      )}
    </div>
  );
}

function ViewSwitcher({ view, setView, counts }) {
  return (
    <div
      className="inline-flex border border-[#262626] divide-x divide-[#262626] overflow-x-auto"
      role="tablist"
      data-testid="products-view-switcher"
    >
      {VIEWS.map((v) => {
        const isActive = view === v.key;
        const count = counts[v.key];
        return (
          <button
            key={v.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => setView(v.key)}
            data-testid={`products-view-${v.key}`}
            className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] transition ${
              isActive
                ? "bg-[#ff4500] text-black"
                : `bg-transparent ${v.color} hover:text-[#ff4500]`
            }`}
          >
            {v.label} <span className="opacity-60">· {count}</span>
          </button>
        );
      })}
    </div>
  );
}

function Bucket({ items, testId, empty, onChanged, onBudgetChanged, cardProps = {}, banner = null, showStats = false, statsMap = {}, indexingMap = {}, budgetMap = {} }) {
  if (items.length === 0) {
    return (
      <section data-testid={testId} className="border border-dashed border-[#262626] p-8">
        {empty}
      </section>
    );
  }
  return (
    <section data-testid={testId}>
      {banner}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {items.map((p) => {
          // Decorate the product row with the maker's saved marketing
          // budget (if any) so the ProductEditCard pill renders the
          // current cap + auto-renew state without a per-card fetch.
          const b = budgetMap[p.slug];
          const decorated = b
            ? {
                ...p,
                marketing_budget_cents: b.monthly_cap_cents,
                marketing_budget_auto_renew: b.auto_renew,
                marketing_budget_spent_cents: b.spent_cents,
              }
            : p;
          return (
            <ProductEditCard
              key={p.id}
              product={decorated}
              onChanged={onChanged}
              onBudgetChanged={onBudgetChanged}
              stats={showStats ? (statsMap[p.slug] || null) : null}
              indexing={indexingMap[p.slug] || null}
              {...cardProps}
            />
          );
        })}
      </div>
    </section>
  );
}

// ============================================================================
// Archived view — bulk selection + sticky toolbar
// ============================================================================
function ArchivedView({ items, selected, setSelected, onChanged }) {
  const [confirm, confirmModal] = useConfirm();
  const [bulkBusy, setBulkBusy] = useState("");

  if (items.length === 0) {
    return (
      <section
        data-testid="archived-section"
        className="border border-dashed border-[#262626] p-8"
      >
        <p className="font-mono text-xs text-[#525252]" data-testid="archived-empty">
          Nothing archived. Listings you delete from the Live or Drafts views move here so you can restore them later.
        </p>
      </section>
    );
  }

  const allSlugs = items.map((p) => p.slug);
  const allSelected = selected.size === items.length;
  const anySelected = selected.size > 0;

  const toggleOne = (slug) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allSlugs));
  };
  const clearSelection = () => setSelected(new Set());

  // Run an async fn against every selected slug in parallel. Reports per-slug
  // failures via toast and keeps the UI responsive — no all-or-nothing.
  const runBulk = async (label, fn) => {
    const slugs = Array.from(selected);
    setBulkBusy(label);
    const results = await Promise.allSettled(slugs.map((s) => fn(s)));
    const failed = results
      .map((r, i) => ({ r, slug: slugs[i] }))
      .filter(({ r }) => r.status === "rejected");
    setBulkBusy("");
    if (failed.length === 0) {
      toast.success(
        `${label} complete — ${slugs.length} listing${slugs.length === 1 ? "" : "s"}.`,
      );
    } else {
      const okCount = slugs.length - failed.length;
      const firstErr =
        failed[0].r.reason?.response?.data?.detail ||
        failed[0].r.reason?.message ||
        "Unknown error";
      toast.error(
        `${label}: ${okCount}/${slugs.length} succeeded. ` +
          `First failure on "${failed[0].slug}": ${firstErr}`,
      );
    }
    onChanged();
  };

  const onBulkRestore = () => runBulk("Restore", restoreMakerProduct);

  const onBulkPurge = async () => {
    const ok = await confirm({
      title: `Permanently delete ${selected.size} listing${selected.size === 1 ? "" : "s"}?`,
      body: "This cannot be undone. The listings will be removed from the database forever. Listings with order history will be skipped automatically.",
      confirmLabel: `Delete ${selected.size} permanently`,
      cancelLabel: "Keep them archived",
      tone: "danger",
      testId: "confirm-bulk-purge",
    });
    if (!ok) return;
    await runBulk("Permanent delete", purgeMakerProduct);
  };

  return (
    <section data-testid="archived-section">
      <div className="border border-red-700/40 bg-red-900/10 px-4 py-3 mb-5 font-mono text-[10px] uppercase tracking-[0.22em] text-red-300" data-testid="archived-banner">
        ◇ Archived listings are not visible to buyers. Restore one by clicking it — or select multiple to restore or permanently delete in bulk.
      </div>

      {/* Sticky bulk toolbar — appears once anything is selected; otherwise
          the row collapses to just the Select all toggle + count. */}
      <BulkToolbar
        total={items.length}
        selectedCount={selected.size}
        allSelected={allSelected}
        anySelected={anySelected}
        onToggleAll={toggleAll}
        onClear={clearSelection}
        onRestore={onBulkRestore}
        onPurge={onBulkPurge}
        busy={bulkBusy}
      />

      <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-5">
        {items.map((p) => (
          <SelectableCard
            key={p.id}
            product={p}
            selected={selected.has(p.slug)}
            onToggle={() => toggleOne(p.slug)}
            onChanged={onChanged}
          />
        ))}
      </div>

      {confirmModal}
    </section>
  );
}

function BulkToolbar({
  total, selectedCount, allSelected, anySelected,
  onToggleAll, onClear, onRestore, onPurge, busy,
}) {
  return (
    <div
      className={`sticky z-20 flex flex-wrap items-center gap-3 px-4 py-3 border transition ${
        anySelected
          ? "border-[#ff4500] bg-[#ff4500]/5 top-[calc(var(--beta-banner-h,0px)+72px)]"
          : "border-[#262626] bg-[#0d0d0d]"
      }`}
      data-testid="archived-bulk-toolbar"
    >
      <button
        type="button"
        onClick={onToggleAll}
        className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
        data-testid="archived-select-all"
      >
        <span
          className={`w-4 h-4 inline-flex items-center justify-center border ${
            allSelected ? "bg-[#ff4500] border-[#ff4500]" : "border-[#404040]"
          }`}
          aria-hidden="true"
        >
          {allSelected && <Check size={10} className="text-black" />}
        </span>
        {allSelected ? "Clear all" : `Select all (${total})`}
      </button>

      {anySelected && (
        <>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]" data-testid="archived-selected-count">
            {selectedCount} selected
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onRestore}
              disabled={!!busy}
              className="px-3 py-1.5 border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid="archived-bulk-restore"
            >
              {busy === "Restore" ? "Restoring…" : `↩ Restore selected (${selectedCount})`}
            </button>
            <button
              type="button"
              onClick={onPurge}
              disabled={!!busy}
              className="px-3 py-1.5 border border-red-500/50 text-red-400 hover:bg-red-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid="archived-bulk-purge"
            >
              {busy === "Permanent delete" ? "Deleting…" : `⊗ Delete permanently (${selectedCount})`}
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={!!busy}
              className="px-3 py-1.5 border border-[#262626] text-[#a3a3a3] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid="archived-bulk-clear"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Wraps ProductEditCard with a top-left checkbox overlay used only in the
// Archived view. Clicking the checkbox toggles selection without firing the
// underlying card's restore action; clicking elsewhere on the card behaves
// as before (single-item restore via the existing button).
function SelectableCard({ product, selected, onToggle, onChanged }) {
  return (
    <div className="relative" data-testid={`archived-card-wrap-${product.slug}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`absolute top-3 right-3 z-10 w-7 h-7 inline-flex items-center justify-center border-2 transition ${
          selected
            ? "bg-[#ff4500] border-[#ff4500]"
            : "bg-black/70 border-[#525252] hover:border-[#ff4500]"
        }`}
        aria-label={selected ? "Deselect" : "Select"}
        aria-pressed={selected}
        data-testid={`archived-select-${product.slug}`}
      >
        {selected && <Check size={14} className="text-black" />}
      </button>
      <div className={selected ? "ring-2 ring-[#ff4500]" : ""}>
        <ProductEditCard product={product} archived onChanged={onChanged} />
      </div>
    </div>
  );
}
