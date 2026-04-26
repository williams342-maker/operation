import React, { useCallback, useEffect, useState } from "react";
import {
  fetchMakerBilling, fetchMakerSubscription, fetchMakerPlusRoi,
  fetchMakerCreditPacks, startMakerCreditCheckout, finalizeMakerCreditPurchase,
  startMakerSubscription, cancelMakerSubscription, openMakerSubscriptionPortal,
} from "../../lib/api";
import { useConfirm } from "./useConfirm";

export default function BillingTab() {
  const [confirm, confirmModal] = useConfirm();
  const [b, setB] = useState(null);
  const [s, setS] = useState(null);
  const [roi, setRoi] = useState(null);
  const [credits, setCredits] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [creditMsg, setCreditMsg] = useState("");

  const reload = useCallback(() => {
    fetchMakerBilling().then(setB).catch((e) =>
      setErr(e?.response?.data?.detail || "Could not load billing."),
    );
    fetchMakerSubscription().then(setS).catch(() => {});
    fetchMakerPlusRoi().then(setRoi).catch(() => {});
    fetchMakerCreditPacks().then(setCredits).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // After Stripe checkout success, finalize the purchase + refresh balance.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("credits") === "success" && params.get("session_id")) {
      finalizeMakerCreditPurchase(params.get("session_id"))
        .then((r) => {
          if (r.already_fulfilled) {
            setCreditMsg(`✓ Already credited · balance ${r.credits}`);
          } else {
            setCreditMsg(`✓ +${r.credited} credits added · new balance ${r.credits}`);
          }
          reload();
          // Clean URL so a refresh doesn't re-trigger
          window.history.replaceState({}, "", window.location.pathname + "?tab=billing");
          setTimeout(() => setCreditMsg(""), 6000);
        })
        .catch((e) => setErr(e?.response?.data?.detail || "Could not confirm credit purchase."));
    } else if (params.get("credits") === "canceled") {
      setCreditMsg("Credit purchase canceled — no charge made.");
      window.history.replaceState({}, "", window.location.pathname + "?tab=billing");
      setTimeout(() => setCreditMsg(""), 4000);
    }
  }, [reload]);

  if (err) return <p className="font-mono text-sm text-red-400" data-testid="billing-error">{err}</p>;
  if (!b) return <p className="font-mono text-sm text-[#a3a3a3]" data-testid="billing-loading">Loading billing…</p>;

  const dollars = (c) => `$${(c / 100).toFixed(2)}`;
  const pct = (bps) => `${(bps / 100).toFixed(1)}%`;
  const isPlus = s?.status === "active";

  const onUpgrade = async () => {
    setBusy(true);
    try {
      const { checkout_url } = await startMakerSubscription();
      window.location.href = checkout_url;
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not start subscription.");
      setBusy(false);
    }
  };

  const onCancel = async () => {
    const ok = await confirm({
      title: "Cancel Crafters Plus?",
      body: "Your Plus benefits stay active until the end of the current billing period. After that, your shop falls back to free tier (10 lifetime free listings, 5% commission, no banner).",
      confirmLabel: "Cancel subscription",
      cancelLabel: "Keep Plus",
      tone: "warn",
      testId: "confirm-cancel-plus",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await cancelMakerSubscription();
      reload();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not cancel.");
    } finally {
      setBusy(false);
    }
  };

  const onOpenPortal = async () => {
    setBusy(true);
    try {
      const { url } = await openMakerSubscriptionPortal();
      window.location.href = url;
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not open billing portal.");
      setBusy(false);
    }
  };

  const onBuyCredits = async (pack, label) => {
    const ok = await confirm({
      title: `Buy ${label}?`,
      body: "You'll be redirected to Stripe to complete the purchase. Credits land instantly on your account when payment confirms — they never expire.",
      confirmLabel: "Continue to Stripe →",
      cancelLabel: "Not now",
      tone: "primary",
      testId: `confirm-credits-${pack}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { checkout_url } = await startMakerCreditCheckout(pack);
      window.location.href = checkout_url;
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not start checkout.");
      setBusy(false);
    }
  };

  return (
    <>
    <div className="space-y-10" data-testid="billing-tab">
      {/* Top KPIs */}
      <div className="grid md:grid-cols-3 gap-3 md:gap-6">
        <div className="border border-[#262626] p-5" data-testid="billing-listing-usage">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Listings used (lifetime)</div>
          <div className="font-display text-4xl mt-2">
            {b.listings_used_lifetime}
            {b.listings_free_remaining > 0 && (
              <span className="text-[#525252] text-2xl"> / {b.listings_free_quota} free</span>
            )}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mt-2">
            {b.listings_free_remaining > 0
              ? `${b.listings_free_remaining} free remaining`
              : `Past free quota — every new listing or renewal is ${dollars(b.policy.listing_fee_cents)}`}
          </div>
        </div>

        <div className="border border-[#262626] p-5" data-testid="billing-pending">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Pending charges</div>
          <div className="font-display text-4xl mt-2 text-[#ff4500]">{dollars(b.pending_charges_cents)}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mt-2">
            Auto-deducted from your next payout
          </div>
        </div>

        <div className="border border-[#262626] p-5" data-testid="billing-fee-policy">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Per-sale fee</div>
          <div className="font-display text-4xl mt-2">
            {pct((isPlus ? (s?.plan?.commission_bps ?? 400) : b.policy.platform_fee_bps) + b.policy.processing_fee_bps)}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mt-2">
            {pct(isPlus ? (s?.plan?.commission_bps ?? 400) : b.policy.platform_fee_bps)} commission
            {isPlus && <span className="text-emerald-400 ml-1">(Plus rate)</span>}
            {" · "}{pct(b.policy.processing_fee_bps)} processing
          </div>
        </div>
      </div>

      {/* Plus subscription upsell / management card */}
      <div
        className={`border p-6 ${
          isPlus
            ? "border-emerald-400/40 bg-emerald-400/5"
            : "border-[#ff4500]/40 bg-[#ff4500]/5"
        }`}
        data-testid="billing-plus-card"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
              {isPlus ? "Your subscription" : "Upgrade to"}
            </div>
            <div className="font-display text-3xl">Crafters Plus</div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1">
              ${s?.plan?.price_usd ?? 12}/month · {s?.plan?.monthly_listing_quota ?? 15} free listings/mo · {(s?.plan?.commission_bps ?? 400) / 100}% commission
            </div>
          </div>
          {isPlus ? (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onOpenPortal}
                disabled={busy}
                className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-400 hover:text-emerald-300 border border-emerald-400/40 px-4 py-2 disabled:opacity-50"
                data-testid="billing-plus-portal"
              >
                Manage billing ↗
              </button>
              <button
                onClick={onCancel}
                disabled={busy}
                className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-red-400 border border-[#262626] px-4 py-2 disabled:opacity-50"
                data-testid="billing-plus-cancel"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onUpgrade}
              disabled={busy}
              className="btn-industrial btn-primary disabled:opacity-50"
              data-testid="billing-plus-upgrade"
            >
              {busy ? "Loading…" : "Upgrade →"}
            </button>
          )}
        </div>
        <ul className="grid md:grid-cols-2 gap-2 mt-5 font-mono text-xs text-[#e5e5e5]">
          {(s?.plan?.perks || [
            "15 free listings/month",
            "4% commission (vs 5%)",
            "Advanced shop analytics",
            "Custom shop banner image",
          ]).map((p, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[#ff4500] mt-0.5">◆</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
        {isPlus && s?.renews_at && (
          <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400" data-testid="billing-plus-renews">
            ✓ Active · renews {new Date(s.renews_at).toLocaleDateString()}
          </div>
        )}

        {/* Live ROI calculator — pulls last-30d gross from the maker's
            payouts and projects what they'd save (or already saved) under
            the Plus tier. Hidden until /maker/plus/roi resolves. */}
        {roi && roi.gross_30d > 0 && (
          <div
            className="mt-5 pt-5 border-t border-[#262626]/60"
            data-testid="billing-plus-roi"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mb-2">
              {isPlus ? "Your savings · last 30 days" : "Your potential savings · last 30 days"}
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">Sold (30d)</div>
                <div className="font-display text-2xl mt-1">${roi.gross_30d.toFixed(0)}</div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">
                  {isPlus ? "Saved on commission" : "You'd save (commission)"}
                </div>
                <div className="font-display text-2xl mt-1 text-emerald-400" data-testid="billing-plus-roi-savings">
                  ${roi.commission_savings.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">
                  Net of $12/mo
                </div>
                <div
                  className={`font-display text-2xl mt-1 ${roi.is_break_even ? "text-emerald-400" : "text-[#ff4500]"}`}
                  data-testid="billing-plus-roi-net"
                >
                  {roi.net_benefit >= 0 ? "+" : "−"}${Math.abs(roi.net_benefit).toFixed(2)}
                </div>
              </div>
            </div>
            {!isPlus && roi.is_break_even && (
              <p className="mt-3 font-mono text-xs text-emerald-400" data-testid="billing-plus-roi-pitch">
                ◆ At your current sales rate, Plus pays for itself <b>and</b> nets you an extra
                ${roi.net_benefit.toFixed(2)}/month. The upgrade is free money.
              </p>
            )}
            {!isPlus && !roi.is_break_even && roi.commission_savings > 0 && (
              <p className="mt-3 font-mono text-xs text-[#a3a3a3]" data-testid="billing-plus-roi-pitch">
                You'd save ${roi.commission_savings.toFixed(2)} on commission — Plus would cost
                ${Math.abs(roi.net_benefit).toFixed(2)} net at your current pace. Plus pays for itself
                once monthly sales pass <b>${(12 / 0.01).toFixed(0)}</b>.
              </p>
            )}
            {isPlus && roi.commission_savings > 0 && (
              <p className="mt-3 font-mono text-xs text-emerald-400" data-testid="billing-plus-roi-pitch">
                ◆ Plus has saved you ${roi.commission_savings.toFixed(2)} on commission this month — net
                of the $12/mo subscription, that's a {roi.net_benefit >= 0 ? "+" : ""}
                ${roi.net_benefit.toFixed(2)} bottom-line lift.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Listing-credit packs — pre-paid bulk discount alternative to per-payout
          $0.20 cash settlements. Only meaningful for makers past the free quota. */}
      {credits && (
        <div className="border border-[#262626] p-6" data-testid="billing-credits-card">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
                Pre-paid listing credits
              </div>
              <div className="font-display text-3xl">
                {credits.current_credits}
                <span className="text-[#525252] text-xl"> credit{credits.current_credits === 1 ? "" : "s"}</span>
              </div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#525252] mt-1">
                Burned before cash fees · never expire
              </p>
            </div>
            {creditMsg && (
              <div
                className="font-mono text-xs text-emerald-400 px-3 py-2 border border-emerald-400/40"
                data-testid="billing-credits-msg"
              >
                {creditMsg}
              </div>
            )}
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {credits.packs.map((p) => (
              <button
                key={p.id}
                onClick={() => onBuyCredits(p.id, p.label)}
                disabled={busy}
                className="text-left border border-[#262626] hover:border-[#ff4500] p-4 transition disabled:opacity-50 disabled:cursor-not-allowed group"
                data-testid={`billing-credits-pack-${p.id}`}
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                  {p.id} pack
                </div>
                <div className="font-display text-3xl mt-2 group-hover:text-[#ff4500] transition">
                  {p.credits}
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#525252] mb-3">
                  listings
                </div>
                <div className="flex items-baseline justify-between border-t border-[#262626] pt-3">
                  <div className="font-display text-2xl text-[#ff4500]">
                    ${p.price_usd.toFixed(2)}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-emerald-400">
                    ¢{p.per_credit_cents.toFixed(0)}/credit · save{" "}
                    {Math.round(((20 - p.per_credit_cents) / 20) * 100)}%
                  </div>
                </div>
              </button>
            ))}
          </div>
          <p className="font-mono text-[10px] text-[#525252] mt-4 leading-relaxed">
            Credits stack on top of your free quota. They're consumed before any
            cash fee accrues to your next payout — so a bulk pack at 30–40% off
            cash rates is the cheapest way to grow your shop past the free 10.
          </p>
        </div>
      )}

      {/* Policy details */}
      <div className="border border-[#262626] p-5" data-testid="billing-policy-details">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">Pricing breakdown</div>
        <ul className="space-y-2 font-mono text-xs text-[#e5e5e5]">
          <li>• <b>{pct(b.policy.platform_fee_bps)} commission</b> on every paid order — Crafters Market keeps this.</li>
          <li>• <b>{pct(b.policy.processing_fee_bps)} payment processing</b> covers card / Stripe fees.</li>
          <li>• <b>{b.policy.listings_free_quota || b.listings_free_quota} free listings</b> — beyond that, {dollars(b.policy.listing_fee_cents)} per publish or renewal.</li>
          <li>• <b>{b.policy.listing_expiry_days}-day expiry</b> on each listing — auto-flips to draft, renew with one click.</li>
          <li>• <b>{dollars(b.policy.promotion_weekly_fee_cents)}/week</b> to promote a listing to the top of search.</li>
        </ul>
      </div>

      {/* Recent ledger */}
      <div data-testid="billing-history">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">Recent activity</div>
        {b.history.length === 0 ? (
          <p className="font-mono text-sm text-[#525252]" data-testid="billing-history-empty">No charges yet — keep building.</p>
        ) : (
          <table className="w-full font-mono text-xs">
            <thead>
              <tr className="text-[#a3a3a3] uppercase tracking-[0.22em] text-[10px]">
                <th className="text-left py-2 border-b border-[#262626]">When</th>
                <th className="text-left py-2 border-b border-[#262626]">Kind</th>
                <th className="text-left py-2 border-b border-[#262626]">Listing</th>
                <th className="text-right py-2 border-b border-[#262626]">Amount</th>
              </tr>
            </thead>
            <tbody>
              {b.history.map((h, i) => (
                <tr key={i} className="border-b border-[#1a1a1a]">
                  <td className="py-2 text-[#525252]">{h.ts ? new Date(h.ts).toLocaleString() : "—"}</td>
                  <td className="py-2 text-[#e5e5e5]">{h.kind}</td>
                  <td className="py-2 text-[#a3a3a3]">{h.slug || "—"}</td>
                  <td className={`py-2 text-right ${h.amount_cents < 0 ? "text-emerald-400" : "text-[#ff4500]"}`}>
                    {h.amount_cents < 0 ? "−" : ""}{dollars(Math.abs(h.amount_cents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
    {confirmModal}
    </>
  );
}
