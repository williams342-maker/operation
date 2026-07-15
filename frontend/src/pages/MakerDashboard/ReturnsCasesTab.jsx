import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { approveMakerCaseRefund, approveMakerCaseReplacement, approveMakerCaseReturn, createMakerPartialRefundOffer, denyMakerCase, escalateMakerCase, fetchMakerReturnCase, fetchMakerReturnCases, sendMakerCaseMessage } from "../../lib/api";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function ReturnsCasesTab() {
  const [cases, setCases] = useState([]);
  const [active, setActive] = useState(null);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const load = () => fetchMakerReturnCases(status ? { status } : {}).then((r) => setCases(r.cases || [])).catch(() => toast.error("Could not load cases."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [status]);
  useEffect(() => { if (active) fetchMakerReturnCase(active).then(setDetail).catch(() => toast.error("Could not load case.")); }, [active]);

  async function act(fn, ok) {
    if (!detail) return;
    setBusy(true);
    try { const r = await fn(); toast.success(ok); setDetail(r.case || r); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed."); }
    finally { setBusy(false); }
  }

  return (
    <section data-testid="maker-returns-cases" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-display text-3xl text-ink">Returns & Cases</h2><p className="font-mono text-xs text-ink-muted">Manage buyer help requests, returns, refunds, replacements, and escalations.</p></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-industrial w-56" data-testid="maker-case-filter"><option value="">All statuses</option><option value="waiting_for_maker">Waiting for maker</option><option value="waiting_for_buyer">Waiting for buyer</option><option value="return_approved">Return approved</option><option value="under_admin_review">Admin review</option><option value="refund_completed">Refunded</option></select>
      </div>
      <div className="grid lg:grid-cols-[360px_1fr] gap-4">
        <div className="border border-line divide-y divide-line bg-paper" data-testid="maker-case-list">
          {cases.length === 0 && <p className="p-4 font-mono text-xs text-ink-muted">No cases match this filter.</p>}
          {cases.map((c) => <button key={c.id} onClick={() => setActive(c.id)} className={`w-full text-left p-4 hover:bg-surface ${active === c.id ? "bg-brand/10" : ""}`} data-testid={`maker-case-${c.id}`}><div className="font-mono text-xs text-ink">{c.public_case_number}</div><div className="font-mono text-[10px] text-ink-muted">{c.reason_code} · {money(c.amount_at_risk)} · {c.current_status}</div><div className="font-mono text-[10px] text-ink-muted">Due {(c.maker_response_due_at || "").slice(0, 10) || "—"}</div></button>)}
        </div>
        <div className="border border-line bg-paper p-5 min-h-[420px]" data-testid="maker-case-detail">
          {!detail ? <p className="font-mono text-xs text-ink-muted">Select a case.</p> : <>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4"><div><h3 className="font-display text-2xl text-ink">{detail.public_case_number}</h3><p className="font-mono text-xs text-ink-muted">Order {detail.order_id} · {detail.current_status} · at risk {money(detail.amount_at_risk)}</p></div><button onClick={() => act(() => escalateMakerCase(detail.id), "Escalated to admin.")} className="border border-line px-3 py-1.5 font-mono text-[10px] uppercase" disabled={busy}>Escalate</button></div>
            <div className="grid md:grid-cols-2 gap-3 mb-4">{(detail.items || []).map((i) => <div key={i.id} className="border border-line/70 p-3"><div className="font-mono text-xs text-ink">{i.title}</div><div className="font-mono text-[10px] text-ink-muted">Qty affected {i.quantity_affected} · {i.is_custom ? "custom" : "standard"} · {i.is_digital ? "digital" : "physical"}</div></div>)}</div>
            {detail.return_authorization && <div className="border border-brand/50 p-3 mb-4" data-testid="return-authorization"><div className="font-mono text-[10px] uppercase text-brand">Return authorization {detail.return_authorization.authorization_number}</div><p className="font-mono text-xs text-ink-muted">Ship by {(detail.return_authorization.return_deadline || "").slice(0, 10)} · {detail.return_authorization.shipping_paid_by} pays shipping</p></div>}
            <div className="grid md:grid-cols-2 gap-3 mb-4">
              <button onClick={() => act(() => approveMakerCaseReturn(detail.id, { shipping_paid_by: "buyer" }), "Return approved.")} className="btn-industrial" disabled={busy}>Approve return</button>
              <button onClick={() => act(() => approveMakerCaseReplacement(detail.id, { notes: reason || "Replacement approved" }), "Replacement approved.")} className="btn-industrial" disabled={busy}>Approve replacement</button>
              <button onClick={() => act(() => approveMakerCaseRefund(detail.id, { amount: amount ? Number(amount) : undefined, reason: reason || "Case refund" }), "Refund recorded.")} className="btn-industrial btn-primary" disabled={busy}>Approve refund</button>
              <button onClick={() => act(() => createMakerPartialRefundOffer(detail.id, { amount: Number(amount || 0), explanation: reason || "Partial refund offer" }), "Offer sent.")} className="btn-industrial" disabled={busy}>Offer partial refund</button>
            </div>
            <div className="grid md:grid-cols-2 gap-3 mb-4"><input value={amount} onChange={(e) => setAmount(e.target.value)} className="input-industrial" placeholder={`Amount, max ${money(detail.remaining_refundable_amount)}`} data-testid="maker-case-refund-amount"/><input value={reason} onChange={(e) => setReason(e.target.value)} className="input-industrial" placeholder="Explanation / denial reason" data-testid="maker-case-reason"/></div>
            <button onClick={() => act(() => denyMakerCase(detail.id, { reason: reason || "Denied based on submitted evidence" }), "Case denied.")} className="border border-red-500 text-red-400 px-3 py-2 font-mono text-[10px] uppercase" disabled={busy}>Deny request</button>
            <div className="mt-5 border-t border-line pt-4"><h4 className="font-mono text-[10px] uppercase text-ink-muted mb-2">Messages</h4>{(detail.messages || []).map((m) => <div key={m.id} className="mb-2 font-mono text-xs"><b>{m.sender_role}</b>: <span dangerouslySetInnerHTML={{ __html: m.message_body }} /></div>)}<textarea value={message} onChange={(e) => setMessage(e.target.value)} className="input-industrial w-full" rows={3} placeholder="Ask for more info or respond to the buyer."/><button onClick={() => act(() => sendMakerCaseMessage(detail.id, { message_body: message }), "Message sent.").then(() => setMessage(""))} className="btn-industrial mt-2" disabled={busy || !message.trim()}>Send message</button></div>
          </>}
        </div>
      </div>
    </section>
  );
}

