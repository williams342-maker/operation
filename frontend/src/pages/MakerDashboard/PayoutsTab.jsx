import React, { useEffect, useState } from "react";
import {
  fetchMakerPayouts,
  stripeConnectOnboard, stripeConnectStatus, stripeConnectDashboardLink,
} from "../../lib/api";
import { StatsSkeleton, RowsSkeleton } from "../../components/Skeleton";
import MakerFeeTable from "../../components/MakerFeeTable";

export default function PayoutsTab() {
  const [status, setStatus] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  // Coerce 422 array-detail errors to a string so we never crash the page.
  const errMsg = (e, fallback) => {
    const d = e?.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
    return fallback;
  };

  const loadAll = async () => {
    try {
      const [s, p] = await Promise.all([stripeConnectStatus(), fetchMakerPayouts()]);
      setStatus(s);
      setPayouts(p);
    } catch (e) {
      setErr(errMsg(e, "Failed to load payouts info."));
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
      setErr(errMsg(e, "Could not start onboarding."));
      setBusy("");
    }
  };

  const onDashboard = async () => {
    setBusy("dashboard"); setErr("");
    try {
      const r = await stripeConnectDashboardLink();
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const isIncomplete =
        e?.response?.status === 409 &&
        ((typeof detail === "object" && detail?.code === "onboarding_incomplete") ||
          (typeof detail === "string" && /onboarding/i.test(detail)));
      if (isIncomplete) {
        try {
          const r = await stripeConnectOnboard(window.location.origin);
          window.location.href = r.url;
          return;
        } catch (e2) {
          setErr(errMsg(e2, "Finish your Stripe onboarding to open the dashboard."));
        }
      } else {
        setErr(errMsg(e, "Could not open Stripe dashboard."));
      }
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
      <div className="border border-line p-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand mb-3">
          ◆ Stripe Connect
        </div>
        {!status?.connected && (
          <>
            <h3 className="font-display text-2xl mb-2 uppercase">Get paid directly.</h3>
            <p className="font-mono text-xs text-ink-muted leading-relaxed mb-5 max-w-xl">
              Connect a Stripe account so each sale routes straight to your bank.
              Fees below are deducted before payout — no upfront card billing.
              Onboarding takes about 5 minutes — Stripe handles ID verification and bank setup.
            </p>
            <div className="mb-6">
              <MakerFeeTable title="Fees deducted before payout" />
            </div>
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
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-700">
                Connected · payouts active
              </span>
            </div>
            <p className="font-mono text-xs text-ink-muted mb-5">
              Stripe account: <span className="text-ink">{status.stripe_account_id}</span>
            </p>
            <button
              onClick={onDashboard}
              disabled={busy === "dashboard"}
              className="btn-industrial inline-flex border border-line hover:border-brand disabled:opacity-50"
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
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-brand">
                Onboarding incomplete
              </span>
            </div>
            <p className="font-mono text-xs text-ink-muted mb-5 max-w-xl">
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
      <div className="border border-line p-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mb-4">
          ◆ Payout history
        </div>
        {payouts.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted">
            No payouts yet. Each paid order will transfer your share automatically once your
            account is fully onboarded.
          </p>
        ) : (
          <ul className="divide-y divide-line" data-testid="payouts-history">
            {payouts.map((p) => (
              <li
                key={`${p.session_id}-${p.maker_slug}`}
                className="py-3 flex items-center justify-between gap-4"
                data-testid="payout-row"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs text-ink truncate">
                    {p.session_id}
                  </div>
                  <div className="font-mono text-[10px] text-ink-muted mt-1 uppercase tracking-[0.18em]">
                    {p.status}
                    {p.reason ? ` · ${p.reason}` : ""}
                    {p.transfer_id ? ` · ${p.transfer_id}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl text-ink">
                    ${(Number(p.amount_cents || 0) / 100).toFixed(2)}
                  </div>
                  <div className="font-mono text-[10px] text-ink-muted">
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
