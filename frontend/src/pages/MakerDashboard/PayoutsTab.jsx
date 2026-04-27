import React, { useEffect, useState } from "react";
import {
  fetchMakerPayouts,
  stripeConnectOnboard, stripeConnectStatus, stripeConnectDashboardLink,
} from "../../lib/api";
import { StatsSkeleton, RowsSkeleton } from "../../components/Skeleton";

export default function PayoutsTab() {
  const [status, setStatus] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const loadAll = async () => {
    try {
      const [s, p] = await Promise.all([stripeConnectStatus(), fetchMakerPayouts()]);
      setStatus(s);
      setPayouts(p);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load payouts info.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const onConnect = async () => {
    setBusy("connect"); setErr("");
    try {
      const r = await stripeConnectOnboard(window.location.origin);
      window.location.href = r.url;
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not start onboarding.");
      setBusy("");
    }
  };

  const onDashboard = async () => {
    setBusy("dashboard"); setErr("");
    try {
      const r = await stripeConnectDashboardLink();
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not open Stripe dashboard.");
    } finally { setBusy(""); }
  };

  if (loading) {
    return (
      <div className="space-y-6" data-testid="payouts-loading">
        <StatsSkeleton count={3} />
        <RowsSkeleton count={4} />
      </div>
    );
  }

  const ready = status?.connected && status?.charges_enabled && status?.payouts_enabled;
  const incomplete = status?.connected && !ready;

  return (
    <div className="space-y-8" data-testid="payouts-tab">
      {/* Connect status card */}
      <div className="border border-[#262626] p-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
          ◆ Stripe Connect
        </div>
        {!status?.connected && (
          <>
            <h3 className="font-display text-2xl mb-2 uppercase">Get paid directly.</h3>
            <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mb-5 max-w-xl">
              Connect a Stripe account so each sale routes straight to your bank.
              Crafters Market keeps a 10% platform fee; you keep the rest.
              Onboarding takes about 5 minutes — Stripe handles ID verification and bank setup.
            </p>
            <button
              onClick={onConnect}
              disabled={busy === "connect"}
              className="btn-industrial btn-primary inline-flex disabled:opacity-50"
              data-testid="payouts-connect-btn"
            >
              {busy === "connect" ? "Redirecting…" : "Connect Stripe →"}
            </button>
          </>
        )}
        {ready && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-400">
                Connected · payouts active
              </span>
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] mb-5">
              Stripe account: <span className="text-[#e5e5e5]">{status.stripe_account_id}</span>
            </p>
            <button
              onClick={onDashboard}
              disabled={busy === "dashboard"}
              className="btn-industrial inline-flex border border-[#262626] hover:border-[#ff4500] disabled:opacity-50"
              data-testid="payouts-dashboard-btn"
            >
              {busy === "dashboard" ? "Opening…" : "Open Stripe dashboard ↗"}
            </button>
          </>
        )}
        {incomplete && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-yellow-400">
                Onboarding incomplete
              </span>
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] mb-5 max-w-xl">
              Stripe needs a few more details before payouts can be enabled.
              Charges enabled: {String(status.charges_enabled)} · Payouts enabled:{" "}
              {String(status.payouts_enabled)} · Details submitted:{" "}
              {String(status.details_submitted)}.
            </p>
            <button
              onClick={onConnect}
              disabled={busy === "connect"}
              className="btn-industrial btn-primary inline-flex disabled:opacity-50"
              data-testid="payouts-resume-btn"
            >
              {busy === "connect" ? "Redirecting…" : "Continue onboarding →"}
            </button>
          </>
        )}
        {err && <p className="mt-4 font-mono text-[11px] text-red-400">{err}</p>}
      </div>

      {/* Payout history */}
      <div className="border border-[#262626] p-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-4">
          ◆ Payout history
        </div>
        {payouts.length === 0 ? (
          <p className="font-mono text-xs text-[#525252]">
            No payouts yet. Each paid order will transfer your share automatically once your
            account is fully onboarded.
          </p>
        ) : (
          <ul className="divide-y divide-[#262626]" data-testid="payouts-history">
            {payouts.map((p) => (
              <li
                key={`${p.session_id}-${p.maker_slug}`}
                className="py-3 flex items-center justify-between gap-4"
                data-testid="payout-row"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs text-[#e5e5e5] truncate">
                    {p.session_id}
                  </div>
                  <div className="font-mono text-[10px] text-[#a3a3a3] mt-1 uppercase tracking-[0.18em]">
                    {p.status}
                    {p.reason ? ` · ${p.reason}` : ""}
                    {p.transfer_id ? ` · ${p.transfer_id}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl text-[#e5e5e5]">
                    ${(Number(p.amount_cents || 0) / 100).toFixed(2)}
                  </div>
                  <div className="font-mono text-[10px] text-[#525252]">
                    of ${Number(p.amount || 0).toFixed(2)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
