/**
 * Backorders sub-tab content — the maker side of the request-only
 * backorder flow. Buyers submit requests via the product detail OOS
 * pill; this is where makers accept, decline (with optional reason), or
 * mark fulfilled (after coordinating payment + shipping off-platform).
 *
 * Status pills mirror the request lifecycle in the backend:
 *   pending   → orange (awaiting maker decision)
 *   accepted  → emerald (active backorder, pending fulfillment)
 *   fulfilled → grey ✓ (closed loop)
 *   declined  → red ✕ (closed, with reason)
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Mail, Clock, ChevronDown } from "lucide-react";
import {
  acceptBackorderRequest, declineBackorderRequest, fulfillBackorderRequest,
} from "../../lib/api";
import EmptyState from "../../components/EmptyState";
import DeclineReasonPicker from "../../components/DeclineReasonPicker";
import { formatDate } from "./_shared";

const STATUS_CLASS = {
  pending:   "border-[#ff4500]/50 text-[#ff4500] bg-[#ff4500]/5",
  accepted:  "border-emerald-400/50 text-emerald-400 bg-emerald-400/5",
  fulfilled: "border-[#525252]/50 text-[#a3a3a3] bg-[#525252]/5",
  declined:  "border-red-500/50 text-red-400 bg-red-500/5",
};

export default function BackordersList({ requests, onChange }) {
  if (!requests.length) {
    return (
      <EmptyState
        icon={Clock}
        eyebrow="◆ Backorders"
        title="No backorder requests."
        body="Once a buyer submits a backorder on one of your 0-stock listings, it lands here for you to accept or decline."
        testId="backorders-empty"
      />
    );
  }
  return (
    <div className="space-y-3" data-testid="backorders-list">
      {requests.map((r) => (
        <BackorderRow key={r.id} req={r} onChange={onChange} />
      ))}
    </div>
  );
}


function BackorderRow({ req, onChange }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const wrap = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      await onChange?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const accept = () => wrap(() => acceptBackorderRequest(req.id), "Accepted — buyer notified.");
  const fulfill = () => wrap(() => fulfillBackorderRequest(req.id), "Marked as fulfilled.");
  const decline = () => {
    setShowDecline(false);
    return wrap(() => declineBackorderRequest(req.id, declineReason.trim()), "Declined — buyer notified.");
  };

  const status = req.status || "pending";
  return (
    <div className="border border-[#262626]" data-testid={`backorder-row-${req.id}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-[#1a1a1a]/40 transition"
      >
        <span className={`px-2 py-0.5 border font-mono text-[10px] uppercase tracking-[0.22em] shrink-0 ${STATUS_CLASS[status] || STATUS_CLASS.pending}`}>
          {status}
        </span>
        <span className="px-2 py-0.5 border border-[#ff4500] text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] shrink-0">
          ◆ Backorder
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-display text-base text-[#e5e5e5] truncate">{req.product_title}</div>
          <div className="font-mono text-[11px] text-[#a3a3a3] mt-0.5 truncate">
            {req.buyer_name} · qty {req.quantity} · {formatDate(req.created_at)}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`shrink-0 text-[#a3a3a3] transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-[#262626] px-5 py-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3 font-mono text-xs">
            <div>
              <div className="text-[#525252] uppercase tracking-[0.22em] text-[10px] mb-1">Buyer</div>
              <div className="text-[#e5e5e5]">{req.buyer_name}</div>
              <a href={`mailto:${req.buyer_email}`} className="text-[#ff4500] hover:underline inline-flex items-center gap-1.5 mt-1">
                <Mail size={12} /> {req.buyer_email}
              </a>
            </div>
            <div>
              <div className="text-[#525252] uppercase tracking-[0.22em] text-[10px] mb-1">Lead time quoted</div>
              <div className="text-[#e5e5e5]">
                ~{req.lead_weeks_quoted || 4} {(req.lead_weeks_quoted || 4) === 1 ? "week" : "weeks"}
              </div>
            </div>
          </div>
          {req.message && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-1.5">Buyer message</div>
              <div className="font-mono text-xs text-[#e5e5e5] leading-relaxed border-l-2 border-[#ff4500] pl-3 whitespace-pre-line">
                {req.message}
              </div>
            </div>
          )}
          {req.decline_reason && status === "declined" && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-1.5">Your decline note</div>
              <div className="font-mono text-xs text-[#e5e5e5] leading-relaxed border-l-2 border-red-400 pl-3 whitespace-pre-line">
                {req.decline_reason}
              </div>
            </div>
          )}

          {status === "pending" && !showDecline && (
            <div className="flex gap-2 flex-wrap pt-2">
              <button
                type="button"
                onClick={accept}
                disabled={busy}
                data-testid={`backorder-accept-${req.id}`}
                className="btn-industrial btn-primary disabled:opacity-50"
              >
                ✓ Accept
              </button>
              <button
                type="button"
                onClick={() => setShowDecline(true)}
                disabled={busy}
                data-testid={`backorder-show-decline-${req.id}`}
                className="px-5 py-3 border border-[#262626] hover:border-red-500 hover:text-red-400 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              >
                ✕ Decline
              </button>
              <p className="font-mono text-[10px] text-[#525252] basis-full leading-relaxed">
                Accepting confirms your lead time + emails the buyer. Payment is coordinated directly between you and them.
              </p>
            </div>
          )}

          {status === "pending" && showDecline && (
            <div className="space-y-3 pt-2" data-testid={`backorder-decline-form-${req.id}`}>
              <DeclineReasonPicker
                kind="backorder"
                value={declineReason}
                onChange={setDeclineReason}
                testIdPrefix={`backorder-decline-${req.id}`}
                placeholder="e.g. Booked through Q3 — happy to revisit in October."
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={decline}
                  disabled={busy}
                  data-testid={`backorder-decline-${req.id}`}
                  className="px-5 py-3 border border-red-500 text-red-400 hover:bg-red-500/10 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                >
                  Send decline
                </button>
                <button
                  type="button"
                  onClick={() => { setShowDecline(false); setDeclineReason(""); }}
                  className="px-5 py-3 border border-[#262626] hover:border-[#525252] font-mono text-[11px] uppercase tracking-[0.22em] transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {status === "accepted" && (
            <div className="flex gap-2 flex-wrap pt-2">
              <button
                type="button"
                onClick={fulfill}
                disabled={busy}
                data-testid={`backorder-fulfill-${req.id}`}
                className="btn-industrial btn-primary disabled:opacity-50"
              >
                ✓ Mark fulfilled
              </button>
              <p className="font-mono text-[10px] text-[#525252] basis-full leading-relaxed">
                Click once you've collected payment + shipped the piece. Buyer doesn't get re-emailed on fulfillment — they already had your contact info from the acceptance email.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
