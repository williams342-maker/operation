import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminRefundOrder, adminRefireOrderEmails } from "../../lib/api";
import { http, adminAuthHeaders } from "../../lib/api";
import { formatDate } from "./_shared";
import { timeAgo } from "../../lib/timeAgo";
import { useConfirm } from "../../hooks/useConfirm";

// localStorage map: { [session_id]: ISO timestamp } — surface a
// "Last sent 2m ago" badge after admin clicks Refire so we don't
// accidentally double-fire emails.
const REFIRE_KEY = "cm_admin_refire_log";
const readRefireLog = () => {
  try { return JSON.parse(localStorage.getItem(REFIRE_KEY) || "{}"); }
  catch { return {}; }
};
const writeRefireLog = (m) => {
  try { localStorage.setItem(REFIRE_KEY, JSON.stringify(m)); } catch { /* ignore quota */ }
};

export default function PaidOrdersList({ items }) {
  const [refunding, setRefunding] = useState("");
  const [refiring, setRefiring] = useState("");
  const [refunded, setRefunded] = useState(() =>
    new Set(items.filter((o) => o.refund_status === "refunded").map((o) => o.session_id))
  );
  const [err, setErr] = useState({});
  const [refireLog, setRefireLog] = useState(readRefireLog);
  const [confirm, confirmModal] = useConfirm();
  // iter459 — cancellation stats + admin override actions
  const [cxlStats, setCxlStats] = useState(null);
  const [cxlBusy, setCxlBusy] = useState("");
  const H = () => ({ headers: adminAuthHeaders() });
  useEffect(() => {
    http.get("/admin/orders/cancellation-stats", H())
      .then((r) => setCxlStats(r.data)).catch(() => {});
  }, []);

  const cancelNoRefund = async (sid) => {
    const note = window.prompt(
      "Cancel WITHOUT refund (fraud / chargeback / abuse).\nInternal note (required):");
    if (!note || note.trim().length < 5) {
      if (note !== null) toast.error("Internal note (5+ chars) is required.");
      return;
    }
    setCxlBusy(sid);
    try {
      await http.post(`/admin/orders/${sid}/cancel`, {
        reason: "other", explanation: note.trim(), mode: "no_refund",
        internal_note: note.trim(), restore_inventory: true,
      }, H());
      toast.success("Order canceled without refund — logged with internal note.");
      window.location.reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Cancel failed."); }
    finally { setCxlBusy(""); }
  };

  const reopenOrder = async (sid) => {
    const ok = await confirm({
      title: "Reopen this order?",
      body: "Clears the cancellation and rolls back any inventory restoration. Only possible before a successful refund.",
      confirmLabel: "Reopen", tone: "primary", testId: `confirm-reopen-${sid}`,
    });
    if (!ok) return;
    setCxlBusy(sid);
    try {
      await http.post(`/admin/orders/${sid}/cancellation/reopen`, {}, H());
      toast.success("Order reopened.");
      window.location.reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Reopen failed."); }
    finally { setCxlBusy(""); }
  };

  const editReason = async (sid, current) => {
    const reason = window.prompt(
      "New reason id (out-of-stock, inventory-error, damaged-before-shipment, unable-to-manufacture, equipment-failure, material-unavailable, production-delay, buyer-requested, incorrect-address, buyer-changed-mind, ordered-by-mistake, mutual-agreement, shipping-unavailable, shipping-cost-too-high, restricted-destination, other):",
      current || "");
    if (!reason) return;
    const explanation = reason === "other" ? (window.prompt("Explanation (required for 'other'):") || "") : "";
    try {
      await http.patch(`/admin/orders/${sid}/cancellation`, { reason, explanation }, H());
      toast.success("Reason updated.");
      window.location.reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Update failed."); }
  };
  // Tick once per minute so the timeAgo label refreshes without
  // forcing the admin to reload.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const refund = async (sid) => {
    const ok = await confirm({
      title: "Full refund this order?",
      body: "Reverses the buyer's charge AND every maker payout for this order. Platform fee is also refunded. This cannot be undone.",
      confirmLabel: "Refund order",
      tone: "danger",
      testId: `confirm-refund-${sid}`,
    });
    if (!ok) return;
    setRefunding(sid); setErr((e) => ({ ...e, [sid]: "" }));
    try {
      const r = await adminRefundOrder(sid);
      if (r.requires_approval) {
        const msg = `Refund of $${r.amount.toFixed(2)} needs a second admin's approval (≥$${r.threshold} threshold). Pending request created — find it under "Refund Approvals".`;
        setErr((p) => ({ ...p, [sid]: msg }));
        toast.warning(msg);
      } else {
        setRefunded((rs) => new Set(rs).add(sid));
        toast.success("Order refunded — buyer + maker reversals fired.");
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Refund failed.";
      setErr((p) => ({ ...p, [sid]: msg }));
      toast.error(msg);
    } finally {
      setRefunding("");
    }
  };

  const refire = async (sid) => {
    setRefiring(sid); setErr((e) => ({ ...e, [sid]: "" }));
    try {
      const r = await adminRefireOrderEmails(sid);
      const failed = (r.failed || []).length;
      const sentN = (r.sent || []).length;
      if (failed) {
        toast.warning(`Sent ${sentN}, failed ${failed}. Check logs.`);
      } else {
        toast.success(`Re-fired ${sentN} email${sentN === 1 ? "" : "s"} (buyer + maker + ops).`);
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Refire failed.";
      setErr((p) => ({ ...p, [sid]: msg }));
      toast.error(msg);
    } finally {
      setRefiring("");
    }
  };

  if (!items.length) {
    return (
      <p className="font-mono text-sm text-ink-muted" data-testid="orders-empty-admin">
        No paid orders yet.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="orders-list-admin">
      {confirmModal}
      {/* iter459 — Cancellation analytics strip */}
      {cxlStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-line border border-line mb-4" data-testid="cancellation-stats">
          {[["Cancellation rate", `${(cxlStats.cancellation_rate * 100).toFixed(1)}%`],
            ["Cancelled orders", cxlStats.canceled_orders],
            ["Refund total", `$${(cxlStats.refund_total || 0).toFixed(2)}`],
            ["Avg hrs to cancel", cxlStats.avg_hours_to_cancel ?? "—"],
            ["Top reason", cxlStats.top_reasons?.[0]?.label || "—"]].map(([l, v]) => (
            <div key={l} className="bg-paper px-3 py-2">
              <div className="font-display text-xl text-ink">{v}</div>
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">{l}</div>
            </div>
          ))}
        </div>
      )}
      {items.map((o) => {
        const isRefunded = refunded.has(o.session_id) || o.refund_status === "refunded";
        const cxl = o.cancellation;
        return (
          <div
            key={o.session_id}
            className={`border border-line transition p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2 ${
              isRefunded ? "opacity-60" : "hover:border-brand"
            }`}
            data-testid={`paid-order-${o.session_id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
                ◆ {isRefunded ? "Refunded" : "Paid"} · {formatDate(o.created_at)}
                {o.payment_provider === "paypal" && (
                  <span
                    className="ml-2 px-1.5 py-0.5 border border-sky-500/40 text-sky-600 normal-case tracking-normal"
                    data-testid={`order-provider-paypal-${o.session_id}`}
                  >
                    PayPal
                  </span>
                )}
              </div>
              <div className="font-mono text-xs text-ink mt-1 truncate">{o.summary}</div>
              <div className="font-mono text-[10px] text-ink-muted mt-1">
                {o.customer_email || "no buyer email"} ·{" "}
                <span className="text-ink-muted">{o.session_id?.slice(0, 16)}…</span>
              </div>
              {o.payment_provider === "paypal" && (
                <div
                  className="font-mono text-[10px] text-ink-muted mt-1"
                  data-testid={`order-paypal-ids-${o.session_id}`}
                >
                  PP order {o.paypal_order_id || "—"} · capture {o.paypal_capture_id || "—"}
                  {o.paypal_fees && (
                    <span>
                      {" "}· gross ${((o.paypal_fees.gross_cents || 0) / 100).toFixed(2)}
                      {" "}· PayPal fee ${((o.paypal_fees.paypal_fee_cents || 0) / 100).toFixed(2)}
                      {" "}· net ${((o.paypal_fees.net_cents || 0) / 100).toFixed(2)}
                    </span>
                  )}
                </div>
              )}
              {(o.payouts || []).map((p) => (
                <div
                  key={`${p.session_id}-${p.maker_slug}`}
                  className="font-mono text-[10px] text-ink-muted mt-1"
                  data-testid={`order-payout-${o.session_id}-${p.maker_slug}`}
                >
                  ↳ {p.maker_slug} · commission ${((p.commission_cents || 0) / 100).toFixed(2)}
                  {" "}· maker net ${((p.amount_cents || 0) / 100).toFixed(2)} ·{" "}
                  <span
                    className={`border px-1 py-0.5 uppercase tracking-[0.12em] ${
                      p.status === "paid"
                        ? "text-green-600 border-green-500/40"
                        : p.status === "processing"
                          ? "text-sky-600 border-sky-500/40"
                          : p.status === "failed"
                            ? "text-red-400 border-red-400/40"
                            : "text-amber-500 border-amber-400/40"
                    }`}
                    data-testid={`order-payout-status-${o.session_id}-${p.maker_slug}`}
                  >
                    payout {p.status}
                  </span>
                  {p.payout_batch_id && <span> · batch {p.payout_batch_id}</span>}
                </div>
              ))}
              {err[o.session_id] && (
                <p className="font-mono text-[10px] text-red-400 mt-1">{err[o.session_id]}</p>
              )}
              {/* iter459 — cancellation record */}
              {cxl && (
                <div className="font-mono text-[10px] mt-1" data-testid={`order-cancellation-${o.session_id}`}>
                  <span className={`border px-1.5 py-0.5 uppercase tracking-[0.12em] ${
                    cxl.status === "canceled_refunded" ? "text-purple-500 border-purple-500/40"
                    : cxl.status === "refund_failed" ? "text-red-400 border-red-400/50"
                    : cxl.status === "refund_processing" ? "text-yellow-600 border-yellow-500/40"
                    : "text-red-400 border-red-400/50"}`}>
                    {cxl.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-ink-muted ml-2">
                    {cxl.reason} · by {cxl.initiated_by}:{cxl.initiated_by_id}
                    {cxl.internal_note && ` · note: ${cxl.internal_note}`}
                  </span>
                  <button onClick={() => editReason(o.session_id, cxl.reason)}
                          className="ml-2 underline text-ink-muted hover:text-brand"
                          data-testid={`order-edit-reason-${o.session_id}`}>
                    edit reason
                  </button>
                  {cxl.status !== "canceled_refunded" && (
                    <button onClick={() => reopenOrder(o.session_id)}
                            disabled={cxlBusy === o.session_id}
                            className="ml-2 underline text-ink-muted hover:text-brand disabled:opacity-50"
                            data-testid={`order-reopen-${o.session_id}`}>
                      reopen
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="font-display text-3xl text-brand">
                ${(o.amount || 0).toFixed(2)}
              </div>
              {!isRefunded ? (
                <button
                  onClick={() => refund(o.session_id)}
                  disabled={refunding === o.session_id}
                  className="font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-2 border border-line hover:border-red-400 hover:text-red-400 transition disabled:opacity-50"
                  data-testid={`order-refund-btn-${o.session_id}`}
                >
                  {refunding === o.session_id ? "Refunding…" : "⊗ Refund"}
                </button>
              ) : (
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700"
                  data-testid={`order-refunded-${o.session_id}`}
                >
                  ✓ Refunded
                </span>
              )}
              {!isRefunded && !cxl && (
                <button
                  onClick={() => cancelNoRefund(o.session_id)}
                  disabled={cxlBusy === o.session_id}
                  title="Admin-only: cancel WITHOUT refund (fraud / chargeback / abuse). Requires an internal note."
                  className="font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-2 border border-line hover:border-red-400 hover:text-red-400 transition disabled:opacity-50"
                  data-testid={`order-cancel-norefund-btn-${o.session_id}`}
                >
                  ⊘ No-refund
                </button>
              )}
              <button
                onClick={() => refire(o.session_id)}
                disabled={refiring === o.session_id}
                title="Re-send the buyer receipt + maker order email + ops alert"
                className="font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-2 border border-line hover:border-brand hover:text-brand transition disabled:opacity-50"
                data-testid={`order-refire-btn-${o.session_id}`}
              >
                {refiring === o.session_id ? "Sending…" : "✉ Refire"}
              </button>
              {refireLog[o.session_id] && (
                <span
                  className="font-mono text-[10px] text-ink-muted whitespace-nowrap"
                  data-testid={`order-refire-last-${o.session_id}`}
                  title={`Last refired at ${new Date(refireLog[o.session_id]).toLocaleString()}`}
                >
                  Last sent {timeAgo(refireLog[o.session_id])}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
