import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Hammer } from "lucide-react";
import ProductEditCard from "./ProductEditCard";
import EmptyState from "../../components/EmptyState";

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

  const live = products.filter((p) => !p.deleted_at && p.status !== "draft");
  const drafts = products.filter((p) => !p.deleted_at && p.status === "draft");
  const archived = products.filter((p) => p.deleted_at);

  const counts = { live: live.length, drafts: drafts.length, archived: archived.length };
  const totalAll = counts.live + counts.drafts + counts.archived;

  return (
    <div className="space-y-8" data-testid="products-list">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          ◆ {counts.live} live
          {counts.drafts > 0 && ` · ${counts.drafts} draft${counts.drafts > 1 ? "s" : ""}`}
          {counts.archived > 0 && ` · ${counts.archived} archived`}
        </div>
        <div className="flex gap-2">
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
          <ViewSwitcher view={view} setView={setView} counts={counts} />
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
              cardProps={{ draft: true }}
            />
          )}
          {view === "archived" && (
            <Bucket
              items={archived}
              testId="archived-section"
              empty={
                <p className="font-mono text-xs text-[#525252]" data-testid="archived-empty">
                  Nothing archived. Listings you delete from the Live or Drafts views move here so you can restore them later.
                </p>
              }
              onChanged={refresh}
              cardProps={{ archived: true }}
              banner={
                archived.length > 0 ? (
                  <div className="border border-red-700/40 bg-red-900/10 px-4 py-3 mb-5 font-mono text-[10px] uppercase tracking-[0.22em] text-red-300" data-testid="archived-banner">
                    ◇ Archived listings are not visible to buyers. Restore one by clicking it — or leave it here for your records.
                  </div>
                ) : null
              }
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

function Bucket({ items, testId, empty, onChanged, cardProps = {}, banner = null }) {
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
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map((p) => (
          <ProductEditCard key={p.id} product={p} onChanged={onChanged} {...cardProps} />
        ))}
      </div>
    </section>
  );
}
