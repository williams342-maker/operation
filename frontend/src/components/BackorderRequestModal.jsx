/**
 * BackorderRequestModal — surfaced from the ProductDetail page when a
 * listing is at 0 stock AND the maker accepts backorders. Buyer fills in
 * name, email, qty, and an optional message; we POST to
 * /api/products/{slug}/backorder-request which kicks off both buyer
 * confirmation + maker alert emails. No payment is collected here —
 * payment is coordinated off-platform between maker and buyer once the
 * maker accepts (per product decision: request-only flow).
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { submitBackorderRequest } from "../lib/api";

export default function BackorderRequestModal({
  productSlug, productTitle, makerName, leadWeeks, onClose,
}) {
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!buyerName.trim() || !buyerEmail.trim()) {
      toast.error("Name and email are required.");
      return;
    }
    setBusy(true);
    try {
      await submitBackorderRequest(productSlug, {
        buyer_name: buyerName.trim(),
        buyer_email: buyerEmail.trim(),
        quantity: Math.max(1, parseInt(quantity, 10) || 1),
        message: message.trim(),
      });
      setDone(true);
      toast.success("Backorder request sent.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't submit request — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="backorder-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] bg-paper border border-line max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-line flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
              ◆ Backorder request
            </div>
            <div className="font-display text-2xl mt-1">{productTitle}</div>
            <div className="font-mono text-xs text-ink-muted mt-1">
              by {makerName} · ~{leadWeeks} {leadWeeks === 1 ? "week" : "weeks"} after acceptance
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="backorder-close"
            className="px-2.5 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {done ? (
          <div className="p-6 space-y-4 text-center" data-testid="backorder-done">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Sent</div>
            <div className="font-display text-3xl">Request received.</div>
            <p className="font-mono text-xs text-ink-muted leading-relaxed">
              {makerName} will review and reach out within 2 business days.
              We sent a copy to <span className="text-ink">{buyerEmail}</span>.
              No charge today.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3 border border-line hover:border-brand hover:text-brand font-mono text-[11px] uppercase tracking-[0.22em] transition mt-2"
              data-testid="backorder-close-after-send"
            >
              ✕ Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6 space-y-4">
            <Field label="Your name">
              <input
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                required
                data-testid="backorder-name"
                className={inputCls}
                autoFocus
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                required
                data-testid="backorder-email"
                className={inputCls}
              />
            </Field>
            <Field label="Quantity">
              <input
                type="number"
                min={1}
                max={50}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                data-testid="backorder-qty"
                className={inputCls + " w-32"}
              />
            </Field>
            <Field label="Message to the maker (optional)" hint="Customizations, deadline, color preferences — anything that helps them quote it.">
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                data-testid="backorder-message"
                className={inputCls}
                placeholder="e.g. Need by mid-July, ideally in matte black finish."
              />
            </Field>
            <div className="border border-line p-3 font-mono text-[11px] text-ink-muted leading-relaxed">
              <div className="text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1.5">◆ How this works</div>
              The maker reviews your request and emails you within 2 business
              days. If they accept, payment + shipping are handled directly
              between you and them. <b className="text-ink">No charge today.</b>
            </div>
            <button
              type="submit"
              disabled={busy}
              data-testid="backorder-submit"
              className="btn-industrial btn-primary w-full justify-center disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send request →"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1.5">{label}</div>
      {children}
      {hint && <div className="font-mono text-[10px] text-ink-muted mt-1 leading-relaxed">{hint}</div>}
    </label>
  );
}

const inputCls =
  "w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2.5 font-mono text-xs text-ink placeholder:text-ink-muted";
