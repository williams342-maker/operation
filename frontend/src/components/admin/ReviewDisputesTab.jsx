/**
 * Admin · Review Disputes Tab
 *
 * Queue of maker-filed disputes. Resolve to either:
 *   • Upheld — the review is deleted from the public collection.
 *   • Denied — the review stays published; the dispute is closed.
 * Maker is emailed with the verdict + admin's optional internal note
 * (the note is internal-only so it's safe to include reasoning).
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, Check, X } from "lucide-react";
import { fetchAdminReviewDisputes, adminResolveReviewDispute } from "../../lib/api";
import EmptyState from "../EmptyState";
import { RowsSkeleton } from "../Skeleton";
import { timeAgo } from "../../lib/timeAgo";

const FILTERS = [
  { id: "open",    label: "Open" },
  { id: "upheld",  label: "Upheld" },
  { id: "denied",  label: "Denied" },
  { id: "all",     label: "All" },
];
const REASON_LABEL = {
  not_a_buyer: "Reviewer never purchased",
  factually_wrong: "Specific claims false",
  off_topic: "Off-topic",
  harassment: "Harassment",
  competitor: "Competitor sabotage",
  duplicate: "Duplicate",
  other: "Other",
};

export default function ReviewDisputesTab() {
  const [filter, setFilter] = useState("open");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null); // {id, status} when modal open

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await fetchAdminReviewDisputes(filter === "all" ? undefined : filter);
      setItems(r.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load disputes.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); /* eslint-disable-line */ }, [filter]);

  const counts = useMemo(() => ({
    open: items.filter((i) => i.status === "open").length,
    total: items.length,
  }), [items]);

  return (
    <div className="space-y-5" data-testid="admin-review-disputes-tab">
      <header>
        <h2 className="font-display text-3xl text-[#e5e5e5]">Review Disputes</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-1 max-w-2xl leading-relaxed">
          Maker-filed challenges to reviews they believe are unfair, fake,
          or against policy. <b className="text-[#e5e5e5]">Upheld</b> = remove
          the review. <b className="text-[#e5e5e5]">Denied</b> = leave it
          published. The maker is auto-emailed either way.
        </p>
      </header>

      <div className="flex border border-[#262626] w-fit" data-testid="dispute-filter">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              data-testid={`dispute-filter-${f.id}`}
              className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                active ? "bg-[#ff4500] text-black" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div data-testid="disputes-loading"><RowsSkeleton count={4} /></div>
      ) : !items.length ? (
        <EmptyState
          title={filter === "open" ? "Nothing waiting on you." : "No disputes match this filter."}
          subtitle={filter === "open" ? "Every dispute has been resolved. Nice." : "Try a different filter."}
          icon={ShieldAlert}
        />
      ) : (
        <div className="space-y-3" data-testid="dispute-list">
          {items.map((d) => (
            <DisputeRow
              key={d.id}
              dispute={d}
              onResolve={(status) => setResolving({ dispute: d, status })}
            />
          ))}
        </div>
      )}

      <p className="font-mono text-[10px] text-[#525252]">
        {counts.total} dispute{counts.total === 1 ? "" : "s"} · {counts.open} open
      </p>

      {resolving && (
        <ResolveDialog
          dispute={resolving.dispute}
          status={resolving.status}
          onCancel={() => setResolving(null)}
          onResolved={() => { setResolving(null); refresh(); }}
        />
      )}
    </div>
  );
}

