/**
 * iter453 — Blocking Maker Agreement acceptance modal. Shows when the
 * signed-in maker hasn't accepted the CURRENT agreement version.
 * Acceptance is recorded server-side with version, timestamp, IP and
 * user-agent (append-only audit trail).
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileCheck } from "lucide-react";
import { http, authHeaders } from "../lib/api";

export default function MakerAgreementModal() {
  const [status, setStatus] = useState(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    http.get("/maker/agreement/status", { headers: authHeaders() })
      .then((r) => setStatus(r.data))
      .catch(() => {});
  }, []);

  if (!status?.requires_acceptance) return null;

  async function accept() {
    setBusy(true);
    try {
      await http.post("/maker/agreement/accept",
        { version: status.current_version }, { headers: authHeaders() });
      toast.success("Agreement accepted — thank you.");
      setStatus((s) => ({ ...s, requires_acceptance: false }));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not record acceptance.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
         data-testid="maker-agreement-modal">
      <div className="bg-paper border border-line max-w-lg w-full p-6">
        <div className="flex items-center gap-2 mb-3">
          <FileCheck size={16} className="text-brand" />
          <h2 className="font-display text-2xl text-ink">Maker Agreement</h2>
          <span className="ml-auto border border-brand/40 text-brand px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]">
            v{status.current_version}
          </span>
        </div>
        <p className="font-mono text-xs text-ink-muted leading-relaxed mb-4">
          Before continuing to sell on Crafters Market, please review and accept
          the current Maker/Seller Agreement. Your acceptance is recorded with a
          timestamp for both of our records.
        </p>
        <a href="/policies/terms#maker-agreement" target="_blank" rel="noreferrer"
           className="industrial-link font-mono text-xs uppercase tracking-[0.18em]"
           data-testid="agreement-full-link">
          Read the full agreement →
        </a>
        <label className="flex items-start gap-2.5 mt-5 cursor-pointer">
          <input type="checkbox" checked={checked}
                 onChange={(e) => setChecked(e.target.checked)}
                 className="mt-0.5 accent-[#ff4500]"
                 data-testid="agreement-checkbox" />
          <span className="font-mono text-[11px] text-ink leading-relaxed">
            I have read and agree to the Maker/Seller Agreement
            (v{status.current_version}), including the marketplace fee,
            fulfillment, and content policies.
          </span>
        </label>
        <button onClick={accept} disabled={!checked || busy}
                className="mt-5 w-full px-5 py-2.5 bg-brand hover:bg-brand-hover text-[#0a0a0a] font-mono text-[11px] uppercase tracking-[0.16em] font-bold disabled:opacity-40 transition"
                data-testid="agreement-accept-btn">
          {busy ? "Recording…" : "Accept & continue"}
        </button>
      </div>
    </div>
  );
}
