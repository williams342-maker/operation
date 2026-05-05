import React, { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchDiscountCodes, createDiscountCode, toggleDiscountCode, deleteDiscountCode,
} from "../../../lib/api";
import { useConfirm } from "../useConfirm";
import Section from "./Section";

/**
 * Discount-codes panel — full CRUD over per-shop promo codes (percent /
 * fixed dollar / free shipping). Codes apply at checkout when buyers
 * paste them in.
 *
 * Extracted from MarketingTab.jsx in iter131. Self-contained: holds its
 * own refresh state + confirm dialog; no shared state with AdsSection.
 */
export default function DiscountCodes() {
  const [codes, setCodes] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", kind: "percent", amount: "10", min_order_total: "0", max_uses: "", expires_at: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  const refresh = () => fetchDiscountCodes()
    .then((d) => setCodes(d.codes || []))
    .catch(() => setCodes([]));
  useEffect(() => { refresh(); }, []);

  const create = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await createDiscountCode({
        code: form.code, kind: form.kind, amount: parseFloat(form.amount) || 0,
        min_order_total: parseFloat(form.min_order_total) || 0,
        max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
        expires_at: form.expires_at || null, notes: form.notes || null,
      });
      toast.success(`Code created: ${form.code.toUpperCase()}`);
      setForm({ ...form, code: "", notes: "" });
      setShowForm(false);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create code.");
    } finally { setBusy(false); }
  };

  const toggle = async (c) => { try { await toggleDiscountCode(c.id, !c.active); await refresh(); } catch { toast.error("Could not toggle code."); } };
  const remove = async (c) => {
    const ok = await confirm({
      title: `Delete code "${c.code}"?`,
      body: "This cannot be undone. Buyers who try to apply this code at checkout will see an error.",
      confirmLabel: "Delete code",
      tone: "danger",
      testId: `confirm-delete-code-${c.id}`,
    });
    if (!ok) return;
    try { await deleteDiscountCode(c.id); toast.success(`Deleted ${c.code}`); await refresh(); }
    catch { toast.error("Could not delete code."); }
  };

  return (
    <Section title="Discount Codes" testId="discount-codes">
      {confirmModal}
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="font-mono text-xs text-[#a3a3a3] flex-1">
          Promo codes apply at checkout when buyers paste them in. Per-shop, percentage / fixed dollar / free shipping.
        </p>
        <button onClick={() => setShowForm((s) => !s)} className="btn-industrial inline-flex shrink-0" data-testid="discount-new-btn">
          {showForm ? "Cancel" : "+ New Code"}
        </button>
      </div>
      {showForm && (
        <form onSubmit={create} className="border border-[#262626] p-4 mb-4 grid md:grid-cols-2 gap-3" data-testid="discount-form">
          <input value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} placeholder="CODE (e.g. SUMMER15)" required minLength={3} maxLength={32}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none uppercase" data-testid="discount-code" />
          <select value={form.kind} onChange={(e) => setForm({...form, kind: e.target.value})}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none" data-testid="discount-kind">
            <option value="percent">Percent off</option>
            <option value="fixed">Fixed dollar off</option>
            <option value="free_shipping">Free shipping</option>
          </select>
          <input value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})}
            placeholder={form.kind === "percent" ? "% off (1–100)" : "$ amount"}
            type="number" min="0" step="0.01" required={form.kind !== "free_shipping"} disabled={form.kind === "free_shipping"}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none disabled:opacity-50" data-testid="discount-amount" />
          <input value={form.min_order_total} onChange={(e) => setForm({...form, min_order_total: e.target.value})}
            placeholder="Min order $ (0 = no min)" type="number" min="0" step="0.01"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none" data-testid="discount-min" />
          <input value={form.max_uses} onChange={(e) => setForm({...form, max_uses: e.target.value})}
            placeholder="Max uses (blank = unlimited)" type="number" min="1"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none" data-testid="discount-maxuses" />
          <input value={form.expires_at} onChange={(e) => setForm({...form, expires_at: e.target.value})}
            placeholder="Expires (YYYY-MM-DD)" type="date"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none" data-testid="discount-expires" />
          <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})}
            placeholder="Internal notes (optional)" maxLength={200} rows={2}
            className="md:col-span-2 bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-xs outline-none resize-none" data-testid="discount-notes" />
          <button type="submit" disabled={busy} className="md:col-span-2 btn-industrial btn-primary disabled:opacity-50" data-testid="discount-submit">
            {busy ? "Creating…" : "Create code"}
          </button>
        </form>
      )}
      {codes === null ? (
        <p className="font-mono text-xs text-[#737373] py-4">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="font-mono text-xs text-[#737373] py-4">No codes yet — create your first promo above.</p>
      ) : (
        <div className="space-y-2" data-testid="discount-list">
          {codes.map((c) => (
            <div key={c.id} className={`border p-3 flex items-center justify-between gap-3 ${c.active ? "border-[#262626]" : "border-[#1f1f1f] opacity-50"}`} data-testid={`discount-row-${c.code}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-base text-[#ff4500]">{c.code}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                    {c.kind === "percent" ? `${c.amount}% off` : c.kind === "fixed" ? `$${c.amount} off` : "Free shipping"}
                  </span>
                  {c.min_order_total > 0 && <span className="font-mono text-[10px] text-[#737373]">· min ${c.min_order_total}</span>}
                  {c.max_uses && <span className="font-mono text-[10px] text-[#737373]">· {c.uses_count}/{c.max_uses} used</span>}
                </div>
                {c.notes && <div className="font-mono text-[10px] text-[#737373] mt-0.5 truncate">{c.notes}</div>}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => toggle(c)} className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]" data-testid={`discount-toggle-${c.code}`}>
                  {c.active ? "Disable" : "Enable"}
                </button>
                <button onClick={() => remove(c)} className="px-2 py-1 border border-red-800 hover:border-red-500 hover:text-red-300 font-mono text-[10px] uppercase tracking-[0.22em]" data-testid={`discount-delete-${c.code}`}>
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