function DisputeRow({ dispute, onResolve }) {
  const snap = dispute.review_snapshot || {};
  const stars = "★".repeat(snap.rating || 0) + "☆".repeat(Math.max(0, 5 - (snap.rating || 0)));
  return (
    <article className="border border-[#262626] bg-[#0a0a0a] p-4 space-y-3" data-testid={`dispute-row-${dispute.id}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em] ${
          dispute.status === "open" ? "border-amber-500/50 text-amber-400 bg-amber-500/10"
          : dispute.status === "upheld" ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
          : "border-[#525252] text-[#a3a3a3]"
        }`}>
          {dispute.status}
        </span>
        <span className="font-mono text-xs text-[#e5e5e5] font-bold">
          {dispute.maker_name || dispute.maker_slug}
        </span>
        <span className="font-mono text-[10px] text-[#525252]">
          · disputed {timeAgo(dispute.created_at)}
        </span>
        <span className="px-2 py-0.5 border border-[#262626] text-[#a3a3a3] font-mono text-[9px] uppercase tracking-[0.22em]">
          {REASON_LABEL[dispute.reason] || dispute.reason}
        </span>
        {snap.product_slug && (
          <a
            href={`/shop/${snap.product_slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] text-[#a3a3a3] hover:text-[#ff4500]"
          >
            /shop/{snap.product_slug}
          </a>
        )}
      </div>

      <div className="border border-[#1a1a1a] bg-[#0d0d0d] p-3" data-testid={`dispute-snapshot-${dispute.id}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="font-display text-base text-amber-400">{stars}</span>
          <span className="font-mono text-xs text-[#e5e5e5] font-bold">{snap.name || "anonymous"}</span>
          <span className="font-mono text-[10px] text-[#525252]">· {timeAgo(snap.created_at)}</span>
        </div>
        <p className="font-mono text-sm text-[#e5e5e5] leading-relaxed whitespace-pre-wrap">{snap.text}</p>
      </div>

      <div className="border-l-2 border-amber-500 pl-3 ml-1" data-testid={`dispute-explanation-${dispute.id}`}>
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-amber-400 mb-1">
          ◆ Maker explanation
        </div>
        <p className="font-mono text-sm text-[#e5e5e5] leading-relaxed whitespace-pre-wrap">
          {dispute.explanation}
        </p>
      </div>

      {dispute.status === "open" ? (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onResolve("upheld")}
            className="px-3 py-2 border border-emerald-500 text-emerald-400 hover:bg-emerald-500/10 font-mono text-[10px] uppercase tracking-[0.22em]"
            data-testid={`dispute-uphold-${dispute.id}`}
          >
            <Check size={12} className="inline mr-1" />
            Uphold (remove review)
          </button>
          <button
            type="button"
            onClick={() => onResolve("denied")}
            className="px-3 py-2 border border-[#525252] text-[#a3a3a3] hover:border-[#a3a3a3] hover:text-[#e5e5e5] font-mono text-[10px] uppercase tracking-[0.22em]"
            data-testid={`dispute-deny-${dispute.id}`}
          >
            <X size={12} className="inline mr-1" />
            Deny (review stays)
          </button>
        </div>
      ) : (
        <div className="font-mono text-[10px] text-[#a3a3a3]">
          Resolved {timeAgo(dispute.resolved_at)} by {dispute.resolved_by}
          {dispute.admin_note && (<>
            {" · note: "}<span className="text-[#e5e5e5]">{dispute.admin_note}</span>
          </>)}
        </div>
      )}
    </article>
  );
}

function ResolveDialog({ dispute, status, onCancel, onResolved }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await adminResolveReviewDispute(dispute.id, { status, admin_note: note.trim() });
      toast.success(`Dispute ${status}. Maker notified.`);
      onResolved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't resolve.");
    } finally {
      setBusy(false);
    }
  };
  const verdictColor = status === "upheld" ? "border-emerald-500" : "border-[#525252]";
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
      onClick={onCancel}
      data-testid="dispute-resolve-dialog"
    >
      <div
        className={`bg-[#0a0a0a] border ${verdictColor} w-full max-w-md p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          ◆ {status === "upheld" ? "Uphold dispute (remove review)" : "Deny dispute (keep review)"}
        </div>
        <h3 className="font-display text-2xl mt-2 text-[#e5e5e5]">
          Confirm verdict
        </h3>
        <p className="font-mono text-xs text-[#a3a3a3] mt-3 leading-relaxed">
          The maker ({dispute.maker_name || dispute.maker_slug}) will be emailed with this verdict + your optional note.
          {status === "upheld" && (
            <> The review will be <b className="text-emerald-400">permanently deleted</b> from the public collection.</>
          )}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-4">
          Note for the maker (optional)
        </p>
        <textarea
          rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. We confirmed via order records that no purchase was made — review removed."
          className="w-full mt-2 bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5] resize-none leading-relaxed"
          data-testid="dispute-resolve-note"
        />
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-3 py-2 border border-[#262626] hover:border-[#a3a3a3] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]"
            data-testid="dispute-resolve-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className={`flex-1 px-3 py-2 border font-mono text-[10px] uppercase tracking-[0.22em] ${
              status === "upheld"
                ? "border-emerald-500 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
                : "border-[#a3a3a3] text-[#e5e5e5] hover:bg-[#1a1a1a]"
            } disabled:opacity-50`}
            data-testid="dispute-resolve-confirm"
          >
            {busy ? "…" : `Confirm ${status} →`}
          </button>
        </div>
      </div>
    </div>
  );
}
