import React, { useEffect, useMemo, useState } from "react";
import { fetchReviews, submitReview } from "../lib/api";
import ReportButton from "./ReportButton";

function StarRow({ value, onSelect, size = 24 }) {
  return (
    <div className="flex gap-1" data-testid="review-star-row">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`Rate ${n} out of 5`}
          onClick={() => onSelect?.(n)}
          className={`leading-none transition ${
            onSelect ? "cursor-pointer hover:scale-110" : "cursor-default"
          } ${n <= value ? "text-brand" : "text-[#3a3a3a]"}`}
          style={{ fontSize: size }}
          data-testid={onSelect ? `review-star-${n}` : undefined}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ReviewCard({ r }) {
  const date = (r.created_at || "").slice(0, 10);
  return (
    <article
      className="border border-line hover:border-brand/40 transition p-5 space-y-3"
      data-testid={`review-card-${r.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg uppercase">{r.name}</div>
          {r.location && (
            <div className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.22em]">
              {r.location}
            </div>
          )}
        </div>
        <StarRow value={r.rating || 0} size={16} />
      </div>
      <p className="font-mono text-sm text-ink leading-relaxed">{r.text}</p>
      {date && (
        <div className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.22em] flex items-center gap-2 flex-wrap">
          <span>◆ {date}</span>
          {r.source && (
            <span
              className="px-1.5 py-0.5 border border-blue-500/40 text-blue-700 bg-blue-500/5 tracking-[0.22em]"
              data-testid={`review-imported-badge-${r.id}`}
              title={`Imported from ${r.source}`}
            >
              from {r.source}
            </span>
          )}
          <span className="ml-auto">
            <ReportButton kind="review" targetId={r.id} compact
                          testId={`review-report-${r.id}`} />
          </span>
        </div>
      )}
    </article>
  );
}

export default function MakerReviews({ makerSlug, makerName }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ name: "", location: "", rating: 0, text: "" });

  const refresh = async () => {
    setLoading(true);
    try {
      const d = await fetchReviews({ maker_slug: makerSlug });
      setReviews(Array.isArray(d) ? d : []);
    } catch {
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!makerSlug) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [makerSlug]);

  // Auto-scroll to #leave-review if the buyer arrived from the email CTA.
  useEffect(() => {
    if (window.location.hash === "#leave-review") {
      const el = document.getElementById("leave-review");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const summary = useMemo(() => {
    if (!reviews.length) return { avg: 0, count: 0 };
    const sum = reviews.reduce((s, r) => s + (r.rating || 0), 0);
    return { avg: sum / reviews.length, count: reviews.length };
  }, [reviews]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!form.name.trim() || !form.text.trim()) {
      setErr("Name and review text are required.");
      return;
    }
    if (!(form.rating >= 1 && form.rating <= 5)) {
      setErr("Please choose a star rating.");
      return;
    }
    setSubmitting(true);
    try {
      await submitReview({
        name: form.name.trim(),
        location: form.location.trim(),
        rating: form.rating,
        text: form.text.trim(),
        maker_slug: makerSlug,
      });
      setSubmitted(true);
      setForm({ name: "", location: "", rating: 0, text: "" });
      await refresh();
    } catch (e2) {
      const d = e2?.response?.data?.detail;
      const msg = typeof d === "string"
        ? d
        : (Array.isArray(d) && d[0]?.msg) || "Failed to submit review. Please try again.";
      setErr(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-20 pt-12 border-t border-line" data-testid="maker-reviews">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2">
            ◆ Reviews
          </div>
          <h2 className="font-display text-4xl md:text-6xl uppercase">
            What buyers say.
          </h2>
        </div>
        {summary.count > 0 && (
          <div className="text-right" data-testid="reviews-summary">
            <StarRow value={Math.round(summary.avg)} size={20} />
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-1">
              {summary.avg.toFixed(1)} from {summary.count} review{summary.count === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <p className="font-mono text-sm text-ink-muted" data-testid="reviews-loading">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <p className="font-mono text-sm text-ink-muted mb-10" data-testid="reviews-empty">
          No reviews yet. Be the first to share your experience with {makerName}.
        </p>
      ) : (
        <div className="grid md:grid-cols-2 gap-4 mb-12" data-testid="reviews-list">
          {reviews.map((r) => <ReviewCard key={r.id} r={r} />)}
        </div>
      )}

      <div id="leave-review" className="scroll-mt-32 border border-line bg-surface p-6 md:p-8" data-testid="leave-review-card">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
          ◆ Leave a Review
        </div>
        <h3 className="font-display text-2xl md:text-3xl uppercase mb-6">
          Worked with {makerName}? Share the story.
        </h3>

        {submitted ? (
          <div className="border border-emerald-700/60 bg-emerald-900/20 p-4 font-mono text-sm text-emerald-700" data-testid="review-success">
            ◆ Thanks — your review is live. We appreciate you taking the time.
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="ml-3 underline hover:text-emerald-700"
              data-testid="review-write-another"
            >
              Write another
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" data-testid="leave-review-form">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                Your rating
              </label>
              <StarRow value={form.rating} onSelect={(n) => setForm({ ...form, rating: n })} size={32} />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <label className="block">
                <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
                  Name
                </span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your name"
                  className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm text-ink"
                  data-testid="review-name"
                />
              </label>
              <label className="block">
                <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
                  Location <span className="text-ink-muted">(optional)</span>
                </span>
                <input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="City, State"
                  className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm text-ink"
                  data-testid="review-location"
                />
              </label>
            </div>
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
                Your review
              </span>
              <textarea
                required
                rows={5}
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                placeholder="What did you order? How was the craftsmanship, communication, packaging, timing?"
                maxLength={1500}
                className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm text-ink"
                data-testid="review-text"
              />
              <div className="font-mono text-[10px] text-ink-muted text-right mt-1">
                {form.text.length}/1500
              </div>
            </label>
            {err && (
              <p className="font-mono text-xs text-red-400" data-testid="review-error">{err}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="btn-industrial btn-primary inline-flex disabled:opacity-50"
              data-testid="review-submit"
            >
              {submitting ? "Posting…" : "Post Review"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
