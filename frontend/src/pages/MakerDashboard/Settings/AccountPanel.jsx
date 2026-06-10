import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  makerCloseShop, makerReopenShop,
  makerRequestDeletion, makerCancelDeletion, cancelMakerSubscription,
  fetchMakerMe, updateMakerProfile,
} from "../../../lib/api";
import { useConfirm } from "../useConfirm";
import CustomUrlPicker from "./CustomUrlPicker";

/**
 * "Account & Plan" settings panel — downgrade Plus, close/reopen the
 * shop, request 30-day account deletion. Destructive actions all use
 * the shared confirm dialog and the deletion-request flow uses a
 * type-DELETE prompt as a second guardrail.
 *
 * Extracted from SettingsTab.jsx in iter131 — was the largest panel
 * at ~250 lines (every action has its own state + confirm + refresh
 * dance).
 */
export default function AccountPanel({ maker, onSaved }) {
  const isPlus = ["active", "trialing"].includes(maker?.subscription_status);
  const closed = !!maker?.shop_closed;
  const deletionAt = maker?.deletion_requested_at;
  const purgeAt = maker?.deletion_cancels_at;
  const daysRemaining = purgeAt
    ? Math.max(0, Math.ceil((new Date(purgeAt).getTime() - Date.now()) / (24 * 3600 * 1000)))
    : null;

  const [busy, setBusy] = useState("");
  const [confirm, confirmModal] = useConfirm();

  // Account actions return `{ok: true}` only — they don't include the
  // full maker doc. Re-fetch /maker/me after each mutation and hand
  // the result to `onSaved` so the parent's `setMaker(m)` gets a real
  // maker (not undefined) and the current Settings sub-section stays
  // mounted without flashing an empty state.
  const refreshMaker = async () => {
    try {
      const m = await fetchMakerMe();
      onSaved?.(m);
    } catch { /* silently ignore — toast already surfaced the primary success */ }
  };

  const downgrade = async () => {
    const ok = await confirm({
      title: "Cancel Crafters Plus?",
      body: "You'll keep Plus benefits until the end of the current billing period, then drop to Free (10 listings/mo quota, 5% fee).",
      confirmLabel: "Cancel Plus",
      tone: "warn",
      testId: "confirm-downgrade-plus",
    });
    if (!ok) return;
    setBusy("downgrade");
    try {
      await cancelMakerSubscription();
      toast.success("Plus will cancel at the end of the current period.");
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cancel failed.");
    } finally { setBusy(""); }
  };

  const closeShop = async () => {
    const ok = await confirm({
      title: "Close your shop platform-wide?",
      body: "Buyers will see a 'This shop is closed' banner. No new orders. Existing listings stay. You can reopen anytime.",
      confirmLabel: "Close shop",
      tone: "warn",
      testId: "confirm-close-shop",
    });
    if (!ok) return;
    setBusy("close");
    try {
      await makerCloseShop();
      toast.success("Shop closed. Reopen whenever you're ready.");
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Close failed.");
    } finally { setBusy(""); }
  };

  const reopen = async () => {
    setBusy("reopen");
    try {
      await makerReopenShop();
      toast.success("Shop reopened. Welcome back.");
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reopen failed.");
    } finally { setBusy(""); }
  };

  const requestDelete = async () => {
    const ok = window.prompt(
      "DELETE YOUR ACCOUNT?\n\n" +
      "This starts a 30-day grace period. On day 30 we permanently remove:\n" +
      "• Your shop profile\n" +
      "• All listings\n" +
      "• Messages, reviews, design files\n\n" +
      "Financial records (orders, payouts, tax) are preserved for accounting.\n\n" +
      "To continue, type DELETE below:",
    );
    if (ok !== "DELETE") {
      if (ok !== null) toast.error("Cancelled — you didn't type DELETE.");
      return;
    }
    setBusy("delete");
    try {
      const r = await makerRequestDeletion();
      toast.success(`Deletion scheduled in ${r.days_remaining} days. Cancel anytime.`);
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete request failed.");
    } finally { setBusy(""); }
  };

  const cancelDelete = async () => {
    setBusy("cancel-delete");
    try {
      await makerCancelDeletion();
      toast.success("Deletion cancelled — your account is safe.");
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cancel failed.");
    } finally { setBusy(""); }
  };

  return (
    <div className="space-y-6" data-testid="settings-account">
      {confirmModal}
      <div>
        <h2 className="font-display text-2xl text-ink">Account & Plan</h2>
        <p className="font-mono text-sm text-ink-muted mt-2 max-w-2xl">
          Downgrade your subscription, close your shop, or request account deletion.
        </p>
      </div>

      {/* Pending-deletion banner — red, impossible to miss */}
      {deletionAt && (
        <div className="border-2 border-red-600 bg-red-950/30 p-4" data-testid="account-deletion-banner">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 mb-1">◆ Pending deletion</div>
          <div className="font-display text-xl text-red-300">
            Your account is scheduled for deletion in {daysRemaining} {daysRemaining === 1 ? "day" : "days"}.
          </div>
          <p className="font-mono text-xs text-red-300/80 mt-2">
            On {new Date(purgeAt).toLocaleDateString()}, your shop and every listing will be permanently removed.
            Change your mind?
          </p>
          <button
            onClick={cancelDelete}
            disabled={busy === "cancel-delete"}
            className="mt-3 px-4 py-2 bg-white hover:bg-ink-muted text-red-700 border border-white font-mono text-[10px] uppercase tracking-[0.22em] font-bold disabled:opacity-50"
            data-testid="account-cancel-deletion-btn"
          >
            {busy === "cancel-delete" ? "…" : "← Cancel deletion — keep my account"}
          </button>
        </div>
      )}

      {/* Plan downgrade */}
      <section className="border border-line p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Current plan</div>
            <div className="font-display text-2xl mt-1">
              {isPlus ? (
                <span className="text-emerald-400">★ Crafters Plus · $12/mo</span>
              ) : (
                <span className="text-ink-muted">◇ Free</span>
              )}
            </div>
          </div>
          {isPlus ? (
            <button
              onClick={downgrade}
              disabled={!!busy}
              className="px-4 py-2 border border-line hover:border-amber-500 hover:text-amber-400 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid="account-downgrade-btn"
            >
              {busy === "downgrade" ? "…" : "Downgrade to Free"}
            </button>
          ) : (
            <Link
              to="/maker/billing"
              className="inline-flex items-center justify-center px-4 py-2 bg-brand hover:bg-[#ff5722] text-ink border border-brand font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
              data-testid="account-upgrade-btn"
            >
              ★ Upgrade my account →
            </Link>
          )}
        </div>
      </section>

      {/* Plus-only custom shop URL picker. Self-renders an upsell card
          for non-Plus makers. */}
      <CustomUrlPicker />

      {/* Close / reopen shop */}
      <section className="border border-line p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Shop status</div>
            <div className="font-display text-2xl mt-1">
              {closed ? (
                <span className="text-amber-400">◆ Closed · No new orders</span>
              ) : (
                <span className="text-emerald-400">◆ Open</span>
              )}
            </div>
            <p className="font-mono text-xs text-ink-muted mt-2 max-w-md">
              Closing hides your shop from search and blocks new orders without deleting data. Reopen anytime.
            </p>
          </div>
          {closed ? (
            <button
              onClick={reopen}
              disabled={!!busy}
              className="px-4 py-2 border border-emerald-600 text-emerald-400 hover:bg-emerald-600 hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
              data-testid="account-reopen-btn"
            >
              {busy === "reopen" ? "…" : "Reopen shop"}
            </button>
          ) : (
            <button
              onClick={closeShop}
              disabled={!!busy || !!deletionAt}
              className="px-4 py-2 border border-amber-600 text-amber-400 hover:bg-amber-600 hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
              data-testid="account-close-btn"
            >
              {busy === "close" ? "…" : "Close shop"}
            </button>
          )}
        </div>
      </section>

      {/* Smart Pause — auto-hide listings with zero pageviews after N days */}
      <section className="border border-line p-5" data-testid="account-smart-pause">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Smart Pause</div>
            <div className="font-display text-2xl mt-1">
              {maker?.smart_pause_enabled ? (
                <span className="text-emerald-400">◆ ON · auto-pauses stale listings</span>
              ) : (
                <span className="text-ink-muted">◇ OFF</span>
              )}
            </div>
            <p className="font-mono text-xs text-ink-muted mt-2 max-w-xl leading-relaxed">
              When ON, listings with <b className="text-ink">zero pageviews</b> in the last {maker?.smart_pause_threshold_days || 30} days are quietly moved to draft. You'll get an email with the list + tips to optimise before republishing. Healthy listings are never touched.
            </p>
          </div>
          <button
            onClick={async () => {
              setBusy("smart-pause");
              try {
                const next = !maker?.smart_pause_enabled;
                const updated = await updateMakerProfile({ smart_pause_enabled: next });
                onSaved?.(updated);
                toast.success(next ? "Smart Pause is now ON." : "Smart Pause is now OFF.");
              } catch (e) {
                toast.error(e?.response?.data?.detail || "Couldn't update Smart Pause.");
              } finally {
                setBusy("");
              }
            }}
            disabled={!!busy}
            className={`px-4 py-2 border font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50 ${
              maker?.smart_pause_enabled
                ? "border-amber-600 text-amber-400 hover:bg-amber-600 hover:text-ink"
                : "border-emerald-600 text-emerald-400 hover:bg-emerald-600 hover:text-ink"
            }`}
            data-testid="account-smart-pause-toggle"
          >
            {busy === "smart-pause" ? "…" : maker?.smart_pause_enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </section>

      {/* Danger zone */}
      <section className="border-2 border-red-900/60 bg-red-950/10 p-5" data-testid="account-danger-zone">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-red-500" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-500 font-bold">Danger zone</span>
        </div>
        <div className="font-display text-xl text-ink mb-2">Delete my account</div>
        <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
          Starts a <b className="text-red-400">30-day grace period</b>. After 30 days your shop
          and every listing, message, review, and design file is permanently
          removed. Orders and payouts are preserved (required for accounting &
          tax compliance) but your maker identifier is anonymized. Cancellable
          anytime during the 30-day window.
        </p>
        <button
          onClick={requestDelete}
          disabled={!!busy || !!deletionAt}
          className="mt-4 px-4 py-2 border border-red-600 text-red-400 hover:bg-red-600 hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
          data-testid="account-delete-btn"
        >
          {busy === "delete" ? "…" : deletionAt ? "Deletion pending →" : "Request account deletion"}
        </button>
      </section>
    </div>
  );
}
