import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminRefundOrder, adminRefireOrderEmails } from "../../lib/api";
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
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="orders-empty-admin">
        No paid orders yet.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="orders-list-admin">
      {confirmModal}
      {items.map((o) => {
        const isRefunded = refunded.has(o.session_id) || o.refund_status === "refunded";
        return (
          <div
            key={o.session_id}
            className={`border border-[#262626] transition p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2 ${
              isRefunded ? "opacity-60" : "hover:border-[#ff4500]"
            }`}
            data-testid={`paid-order-${o.session_id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
                ◆ {isRefunded ? "Refunded" : "Paid"} · {formatDate(o.created_at)}
              </div>
              <div className="font-mono text-xs text-[#e5e5e5] mt-1 truncate">{o.summary}</div>
              <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">
                {o.customer_email || "no buyer email"} ·{" "}
                <span className="text-[#525252]">{o.session_id?.slice(0, 16)}…</span>
              </div>
              {err[o.session_id] && (
                <p className="font-mono text-[10px] text-red-400 mt-1">{err[o.session_id]}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="font-display text-3xl text-[#ff4500]">
                ${(o.amount || 0).toFixed(2)}
              </div>
              {!isRefunded ? (
                <button
                  onClick={() => refund(o.session_id)}
                  disabled={refunding === o.session_id}
                  className="font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-2 border border-[#262626] hover:border-red-400 hover:text-red-400 transition disabled:opacity-50"
                  data-testid={`order-refund-btn-${o.session_id}`}
                >
                  {refunding === o.session_id ? "Refunding…" : "⊗ Refund"}
                </button>
              ) : (
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400"
                  data-testid={`order-refunded-${o.session_id}`}
                >
                  ✓ Refunded
                </span>
              )}
              <button
                onClick={() => refire(o.session_id)}
                disabled={refiring === o.session_id}
                title="Re-send the buyer receipt + maker order email + ops alert"
                className="font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition disabled:opacity-50"
                data-testid={`order-refire-btn-${o.session_id}`}
              >
                {refiring === o.session_id ? "Sending…" : "✉ Refire"}
              </button>
              {refireLog[o.session_id] && (
                <span
                  className="font-mono text-[10px] text-[#a3a3a3] whitespace-nowrap"
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
