import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Mail, BarChart3, Search, X } from "lucide-react";
import { toast } from "sonner";
import ProductEditCard from "./ProductEditCard";
import BatchPriceCheckButton from "./BatchPriceCheckButton";
import MakerFeedQualityCard from "./MakerFeedQualityCard";
import EmptyState from "../../components/EmptyState";
import { useConfirm } from "./useConfirm";
import {
  restoreMakerProduct, purgeMakerProduct, fetchMakerRestockWaitlist,
  fetchMakerProductsStats, fetchMakerProductsIndexingStatus,
  fetchListingBudgets, fetchLatestPriceComparisons, fetchMakerOptionStats,
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
  { key: "live", label: "Live", color: "text-ink" },
  { key: "drafts", label: "Drafts", color: "text-brand" },
  { key: "archived", label: "Archived", color: "text-red-400" },
];

// iter371 — Sort options for the listing grids. "Best sellers" ranks by
// all-time sales from the stats endpoint; everything else sorts on fields
// already present on the product rows.
const SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "best-sellers", label: "Best sellers" },
  { key: "price-asc", label: "Price: low → high" },
  { key: "price-desc", label: "Price: high → low" },
  { key: "stock-asc", label: "Lowest stock first" },
  { key: "title-az", label: "Title A–Z" },
];

