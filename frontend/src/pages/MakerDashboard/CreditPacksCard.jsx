import React, { useEffect, useState } from "react";
import {
  fetchMakerCreditPacks, startMakerCreditCheckout, finalizeMakerCreditPurchase,
} from "../../lib/api";
import { useConfirm } from "./useConfirm";

/**
 * Pre-paid listing-credit packs panel.
 *
 * Lives inside FinancialsTab → Payment settings. Lets makers buy bulk
 * credits at a 30–40% discount vs the cash $0.20/listing rate. Credits
 * are burned before any cash fee accrues to `pending_charges_cents`,
 * so they're effectively a way to lock in a cheaper rate up-front.
 *
 * Self-contained:
 *   - Loads the pack catalogue (`fetchMakerCreditPacks`)
 *   - Confirms intent + redirects to Stripe Checkout (`startMakerCreditCheckout`)
 *   - Reads `?credits=success&session_id=…` on return and finalizes
 *     (`finalizeMakerCreditPurchase`) so credits land instantly without
 *     waiting for the webhook to backfill.
 *
 * Designed to be drop-in: just `<CreditPacksCard />` anywhere with no
 * required props. Returns null while data is loading so it doesn't push
 * other content around with a tall placeholder.
 */
export default function CreditPacksCard() {
  const [confirm, confirmModal] = useConfirm();
  const [credits, setCredits] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: null, text: "" });

  const reload = React.useCallback(() => {
    fetchMakerCreditPacks().then(setCredits).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Stripe-checkout return handling. Trigger keys: `?credits=success`
  // (paid; finalize and refresh) or `?credits=canceled` (no charge).
  // We strip the query params after handling so a refresh doesn't
  // re-trigger the finalize call.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("credits") === "success" && params.get("session_id")) {
      finalizeMakerCreditPurchase(params.get("session_id"))
        .then((r) => {
          setMsg({
            kind: "ok",
            text: r.already_fulfilled
              ? `✓ Already credited · balance ${r.credits}`
              : `✓ +${r.credited} credits added · new balance ${r.credits}`,
          });
          reload();
          // Clean URL so a refresh doesn't re-trigger
          const sp = new URLSearchParams(window.location.search);
          sp.delete("credits");
          sp.delete("session_id");
          const qs = sp.toString();
          window.history.replaceState({}, "", `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash}`);
          setTimeout(() => setMsg({ kind: null, text: "" }), 6000);
        })
        .catch((e) => setMsg({
          kind: "err",
          text: e?.response?.data?.detail || "Could not confirm credit purchase.",
        }));
    } else if (params.get("credits") === "canceled") {
      setMsg({ kind: "info", text: "Credit purchase canceled — no charge made." });
      const sp = new URLSearchParams(window.location.search);
      sp.delete("credits");
      const qs = sp.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash}`);
      setTimeout(() => setMsg({ kind: null, text: "" }), 4000);
    }
  }, [reload]);

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
      setMsg({
        kind: "err",
        text: e?.response?.data?.detail || "Could not start checkout.",
      });
      setBusy(false);
    }
  };

  if (!credits) return null;

  return (
    <>
    <div className="border border-line p-6" data-testid="credit-packs-card">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
            Pre-paid listing credits
          </div>
          <div className="font-display text-3xl">
            {credits.current_credits}
            <span className="text-ink-muted text-xl"> credit{credits.current_credits === 1 ? "" : "s"}</span>
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mt-1">
            Burned before cash fees · never expire
          </p>
        </div>
        {msg.text && (
          <div
            className={`font-mono text-xs px-3 py-2 border ${
              msg.kind === "ok"
                ? "text-emerald-700 border-emerald-400/40"
                : msg.kind === "err"
                  ? "text-red-400 border-red-400/40"
                  : "text-ink-muted border-line"
            }`}
            data-testid="credit-packs-msg"
          >
            {msg.text}
          </div>
        )}
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {credits.packs.map((p) => (
          <button
            key={p.id}
            onClick={() => onBuyCredits(p.id, p.label)}
            disabled={busy}
            className="text-left border border-line hover:border-brand p-4 transition disabled:opacity-50 disabled:cursor-not-allowed group"
            data-testid={`credit-packs-pack-${p.id}`}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              {p.id} pack
            </div>
            <div className="font-display text-3xl mt-2 group-hover:text-brand transition">
              {p.credits}
            </div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mb-3">
              listings
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <div className="font-display text-2xl text-brand">
                ${p.price_usd.toFixed(2)}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-emerald-700">
                ¢{p.per_credit_cents.toFixed(0)}/credit · save{" "}
                {Math.round(((20 - p.per_credit_cents) / 20) * 100)}%
              </div>
            </div>
          </button>
        ))}
      </div>
      <p className="font-mono text-[10px] text-ink-muted mt-4 leading-relaxed">
        Credits stack on top of your free quota. They're consumed before any
        cash fee accrues to your next payout — so a bulk pack at 30–40% off
        cash rates is the cheapest way to grow your shop past the free 10.
      </p>
    </div>
    {confirmModal}
    </>
  );
}
