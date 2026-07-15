import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { createBuyerReturnCase, fetchBuyerCaseEligibility, fetchReturnCaseReasons } from "../lib/api";

export default function BuyerOrderHelp({ sessionId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState(null);
  const [reasons, setReasons] = useState(null);
  const [selected, setSelected] = useState({});
  const [reason, setReason] = useState("damaged");
  const [resolution, setResolution] = useState("return_for_refund");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || meta) return;
    setBusy(true);
    Promise.all([fetchBuyerCaseEligibility(sessionId), fetchReturnCaseReasons()])
      .then(([m, r]) => { setMeta(m); setReasons(r); })
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load return eligibility."))
      .finally(() => setBusy(false));
  }, [open, meta, sessionId]);

  async function submit() {
    const items = Object.entries(selected).filter(([, v]) => v).map(([order_item_id]) => ({ order_item_id, quantity_affected: 1 }));
    if (!items.length) return toast.error("Select at least one affected item.");
    if (explanation.trim().length < 10) return toast.error("Add a short explanation.");
    setBusy(true); setErr("");
    try {
      const created = await createBuyerReturnCase(sessionId, { case_type: reason, reason_code: reason, requested_resolution: resolution, explanation, items });
      toast.success(`Case ${created.public_case_number} opened.`);
      setOpen(false); setMeta(null); setSelected({}); setExplanation("");
      onCreated?.(created);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not open the case.");
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3" data-testid={`buyer-order-help-${sessionId}`}>
      <button onClick={() => setOpen((v) => !v)} className="border border-brand text-brand hover:bg-brand hover:text-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition" data-testid={`get-help-order-${sessionId}`}>
        Get Help With This Order
      </button>
      {open && (
        <div className="mt-3 border border-line bg-surface p-4" data-testid={`case-create-panel-${sessionId}`}>
          {busy && !meta && <p className="font-mono text-xs text-ink-muted">Loading policy and order details...</p>}
          {err && <p className="font-mono text-xs text-red-400 mb-3">{err}</p>}
          {meta && (
            <>
              <div className="mb-4 border border-line/70 p-3">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mb-1">Applicable policy snapshot</div>
                <p className="font-mono text-[10px] text-ink-muted leading-relaxed">Marketplace policy source: {meta.policy_snapshot?.source}. Checkout policy version: {meta.policy_snapshot?.checkout_policy_version || "best-known current policy"}.</p>
                {(meta.policy_snapshot?.maker_terms || []).map((m) => <p key={m.maker_slug} className="font-mono text-[10px] text-ink-muted leading-relaxed mt-1">{m.maker_name || m.maker_slug}: {m.return_policy}</p>)}
              </div>
              {meta.existing_cases?.length > 0 && <p className="font-mono text-[10px] text-yellow-600 mb-3">Active case already on this order: {meta.existing_cases.map((c) => c.public_case_number).join(", ")}</p>}
              <div className="space-y-2 mb-4">
                {meta.items.map((item) => (
                  <label key={item.order_item_id} className="flex items-start gap-3 border border-line/60 p-2 font-mono text-xs" data-testid={`case-item-${item.order_item_id}`}>
                    <input type="checkbox" checked={!!selected[item.order_item_id]} onChange={(e) => setSelected((s) => ({ ...s, [item.order_item_id]: e.target.checked }))} />
                    <span><span className="text-ink">{item.title}</span><br/><span className="text-ink-muted">Qty {item.quantity} · {item.is_custom ? "custom" : "standard"} · {item.is_digital ? "digital" : "physical"}</span></span>
                  </label>
                ))}
              </div>
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <select value={reason} onChange={(e) => setReason(e.target.value)} className="input-industrial" data-testid="case-reason-select">
                  {Object.entries(reasons?.case_types || {}).filter(([k]) => !k.includes("dispute")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="input-industrial" data-testid="case-resolution-select">
                  {Object.entries(reasons?.requested_resolutions || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={4} className="input-industrial w-full" placeholder="Explain what happened and the outcome you prefer." data-testid="case-explanation" />
              <button onClick={submit} disabled={busy} className="btn-industrial btn-primary mt-3" data-testid="submit-return-case">{busy ? "Submitting..." : "Open Case"}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
