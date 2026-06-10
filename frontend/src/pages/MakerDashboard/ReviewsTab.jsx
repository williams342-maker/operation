/**
 * Maker Dashboard · Reviews tab
 *
 * Lists every review left on the maker's listings, newest first. Two
 * actions per review:
 *   1. Add public response — Etsy-style "From the seller" reply that
 *      shows up below the review on every public surface.
 *   2. Dispute — escalate to admin if the review is unfair / fake /
 *      against policy. One open dispute per review at a time.
 *
 * Review status badges mirror the dispute lifecycle:
 *   • DISPUTE OPEN — admin is reviewing
 *   • DISPUTE DENIED — admin ruled against the maker; review stays
 *     (upheld disputes simply remove the row entirely so there's nothing
 *      to badge).
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Star, ShieldAlert, MessageCircle, Check } from "lucide-react";
import {
  fetchMakerReviews, postMakerReviewResponse, createReviewDispute,
} from "../../lib/api";
import EmptyState from "../../components/EmptyState";
import { RowsSkeleton, StatsSkeleton } from "../../components/Skeleton";
import { timeAgo } from "../../lib/timeAgo";
import ReviewImportCard from "./ReviewImportCard";

const REASONS = [
  { id: "not_a_buyer", label: "Reviewer never purchased" },
  { id: "factually_wrong", label: "Specific claims are false" },
  { id: "off_topic", label: "Off-topic / about something we didn't sell" },
  { id: "harassment", label: "Personal attack / harassment / hate" },
  { id: "competitor", label: "Sabotage from a rival shop" },
  { id: "duplicate", label: "Duplicate from same buyer" },
  { id: "other", label: "Other (explain below)" },
];

export default function ReviewsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openComposer, setOpenComposer] = useState(null);   // review id for response composer
  const [openDispute, setOpenDispute] = useState(null);     // review id for dispute composer

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await fetchMakerReviews();
      setItems(r.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load reviews.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, []);

  const stats = useMemo(() => {
    if (!items.length) return null;
    const total = items.length;
    const avg = items.reduce((s, r) => s + (r.rating || 0), 0) / total;
    const lowStars = items.filter((r) => (r.rating || 0) <= 2).length;
    const open = items.filter((r) => r.dispute_status === "open").length;
    return { total, avg, lowStars, open };
  }, [items]);

  return (
    <div className="space-y-5" data-testid="maker-reviews-tab">
      <header>
        <h2 className="font-display text-3xl text-ink">Your Reviews</h2>
        <p className="font-mono text-xs text-ink-muted mt-1 max-w-2xl leading-relaxed">
          Every review across your listings, newest first. Add a public
          response for context, or dispute a review you believe is unfair.
        </p>
      </header>

      <ReviewImportCard onImported={refresh} />

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="reviews-kpis">
          <KpiTile label="Total reviews" value={stats.total} />
          <KpiTile label="Average rating" value={stats.avg.toFixed(2)} accent />
          <KpiTile label="1–2 stars" value={stats.lowStars} tone={stats.lowStars > 0 ? "warn" : ""} />
          <KpiTile label="Open disputes" value={stats.open} tone={stats.open > 0 ? "warn" : ""} />
        </div>
      )}

      {loading ? (
        <>
          <StatsSkeleton count={4} />
          <RowsSkeleton count={5} />
        </>
      ) : !items.length ? (
        <EmptyState
          title="No reviews yet."
          subtitle="Reviews appear here once buyers start leaving them on your listings."
          icon={Star}
        />
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <ReviewRow
              key={r.id}
              rev={r}
              composerOpen={openComposer === r.id}
              disputeOpen={openDispute === r.id}
              onToggleComposer={() => {
                setOpenComposer(openComposer === r.id ? null : r.id);
                setOpenDispute(null);
              }}
              onToggleDispute={() => {
                setOpenDispute(openDispute === r.id ? null : r.id);
                setOpenComposer(null);
              }}
              onResponseSaved={() => { setOpenComposer(null); refresh(); }}
              onDisputeFiled={() => { setOpenDispute(null); refresh(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value, accent, tone }) {
  const valueCls = accent
    ? "text-brand"
    : tone === "warn"
      ? "text-amber-400"
      : "text-ink";
  return (
    <div className="border border-line p-4 bg-paper">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">{label}</div>
      <div className={`font-display text-3xl mt-1 ${valueCls}`}>{value}</div>
    </div>
  );
}

function ReviewRow({ rev, composerOpen, disputeOpen, onToggleComposer, onToggleDispute, onResponseSaved, onDisputeFiled }) {
  const stars = "★".repeat(rev.rating || 0) + "☆".repeat(Math.max(0, 5 - (rev.rating || 0)));
  const lowStar = (rev.rating || 0) <= 2;
  return (
    <article className="border border-line bg-paper p-4" data-testid={`review-row-${rev.id}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className={`font-display text-xl shrink-0 ${lowStar ? "text-amber-400" : "text-brand"}`}>
          {stars}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-ink font-bold">{rev.name}</span>
            {rev.location && <span className="font-mono text-[10px] text-ink-muted">· {rev.location}</span>}
            <span className="font-mono text-[10px] text-ink-muted">· {timeAgo(rev.created_at)}</span>
            {rev.dispute_status === "open" && (
              <span
                className="px-2 py-0.5 border border-amber-500/50 text-amber-400 font-mono text-[9px] uppercase tracking-[0.22em]"
                data-testid={`review-dispute-open-${rev.id}`}
              >
                ◆ Dispute open
              </span>
            )}
            {rev.dispute_status === "denied" && (
              <span className="px-2 py-0.5 border border-line/50 text-ink-muted font-mono text-[9px] uppercase tracking-[0.22em]">
                Dispute denied
              </span>
            )}
            {rev.source && (
              <span
                className={`px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em] ${
                  rev.published_publicly === false
                    ? "border-line/50 text-ink-muted"
                    : "border-blue-500/40 text-blue-400 bg-blue-500/5"
                }`}
                data-testid={`review-source-badge-${rev.id}`}
                title={
                  rev.published_publicly === false
                    ? "Imported but hidden from buyers"
                    : `Imported from ${rev.source}`
                }
              >
                {rev.published_publicly === false ? "imported · hidden" : `from ${rev.source}`}
              </span>
            )}
            {rev.product_slug && (
              <a
                href={`/shop/${rev.product_slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-ink-muted hover:text-brand underline-offset-2 hover:underline"
              >
                /shop/{rev.product_slug}
              </a>
            )}
          </div>
          <p className="font-mono text-sm text-ink mt-2 leading-relaxed whitespace-pre-wrap">
            {rev.text}
          </p>

          {rev.maker_response && (
            <div
              className="mt-3 border-l-2 border-brand pl-3 ml-1 bg-brand/5 py-2 pr-3"
              data-testid={`review-maker-response-${rev.id}`}
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-brand">
                ◆ From the seller · {timeAgo(rev.maker_response_at)}
              </div>
              <p className="font-mono text-sm text-ink mt-1 leading-relaxed whitespace-pre-wrap">
                {rev.maker_response}
              </p>
            </div>
          )}

          {composerOpen && (
            <ResponseComposer
              reviewId={rev.id}
              initial={rev.maker_response || ""}
              onSaved={onResponseSaved}
            />
          )}
          {disputeOpen && rev.dispute_status !== "open" && (
            <DisputeComposer reviewId={rev.id} onFiled={onDisputeFiled} />
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleComposer}
            className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
            data-testid={`review-respond-${rev.id}`}
          >
            <MessageCircle size={11} className="inline mr-1" />
            {rev.maker_response ? "Edit response" : composerOpen ? "Cancel" : "Respond"}
          </button>
          {rev.dispute_status !== "open" && (
            <button
              type="button"
              onClick={onToggleDispute}
              className="px-3 py-1.5 border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500 font-mono text-[10px] uppercase tracking-[0.22em] transition"
              data-testid={`review-dispute-${rev.id}`}
            >
              <ShieldAlert size={11} className="inline mr-1" />
              {disputeOpen ? "Cancel" : "Dispute"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function ResponseComposer({ reviewId, initial, onSaved }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const remaining = 1500 - text.length;
  const submit = async () => {
    setBusy(true);
    try {
      await postMakerReviewResponse(reviewId, text.trim());
      toast.success(text.trim() ? "Response published." : "Response cleared.");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save response.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 border border-line bg-paper p-3 space-y-2" data-testid={`review-response-composer-${reviewId}`}>
      <textarea
        rows={4} value={text} maxLength={1500} onChange={(e) => setText(e.target.value)}
        placeholder="Write a public response — context, what you've done to make it right, etc."
        className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink resize-none leading-relaxed"
        data-testid={`review-response-text-${reviewId}`}
      />
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono text-[10px] ${remaining < 100 ? "text-amber-400" : "text-ink-muted"}`}>
          {remaining} chars left · published immediately, no admin review
        </span>
        <button
          type="button" onClick={submit} disabled={busy}
          className="btn-industrial btn-primary disabled:opacity-50"
          data-testid={`review-response-save-${reviewId}`}
        >
          {busy ? "Saving…" : (text.trim() ? "Publish response →" : "Clear response")}
        </button>
      </div>
    </div>
  );
}

function DisputeComposer({ reviewId, onFiled }) {
  const [reason, setReason] = useState("not_a_buyer");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (explanation.trim().length < 10) {
      toast.error("Add at least a sentence (10+ chars) explaining the dispute.");
      return;
    }
    setBusy(true);
    try {
      await createReviewDispute(reviewId, { reason, explanation });
      toast.success("Dispute filed — the team will review it within 2 business days.");
      onFiled();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't file dispute.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 border border-amber-500/40 bg-amber-500/5 p-3 space-y-2" data-testid={`review-dispute-composer-${reviewId}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400">
        ◆ File a dispute
      </div>
      <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
        Use this only when a public response isn't enough. The team reviews disputes within 2 business days. Upheld disputes remove the review from public view; denied disputes leave it published. We always reply to your maker email with the verdict.
      </p>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full bg-paper border border-line focus:border-amber-500 outline-none px-3 py-2 font-mono text-xs text-ink"
        data-testid={`review-dispute-reason-${reviewId}`}
      >
        {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <textarea
        rows={4} value={explanation} maxLength={4000} onChange={(e) => setExplanation(e.target.value)}
        placeholder="Tell the team why this review is unfair. Specifics help — order numbers, screenshots links, dates."
        className="w-full bg-paper border border-line focus:border-amber-500 outline-none px-3 py-2 font-mono text-xs text-ink resize-none leading-relaxed"
        data-testid={`review-dispute-explanation-${reviewId}`}
      />
      <button
        type="button" onClick={submit} disabled={busy}
        className="px-3 py-2 border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400 disabled:opacity-50"
        data-testid={`review-dispute-submit-${reviewId}`}
      >
        {busy ? "Filing…" : "File dispute →"}
      </button>
    </div>
  );
}
