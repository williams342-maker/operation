import React, { useState } from "react";
import { Landmark, RefreshCw } from "lucide-react";
import { adminTaxVerification } from "../../lib/api";

/** iter462b — Marketplace Facilitator Tax verification (Stripe Tax).
 *  Ops runs this on PRODUCTION where the live Stripe key exists. */
export default function MarketplaceTaxCard() {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await adminTaxVerification();
      setR(res);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Verification call failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-line bg-paper p-5" data-testid="marketplace-tax-card">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-start gap-3">
          <Landmark size={16} className="text-brand mt-1 shrink-0" />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Marketplace facilitator tax</div>
            <h3 className="font-display text-xl uppercase mt-1">Stripe Tax verification.</h3>
            <p className="font-mono text-xs text-ink-muted mt-2 max-w-lg leading-relaxed">
              Confirms Stripe Tax is active, state registrations exist, and recent checkout
              sessions actually carried automatic tax. Run on production — preview pods only
              hold a placeholder key.
            </p>
          </div>
        </div>
        <button onClick={run} disabled={busy}
          className="btn-industrial btn-primary text-xs inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="tax-verify-run-btn">
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          {busy ? "Checking…" : "Run verification"}
        </button>
      </div>

      {err && <div className="font-mono text-xs text-red-400" data-testid="tax-verify-error">⚠ {err}</div>}

      {r && (
        <div className="space-y-3 mt-2" data-testid="tax-verify-result">
          <div className="grid sm:grid-cols-3 gap-3 font-mono text-xs">
            <div className="border border-line p-3">
              <div className="text-ink-muted uppercase tracking-[0.18em] text-[9px] mb-1">Stripe key</div>
              <div className={r.stripe_key_is_placeholder ? "text-red-400" : "text-ink"} data-testid="tax-key-mode">
                {r.stripe_key_mode}{r.stripe_key_is_placeholder ? " · placeholder" : ""}
              </div>
            </div>
            <div className="border border-line p-3">
              <div className="text-ink-muted uppercase tracking-[0.18em] text-[9px] mb-1">Tax settings</div>
              <div className={r.tax_settings?.status === "active" ? "text-emerald-500" : "text-brand"}>
                {r.tax_settings?.status || r.tax_settings?.error?.slice(0, 60) || "unknown"}
              </div>
            </div>
            <div className="border border-line p-3">
              <div className="text-ink-muted uppercase tracking-[0.18em] text-[9px] mb-1">Registrations</div>
              <div className="text-ink">
                {Array.isArray(r.registrations) && !r.registrations[0]?.error
                  ? `${r.registrations.length} on file`
                  : "unavailable"}
              </div>
            </div>
          </div>

          {Array.isArray(r.registrations) && r.registrations.length > 0 && !r.registrations[0]?.error && (
            <div className="flex flex-wrap gap-1.5">
              {r.registrations.map((g, i) => (
                <span key={i} className="tag text-[10px] text-ink-muted border-line">
                  {g.country}{g.state ? ` · ${g.state}` : ""} ({g.status})
                </span>
              ))}
            </div>
          )}

          {Array.isArray(r.recent_sessions_with_tax) && !r.recent_sessions_with_tax[0]?.error && r.recent_sessions_with_tax.length > 0 && (
            <div className="font-mono text-[10px] text-ink-muted">
              Recent sessions with automatic tax:{" "}
              {r.recent_sessions_with_tax.filter((s) => s.automatic_tax_enabled).length}/{r.recent_sessions_with_tax.length}
            </div>
          )}

          <ul className="space-y-1.5" data-testid="tax-verify-recommendations">
            {(r.recommendations || []).map((rec, i) => (
              <li key={i} className="border-l-2 border-brand pl-3 font-mono text-xs text-ink leading-relaxed">
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
