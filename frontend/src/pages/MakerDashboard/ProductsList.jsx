import React, { useState } from "react";
import { Hammer, Upload } from "lucide-react";
import ProductEditCard from "./ProductEditCard";
import NewListingModal from "./NewListingModal";
import CsvImportModal from "./CsvImportModal";
import EmptyState from "../../components/EmptyState";

export default function ProductsList({ products, onChanged, onRefresh }) {
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const refresh = onChanged || onRefresh || (() => {});
  // 3 buckets: live (published, not deleted) · drafts · archived (soft-deleted)
  const live = products.filter((p) => !p.deleted_at && p.status !== "draft");
  const drafts = products.filter((p) => !p.deleted_at && p.status === "draft");
  const removed = products.filter((p) => p.deleted_at);

  return (
    <div className="space-y-12" data-testid="products-list">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          ◆ {live.length} live
          {drafts.length > 0 && ` · ${drafts.length} draft${drafts.length > 1 ? "s" : ""}`}
          {removed.length > 0 && ` · ${removed.length} archived`}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setImporting(true)}
            className="btn-industrial inline-flex items-center gap-2"
            data-testid="csv-import-btn"
            title="Migrate from Etsy by uploading your shop CSV"
          >
            <Upload size={14} /> Import CSV
          </button>
          <button
            onClick={() => setCreating(true)}
            className="btn-industrial btn-primary"
            data-testid="new-listing-btn"
          >
            + New Listing
          </button>
        </div>
      </div>

      {live.length === 0 && drafts.length === 0 && removed.length === 0 ? (
        <EmptyState
          icon={Hammer}
          eyebrow="◆ Workshop"
          title="Time to build."
          body="Your shop is live but empty. Add your first piece — buyers and our auto-newsletter will see it the moment you publish."
          cta={{ label: "+ New Listing", onClick: () => setCreating(true), testId: "products-empty-cta" }}
          testId="products-empty"
        />
      ) : (
        <>
          {drafts.length > 0 && (
            <section data-testid="drafts-section">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-400 mb-3">
                ✎ Drafts · not visible to buyers
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {drafts.map((p) => (
                  <ProductEditCard key={p.id} product={p} onChanged={onChanged} draft />
                ))}
              </div>
            </section>
          )}

          {live.length > 0 && (
            <section>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {live.map((p) => (
                  <ProductEditCard key={p.id} product={p} onChanged={onChanged} />
                ))}
              </div>
            </section>
          )}

          {removed.length > 0 && (
            <section data-testid="archived-section">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-red-400 mb-3">
                ◇ Archived
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {removed.map((p) => (
                  <ProductEditCard key={p.id} product={p} onChanged={onChanged} archived />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {creating && (
        <NewListingModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
      {importing && (
        <CsvImportModal
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
