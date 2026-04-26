import React, { useEffect, useState } from "react";
import { fetchReviews, adminCreateReview, adminDeleteReview } from "../../lib/api";

// ===================== REVIEWS =====================
export default function ReviewsTab() {
  const [reviews, setReviews] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const refresh = () => fetchReviews().then(setReviews);
  useEffect(() => { refresh(); }, []);
  return (
    <div data-testid="reviews-tab" className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="font-mono text-xs text-[#a3a3a3]">{reviews.length} reviews</p>
        <button onClick={() => setShowNew((s) => !s)} className="btn-industrial btn-primary inline-flex" data-testid="reviews-new-btn">
          {showNew ? "Cancel" : "+ Add review"}
        </button>
      </div>
      {showNew && <NewReviewForm onSaved={() => { setShowNew(false); refresh(); }} />}
      {reviews.map((r) => (
        <div key={r.id} className="border border-[#262626] p-4" data-testid={`review-${r.id}`}>
          <div className="flex justify-between items-baseline">
            <div>
              <div className="font-display text-lg">{r.name}</div>
              <div className="font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.22em]">
                {r.location} · {"★".repeat(r.rating)}
              </div>
            </div>
            <button
              onClick={async () => {
                if (window.confirm("Delete this review?")) {
                  await adminDeleteReview(r.id);
                  refresh();
                }
              }}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-200"
              data-testid={`review-delete-${r.id}`}
            >
              ⊗ delete
            </button>
          </div>
          <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-2">{r.text}</p>
        </div>
      ))}
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
    <form onSubmit={submit} className="border border-[#262626] p-4 grid md:grid-cols-2 gap-3" data-testid="review-new-form">
      <input required placeholder="Reviewer name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-name" />
      <input required placeholder="Location (City, ST)" value={r.location} onChange={(e) => setR({ ...r, location: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-location" />
      <input type="number" min="1" max="5" value={r.rating} onChange={(e) => setR({ ...r, rating: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-rating" />
      <input placeholder="Product slug (optional)" value={r.product_slug} onChange={(e) => setR({ ...r, product_slug: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-product" />
      <textarea required rows={3} placeholder="Review text…" value={r.text} onChange={(e) => setR({ ...r, text: e.target.value })}
                className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                data-testid="review-text" />
      <button type="submit" disabled={busy} className="btn-industrial btn-primary md:col-span-2 disabled:opacity-50" data-testid="review-submit">
        {busy ? "Saving…" : "Add review →"}
      </button>
    </form>
  );
}