function sortItems(arr, sort, statsMap) {
  const a = [...arr];
  switch (sort) {
    case "oldest":
      return a.sort((x, y) => (x.created_at || "").localeCompare(y.created_at || ""));
    case "best-sellers":
      return a.sort((x, y) =>
        (statsMap[y.slug]?.sales_all || 0) - (statsMap[x.slug]?.sales_all || 0));
    case "price-asc":
      return a.sort((x, y) => (Number(x.price) || 0) - (Number(y.price) || 0));
    case "price-desc":
      return a.sort((x, y) => (Number(y.price) || 0) - (Number(x.price) || 0));
    case "stock-asc":
      return a.sort((x, y) => (Number(x.in_stock) || 0) - (Number(y.in_stock) || 0));
    case "title-az":
      return a.sort((x, y) => (x.title || "").localeCompare(y.title || ""));
    case "newest":
    default:
      return a.sort((x, y) => (y.created_at || "").localeCompare(x.created_at || ""));
  }
}

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
  // iter371 — Sort order for the listing grids. "best-sellers" needs the
  // stats map, so the stats fetch below also fires when that sort is active
  // even if the Stats overlay is off.
  const [sort, setSort] = useState("newest");
  // iter381 — most-picked options per listing. Piggybacks on the Stats
  // toggle (renders inside the same overlay), so it's only fetched when
  // the maker actually flips Stats ON.
  const [optionStatsMap, setOptionStatsMap] = useState({});
  useEffect(() => {
    if (!showStats && sort !== "best-sellers") return;
    let cancelled = false;
    fetchMakerProductsStats()
      .then((d) => { if (!cancelled) setStatsMap(d || {}); })
      .catch(() => {});
    fetchMakerOptionStats()
      .then((d) => { if (!cancelled) setOptionStatsMap(d || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showStats, sort, products.length]);

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

  // iter334i — Pricing comparison map for inline-verdict badges.
  // Keyed by listing slug → { delta_pct, price_median, generated_at }.
  // Single bulk fetch on mount, refreshed when the products list
  // identity changes (e.g. after a new listing is added). Skipped
  // gracefully if the endpoint hiccups — badges just don't render.
  const [comparisonsMap, setComparisonsMap] = useState({});
  // iter334j — Bumped by BatchPriceCheckButton on completion so the
  // verdict badges refresh against the freshly-generated comparisons.
  const [batchVersion, setBatchVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchLatestPriceComparisons(60)
      .then((d) => { if (!cancelled) setComparisonsMap(d?.comparisons || {}); })
      .catch(() => { /* no badges shown — fine */ });
    return () => { cancelled = true; };
  }, [products.length, batchVersion]);
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

  // iter370 — Listing search. Filters every view (live/drafts/archived) by
  // title, slug, category, or tags so makers with 50+ listings can jump
  // straight to the one they want to edit instead of paging through the grid.
  const [q, setQ] = useState("");
  const norm = q.trim().toLowerCase();
  const matchesQuery = (p) => {
    if (!norm) return true;
    const haystack = [
      p.title, p.slug, p.category,
      ...(Array.isArray(p.tags) ? p.tags : []),
    ];
    return haystack.some((f) => (f || "").toLowerCase().includes(norm));
  };
  const liveShown = sortItems(live.filter(matchesQuery), sort, statsMap);
  const draftsShown = sortItems(drafts.filter(matchesQuery), sort, statsMap);
  const archivedShown = sortItems(archived.filter(matchesQuery), sort, statsMap);

  const counts = {
    live: liveShown.length,
    drafts: draftsShown.length,
    archived: archivedShown.length,
  };
  const totalAll = live.length + drafts.length + archived.length;
  const totalShown = counts.live + counts.drafts + counts.archived;

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
          className="border border-brand/40 bg-brand/5 px-4 py-3 flex items-start gap-3"
          data-testid="restock-demand-banner"
        >
          <Mail size={16} className="text-brand mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand">
              ◆ Restock demand · {restockDemand.total_pending} {restockDemand.total_pending === 1 ? "buyer" : "buyers"} waiting
            </div>
            <div className="font-mono text-xs text-ink mt-1.5 leading-relaxed">
              {restockDemand.products.slice(0, 3).map((p, i) => (
                <span key={p.product_id}>
                  {i > 0 && " · "}
                  <span className="text-ink">{p.product_title}</span>
                  <span className="text-ink-muted"> ({p.count})</span>
                </span>
              ))}
              {restockDemand.products.length > 3 && (
                <span className="text-ink-muted"> +{restockDemand.products.length - 3} more</span>
              )}
            </div>
            <p className="font-mono text-[10px] text-ink-muted mt-1.5 leading-relaxed">
              Raise stock on any of these listings → every waitlisted buyer gets an automatic "back in stock" email.
            </p>
          </div>
        </div>
      )}
      {/* iter366c — Google feed quality nudge (renders only when a
          listing syncs with fallback attributes). */}
      <MakerFeedQualityCard />
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted">
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
                ? "border-brand bg-brand text-[#0a0a0a]"
                : "border-line text-ink-muted hover:border-brand hover:text-brand"
            }`}
            data-testid="products-stats-toggle"
            aria-pressed={showStats}
          >
            <BarChart3 size={12} /> Stats {showStats ? "ON" : "OFF"}
          </button>
          {/* iter334j — Batch AI Price Check. One button kicks off a
              backend background job that runs the AI Price Check on
              every published listing (cache-aware, ≤10 per batch).
              Badges refresh as jobs complete. */}
          <BatchPriceCheckButton onCompleted={() => setBatchVersion((v) => v + 1)} />
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
          illustration="products"
          eyebrow="◆ Workshop"
          title="Time to build."
          body="Your shop is live but empty. Add your first piece — buyers and our auto-newsletter will see it the moment you publish."
          cta={{ label: "+ New Listing", onClick: goNew, testId: "products-empty-cta" }}
          testId="products-empty"
        />
      ) : (
        <>
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <ViewSwitcher view={view} setView={switchView} counts={counts} />
            <div className="relative w-full md:max-w-sm">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search your listings…"
                data-testid="listings-search-input"
                className="w-full pl-9 pr-8 py-2 bg-transparent border border-line focus:border-brand outline-none font-mono text-xs placeholder:text-ink-muted"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  title="Clear search"
                  data-testid="listings-search-clear"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-brand transition"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              data-testid="listings-sort-select"
              title="Sort listings"
              className="px-3 py-2 bg-paper border border-line focus:border-brand outline-none font-mono text-[10px] uppercase tracking-[0.18em] text-ink cursor-pointer"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            {norm && (
              <span
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted whitespace-nowrap"
                data-testid="listings-search-count"
              >
                {totalShown} match{totalShown === 1 ? "" : "es"}
              </span>
            )}
          </div>
          {view === "live" && (
            <Bucket
              items={liveShown}
              testId="live-section"
              empty={
                <p className="font-mono text-xs text-ink-muted" data-testid="live-empty">
                  {norm
                    ? `No live listings match “${q.trim()}”.`
                    : "No live listings yet — publish a draft or create a new one."}
                </p>
              }
              onChanged={refresh}
              onBudgetChanged={refreshBudgets}
              showStats={showStats}
              statsMap={statsMap}
              optionStatsMap={optionStatsMap}
              indexingMap={indexingMap}
              budgetMap={budgetMap}
              comparisonsMap={comparisonsMap}
            />
          )}
          {view === "drafts" && (
            <Bucket
              items={draftsShown}
              testId="drafts-section"
              empty={
                <p className="font-mono text-xs text-ink-muted" data-testid="drafts-empty">
                  {norm
                    ? `No drafts match “${q.trim()}”.`
                    : "No drafts. New listings save here automatically until you publish."}
                </p>
              }
              onChanged={refresh}
              onBudgetChanged={refreshBudgets}
              cardProps={{ draft: true }}
              showStats={showStats}
              statsMap={statsMap}
              optionStatsMap={optionStatsMap}
              indexingMap={indexingMap}
              budgetMap={budgetMap}
              comparisonsMap={comparisonsMap}
            />
          )}
          {view === "archived" && (
            <ArchivedView
              items={archivedShown}
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
      className="inline-flex border border-line divide-x divide-line overflow-x-auto"
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
                ? "bg-brand text-ink"
                : `bg-transparent ${v.color} hover:text-brand`
            }`}
          >
            {v.label} <span className="opacity-60">· {count}</span>
          </button>
        );
      })}
    </div>
  );
}

