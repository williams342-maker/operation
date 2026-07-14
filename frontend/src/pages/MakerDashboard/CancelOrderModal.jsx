/**
 * iter459 — Maker order cancellation modal.
 * Flow: contact-buyer nudge → reason + note form → confirm refund → result.
 * "Cancel and Refund" is the only maker option on paid orders (cancel
 * without refund is admin-only).
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, MessageSquare, AlertTriangle } from "lucide-react";
import { http, authHeaders } from "../../lib/api";

export default function CancelOrderModal({ order, onClose, onDone }) {
  const [groups, setGroups] = useState([]);
  const [step, setStep] = useState("nudge"); // nudge | form | processing | failed
  const [reason, setReason] = useState("");
  const [explanation, setExplanation] = useState("");
  const [note, setNote] = useState("");
  const [noRestore, setNoRestore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    http.get("/orders/cancel-reasons").then((r) => setGroups(r.data.groups || [])).catch(() => {});
  }, []);

  const amount = order.order_total || order.maker_subtotal || 0;

  async function submit() {
    if (!reason) { toast.error("Pick a cancellation reason."); return; }
    if (reason === "other" && explanation.trim().length < 5) {
      toast.error("'Other' requires a short explanation."); return;
    }
    setStep("processing");
    setError("");
    try {
      await http.post(`/maker/orders/${order.session_id}/cancel`, {
        reason, explanation, note_to_buyer: note, restore_inventory: !noRestore,
      }, { headers: authHeaders() });
      toast.success("Order canceled — refund issued and buyer notified.");
      onDone?.();
      onClose();
    } catch (e) {
      setError(e?.response?.data?.detail || "Cancellation failed.");
      setStep("failed");
    }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4"
         onClick={onClose} data-testid="cancel-order-modal">
      <div className="bg-paper border border-line max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="font-display text-xl text-ink">Cancel order</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" data-testid="cancel-modal-close">
            <X size={16} />
          </button>
        </div>

        {step === "nudge" && (
          <div className="space-y-4" data-testid="cancel-nudge-step">
            <div className="border border-brand/40 bg-brand/[0.05] p-4">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-brand mb-2">
                <MessageSquare size={12} /> Before you cancel…
              </div>
              <p className="font-mono text-xs text-ink-muted">
                Many issues resolve without cancelling — a short delay, a different color,
                or a remake next week. Buyers usually say yes.
              </p>
              <a href={`mailto:${order.buyer_email}?subject=${encodeURIComponent("About your Crafters Market order")}`}
                 className="mt-3 inline-block border border-brand text-brand px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] hover:bg-brand/10 transition"
                 data-testid="cancel-contact-buyer-btn">
                Message buyer first
              </a>
            </div>
            <button onClick={() => setStep("form")}
                    className="w-full border border-line hover:border-red-500 text-ink px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] transition"
                    data-testid="cancel-continue-btn">
              Continue to cancellation →
            </button>
          </div>
        )}

        {(step === "form" || step === "failed" || step === "processing") && (
          <div className="space-y-4" data-testid="cancel-form-step">
            <div className="border border-amber-500/50 bg-amber-500/[0.06] p-3 font-mono text-xs text-ink">
              This order has been <b>paid</b>. Cancelling will refund
              <b> ${amount.toFixed(2)}</b> to the buyer via
              {" "}{(order.payment_provider || "stripe") === "paypal" ? "PayPal" : "their card"} —
              this cannot be undone.
            </div>

            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted block mb-1">
                Reason (required)
              </label>
              <select value={reason} onChange={(e) => setReason(e.target.value)}
                      className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                      data-testid="cancel-reason-select">
                <option value="">— Select a reason —</option>
                {groups.map((g) => (
                  <optgroup key={g.id} label={g.label}>
                    {g.reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>

            {reason === "other" && (
              <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)}
                        placeholder="Explain the reason (required)…" rows={2}
                        className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                        data-testid="cancel-explanation" />
            )}

            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted block mb-1">
                Optional message to buyer
              </label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                        placeholder="e.g. We experienced an equipment failure and cannot complete your order."
                        className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                        data-testid="cancel-note" />
            </div>

            <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted cursor-pointer">
              <input type="checkbox" checked={noRestore} onChange={(e) => setNoRestore(e.target.checked)}
                     data-testid="cancel-no-restore" />
              Do not restore inventory (item damaged)
            </label>

            {step === "failed" && (
              <div className="border border-red-500/60 bg-red-500/[0.06] p-3 flex items-start gap-2"
                   data-testid="cancel-error">
                <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
                <p className="font-mono text-xs text-red-400">{error} The order remains open — our team has been alerted.</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={submit} disabled={step === "processing"}
                      className="flex-1 bg-red-600 hover:bg-red-500 text-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] font-bold transition disabled:opacity-50"
                      data-testid="cancel-confirm-btn">
                {step === "processing" ? "Refunding…" : `Cancel & refund $${amount.toFixed(2)}`}
              </button>
              <button onClick={onClose} disabled={step === "processing"}
                      className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted hover:text-ink transition">
                Keep order
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
