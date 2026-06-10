/**
 * Admin → Reviews tab.
 *
 * iter189 update — the user pointed out that disputed reviews weren't
 * surfacing here, only in the separate "Review Disputes" tab. Three
 * additions:
 *   1. Loads up to 500 reviews (was capped at the public default of 20).
 *   2. Renders a `dispute_status` badge on every row that has one.
 *   3. Filter row: All / Disputed only / Open disputes — plus a pill
 *      linking to the dedicated dispute-resolution tab when there are
 *      open ones waiting.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import {
  fetchReviews, adminCreateReview, adminDeleteReview, fetchAdminReviewDisputes,
} from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";

const DISPUTE_BADGE = {
  open:   { label: "DISPUTED · OPEN", cls: "border-amber-500/60 text-amber-400 bg-amber-500/10" },
  upheld: { label: "DISPUTE UPHELD",  cls: "border-emerald-500/60 text-emerald-400 bg-emerald-500/10" },
  denied: { label: "DISPUTE DENIED",  cls: "border-[#525252]/60 text-ink-muted bg-surface" },
};

const FILTERS = [
  { id: "all",      label: "All" },
  { id: "disputed", label: "Disputed only" },
  { id: "5",        label: "5 ★" },
  { id: "low",      label: "≤ 3 ★" },
];

export default function ReviewsTab() {
  const [reviews, setReviews] = useState([]);
  const [openDisputes, setOpenDisputes] = useState(0);
  const [filter, setFilter] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  const refresh = async () => {
    // 500 is well above any single-page need and matches the dispute-tab
    // page size — keeps the two tabs perceptually consistent.
    const [revs, disputes] = await Promise.all([
      fetchReviews({ limit: 500 }),
      fetchAdminReviewDisputes("open").catch(() => ({ items: [] })),
    ]);
    setReviews(revs);
    setOpenDisputes((disputes.items || []).length);
  };
  useEffect(() => { refresh(); }, []);

  const visible = useMemo(() => {
    if (filter === "disputed") return reviews.filter((r) => !!r.dispute_status);
    if (filter === "5") return reviews.filter((r) => (r.rating || 0) === 5);
    if (filter === "low") return reviews.filter((r) => (r.rating || 0) <= 3);
    return reviews;
  }, [reviews, filter]);

  const totalDisputed = reviews.filter((r) => !!r.dispute_status).length;

  return (
    <div data-testid="reviews-tab" className="space-y-3">
      {confirmModal}

      {/* Disputes callout — direct link to the dedicated tab */}
      {openDisputes > 0 && (
        <Link
          to="/admin/dashboard?tab=review-disputes"
          className="block border border-amber-500/40 bg-amber-500/5 p-3 hover:bg-amber-500/10 transition"
          data-testid="reviews-disputes-callout"
        >
          <div className="flex items-center gap-2 font-mono text-xs">
            <ShieldAlert size={14} className="text-amber-400" />
            <span className="text-amber-400 uppercase tracking-[0.22em] text-[10px] font-bold">
              ◆ {openDisputes} open dispute{openDisputes === 1 ? "" : "s"} waiting
            </span>
            <span className="text-ink-muted ml-auto">Open Review Disputes tab →</span>
          </div>
        </Link>
      )}

      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="font-mono text-xs text-ink-muted">
            {visible.length} of {reviews.length} review{reviews.length === 1 ? "" : "s"}
            {totalDisputed > 0 && (
              <span className="text-amber-400 ml-2">· {totalDisputed} disputed</span>
            )}
          </p>
          <div className="flex border border-line" data-testid="reviews-filter">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                    active ? "bg-brand text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                  data-testid={`reviews-filter-${f.id}`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
        <button onClick={() => setShowNew((s) => !s)} className="btn-industrial btn-primary inline-flex" data-testid="reviews-new-btn">
          {showNew ? "Cancel" : "+ Add review"}
        </button>
      </div>

      {showNew && <NewReviewForm onSaved={() => { setShowNew(false); refresh(); }} />}

      {visible.length === 0 ? (
        <p className="font-mono text-xs text-ink-muted italic border border-dashed border-line p-6 text-center" data-testid="reviews-empty">
          No reviews match this filter.
        </p>
      ) : (
        visible.map((r) => (
          <div key={r.id} className="border border-line p-4" data-testid={`review-${r.id}`}>
            <div className="flex justify-between items-baseline gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-lg text-ink">{r.name}</span>
                  {r.dispute_status && DISPUTE_BADGE[r.dispute_status] && (
                    <Link
                      to="/admin/dashboard?tab=review-disputes"
                      className={`px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em] font-bold ${DISPUTE_BADGE[r.dispute_status].cls} hover:opacity-80`}
                      data-testid={`review-dispute-badge-${r.id}`}
                      title="Open the Review Disputes tab to resolve"
                    >
                      {DISPUTE_BADGE[r.dispute_status].label}
                    </Link>
                  )}
                  {r.source && (
                    <span className="px-1.5 py-0.5 border border-blue-500/40 text-blue-400 bg-blue-500/5 font-mono text-[9px] uppercase tracking-[0.22em]">
                      from {r.source}
                    </span>
                  )}
                </div>
                <div className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.22em] mt-1">
                  {r.location || "—"} · {"★".repeat(r.rating)}
                  {r.maker_slug && <> · /{r.maker_slug}</>}
                </div>
              </div>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: "Delete this review?",
                    body: `"${r.text.slice(0, 80)}${r.text.length > 80 ? "…" : ""}" — by ${r.name}. This can't be undone.`,
                    confirmLabel: "Delete",
                    tone: "danger",
                    testId: `confirm-delete-review-${r.id}`,
                  });
                  if (ok) {
                    await adminDeleteReview(r.id);
                    refresh();
                  }
                }}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-200 shrink-0"
                data-testid={`review-delete-${r.id}`}
              >
                ⊗ delete
              </button>
            </div>
            <p className="font-mono text-xs text-ink leading-relaxed mt-2">{r.text}</p>
          </div>
        ))
      )}
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
    <form onSubmit={submit} className="border border-line p-4 grid md:grid-cols-2 gap-3" data-testid="review-new-form">
      <input required placeholder="Reviewer name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })}
             className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs" data-testid="review-name" />
      <input required placeholder="Location (City, ST)" value={r.location} onChange={(e) => setR({ ...r, location: e.target.value })}
             className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs" data-testid="review-location" />
      <input type="number" min="1" max="5" value={r.rating} onChange={(e) => setR({ ...r, rating: e.target.value })}
             className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs" data-testid="review-rating" />
      <input placeholder="Product slug (optional)" value={r.product_slug} onChange={(e) => setR({ ...r, product_slug: e.target.value })}
             className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs" data-testid="review-product" />
      <textarea required rows={3} placeholder="Review text…" value={r.text} onChange={(e) => setR({ ...r, text: e.target.value })}
                className="md:col-span-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs resize-y"
                data-testid="review-text" />
      <button type="submit" disabled={busy} className="btn-industrial btn-primary md:col-span-2 disabled:opacity-50" data-testid="review-submit">
        {busy ? "Saving…" : "Add review →"}
      </button>
    </form>
  );
}