function Bucket({ items, testId, empty, onChanged, onBudgetChanged, cardProps = {}, banner = null, showStats = false, statsMap = {}, optionStatsMap = {}, indexingMap = {}, budgetMap = {}, comparisonsMap = {} }) {
  // iter342 — Paginate at 12 per page (matches the dense 4-col xl grid
  // exactly = 3 full rows). Anything more felt like a wall of cards on
  // the listings tab and made the page sluggish once a maker had 50+
  // listings (each card lazily loads images + stats + budget pills).
  const PAGE_SIZE = 12;

  // iter413bf — Persist current page per-bucket so editing a listing on
  // page 2/3 and returning doesn't snap the maker back to page 1.
  // sessionStorage scope is correct: survives editor navigation but
  // resets on a fresh browser session (no stale state across logins).
  const PAGE_KEY = `cm_maker_listings_page_${testId}`;
  const readPersistedPage = () => {
    try {
      const v = parseInt(sessionStorage.getItem(PAGE_KEY) || "0", 10);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    } catch {
      return 0;
    }
  };
  const [page, setPageState] = useState(readPersistedPage);
  const setPage = (next) => {
    setPageState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      try { sessionStorage.setItem(PAGE_KEY, String(resolved)); } catch {/* private mode */}
      return resolved;
    });
  };

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // iter342 — Derive the effective page index instead of writing it back
  // via useEffect (avoids react-hooks/set-state-in-effect). If the
  // underlying list shrinks (e.g. archiving on the last page), we just
  // clamp the index used for slicing — the next user click on Prev/Next
  // re-snaps the state to a valid index.
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const visible = items.slice(start, start + PAGE_SIZE);

  if (items.length === 0) {
    return (
      <section data-testid={testId} className="border border-dashed border-line p-8">
        {empty}
      </section>
    );
  }

  return (
    <section data-testid={testId}>
      {banner}
      <BucketPagination
        position="top"
        testId={testId}
        page={safePage}
        totalPages={totalPages}
        start={start}
        pageSize={PAGE_SIZE}
        total={items.length}
        onChange={setPage}
      />
      <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visible.map((p) => {
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
          // iter334i — Recompute the badge against the CURRENT product
          // price + cached median so the verdict reflects today's
          // pricing, not the price when the AI Price Check ran.
          const comp = comparisonsMap[p.slug] || null;
          let comparison = null;
          if (comp && comp.price_median > 0 && p.price > 0) {
            const deltaPct = ((Number(p.price) - comp.price_median) / comp.price_median) * 100.0;
            comparison = {
              delta_pct: deltaPct,
              price_median: comp.price_median,
              // iter334k — Pass the CURRENT product price so the
              // verdict popover's "Undo" action can restore it after a
              // one-click apply.
              listed_price_at_check: Number(p.price),
              generated_at: comp.generated_at,
            };
          }
          return (
            <ProductEditCard
              key={p.id}
              product={decorated}
              onChanged={onChanged}
              onBudgetChanged={onBudgetChanged}
              stats={showStats ? (statsMap[p.slug] || null) : null}
              optionStats={showStats ? (optionStatsMap[p.slug] || null) : null}
              indexing={indexingMap[p.slug] || null}
              comparison={comparison}
              {...cardProps}
            />
          );
        })}
      </div>
      <BucketPagination
        position="bottom"
        testId={testId}
        page={safePage}
        totalPages={totalPages}
        start={start}
        pageSize={PAGE_SIZE}
        total={items.length}
        onChange={setPage}
      />
    </section>
  );
}

