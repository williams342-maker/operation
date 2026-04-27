import React, { useEffect, useState } from "react";
import {
  fetchMakerPayouts, fetchMakerTransactions,
  stripeConnectOnboard, stripeConnectStatus, stripeConnectDashboardLink,
} from "../../lib/api";
import { StatsSkeleton, RowsSkeleton } from "../../components/Skeleton";

/** Financials — Payouts (Stripe Connect status + onboard) +
 *  Transactions (chronological credit/debit ledger) merged into one tab. */
export default function FinancialsTab() {
  const [payouts, setPayouts] = useState(null);
  const [status, setStatus] = useState(null);
  const [txns, setTxns] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const refresh = () => Promise.all([
    fetchMakerPayouts().catch(() => ({ payouts: [], pending: 0 })),
    stripeConnectStatus().catch(() => ({ connected: false })),
    fetchMakerTransactions().catch(() => ({ transactions: [] })),
  ]).then(([p, s, t]) => {
    setPayouts(p); setStatus(s); setTxns(t.transactions || []);
  });

  useEffect(() => { refresh(); }, []);

  const onConnect = async () => {
    setBusy("connect"); setErr("");
    try { const r = await stripeConnectOnboard(); window.location.href = r.url; }
    catch (e) { setErr(e?.response?.data?.detail || "Could not start onboarding."); setBusy(""); }
  };
  const onDashboard = async () => {
    setBusy("dashboard"); setErr("");
    try { const r = await stripeConnectDashboardLink(); window.location.href = r.url; }
    catch (e) { setErr(e?.response?.data?.detail || "Could not open dashboard."); setBusy(""); }
  };

  if (!payouts || !txns) return <StatsSkeleton />;

  return (
    <div className="space-y-8" data-testid="financials-tab">
      <header className="pb-6 border-b border-[#262626]">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Financials.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
          Payouts, fees, and transaction history. All numbers in USD.
        </p>
      </header>

      {/* PAYOUTS / STRIPE CONNECT */}
      <section className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 md:p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
          ◆ Payouts via Stripe Connect
        </div>
        {!status?.connected ? (
          <>
            <h3 className="font-display text-2xl mb-2 uppercase">Get paid directly.</h3>
            <p className="font-mono text-xs text-[#a3a3a3] mb-4 max-w-xl leading-relaxed">
              Connect a Stripe account so each sale routes straight to your bank.
              Onboarding takes about 5 minutes.
            </p>
            <button
              onClick={onConnect} disabled={busy === "connect"}
              className="btn-industrial btn-primary inline-flex disabled:opacity-50"
              data-testid="financials-connect-btn"
            >
              {busy === "connect" ? "Redirecting…" : "Connect Stripe →"}
            </button>
          </>
        ) : (
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <div className="font-display text-3xl text-[#ff4500] mb-1">
                ${(payouts?.pending || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Pending payout
              </div>
            </div>
            <button
              onClick={onDashboard} disabled={busy === "dashboard"}
              className="btn-industrial inline-flex justify-center disabled:opacity-50"
              data-testid="financials-dashboard-btn"
            >
              {busy === "dashboard" ? "Redirecting…" : "Open Stripe Dashboard →"}
            </button>
          </div>
        )}
        {err && <p className="font-mono text-xs text-red-400 mt-3" data-testid="financials-err">{err}</p>}
      </section>

      {/* TRANSACTION HISTORY */}
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
          ◆ Transaction history
        </div>
        {!txns.length ? (
          <p className="font-mono text-xs text-[#737373] py-6">
            No transactions yet — they'll appear here after your first sale.
          </p>
        ) : (
          <div className="border border-[#1f1f1f] bg-[#0d0d0d]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 border-b border-[#1f1f1f] font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              <div>Description</div><div className="text-right">Amount</div><div className="text-right">Date</div>
            </div>
            {txns.map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 border-b border-[#161616] font-mono text-xs items-center"
                data-testid={`txn-row-${i}`}
              >
                <div className="min-w-0">
                  <div className="text-[#e5e5e5] uppercase tracking-[0.18em] text-[10px]">
                    {t.kind}{t.items_count ? ` · ${t.items_count} items` : ""}
                  </div>
                  <div className="text-[#737373] text-[10px] truncate">{t.reference}</div>
                </div>
                <div className={`text-right font-display text-base ${t.direction === "credit" ? "text-emerald-400" : "text-[#ff4500]"}`}>
                  {t.direction === "credit" ? "+" : "−"}${t.amount.toFixed(2)}
                </div>
                <div className="text-right text-[10px] text-[#737373]">
                  {(t.created_at || "").slice(0, 10)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