// iter343b — Top + bottom pagination chrome shared by every Bucket. Hoisted
// out of `Bucket` so React's reconciler treats it as a stable component
// (avoids `react/no-unstable-nested-components` and the associated remount
// thrash on every parent re-render).
function BucketPagination({ position, testId, page, totalPages, start, pageSize, total, onChange }) {
  if (totalPages <= 1) return null;
  const onPrev = () => onChange((p) => Math.max(0, Math.min(p, totalPages - 1) - 1));
  const onNext = () => onChange((p) => Math.min(totalPages - 1, Math.min(p, totalPages - 1) + 1));
  const wrapperCls = position === "top"
    ? "flex items-center justify-between border-b border-line mb-4 pb-3"
    : "flex items-center justify-between border-t border-line mt-6 pt-4";
  return (
    <div className={wrapperCls} data-testid={`${testId}-pagination-${position}`}>
      <button
        type="button"
        onClick={onPrev}
        disabled={page === 0}
        className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
        data-testid={`${testId}-page-prev-${position}`}
      >
        ← Prev
      </button>
      <span
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
        data-testid={`${testId}-page-indicator-${position}`}
      >
        Page {page + 1} of {totalPages}
        <span className="text-ink-muted ml-2 normal-case tracking-normal">
          · showing {start + 1}-{Math.min(start + pageSize, total)} of {total}
        </span>
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= totalPages - 1}
        className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
        data-testid={`${testId}-page-next-${position}`}
      >
        Next →
      </button>
    </div>
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
        className="border border-dashed border-line p-8"
      >
        <p className="font-mono text-xs text-ink-muted" data-testid="archived-empty">
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
      <div className="border border-red-700/40 bg-red-900/10 px-4 py-3 mb-5 font-mono text-[10px] uppercase tracking-[0.22em] text-red-600" data-testid="archived-banner">
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
          ? "border-brand bg-brand/5 top-[calc(var(--beta-banner-h,0px)+72px)]"
          : "border-line bg-paper"
      }`}
      data-testid="archived-bulk-toolbar"
    >
      <button
        type="button"
        onClick={onToggleAll}
        className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition"
        data-testid="archived-select-all"
      >
        <span
          className={`w-4 h-4 inline-flex items-center justify-center border ${
            allSelected ? "bg-brand border-brand" : "border-line"
          }`}
          aria-hidden="true"
        >
          {allSelected && <Check size={10} className="text-ink" />}
        </span>
        {allSelected ? "Clear all" : `Select all (${total})`}
      </button>

      {anySelected && (
        <>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand" data-testid="archived-selected-count">
            {selectedCount} selected
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onRestore}
              disabled={!!busy}
              className="px-3 py-1.5 border border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
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
              className="px-3 py-1.5 border border-line text-ink-muted hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
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
            ? "bg-brand border-brand"
            : "bg-paper/70 border-line hover:border-brand"
        }`}
        aria-label={selected ? "Deselect" : "Select"}
        aria-pressed={selected}
        data-testid={`archived-select-${product.slug}`}
      >
        {selected && <Check size={14} className="text-ink" />}
      </button>
      <div className={selected ? "ring-2 ring-[#ff4500]" : ""}>
        <ProductEditCard product={product} archived onChanged={onChanged} />
      </div>
    </div>
  );
}
