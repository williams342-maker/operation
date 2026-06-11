import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Copy, RefreshCw, Gift, Check } from "lucide-react";
import {
  fetchMakerReferrals, regenerateMakerReferralCode,
} from "../../lib/api";

// Pre-filled invite copy reused across every share channel. Short
// enough for X's 280-char limit, descriptive enough that the maker
// landing on /beta knows what they're getting into.
const INVITE_TEXT = (
  "Sell your CNC / laser / woodwork on Crafters Market — 5% commission, " +
  "no monthly fees, Stripe-direct payouts. I'm on it and the founding-" +
  "seller perks are real. Apply with my link:"
);
const INVITE_TEXT_SHORT = (
  "Founding seller on Crafters Market — vetted CNC / laser / wood " +
  "marketplace. Apply with my link:"
);
const PINTEREST_DESC = (
  "Crafters Market — vetted CNC, laser & woodworking marketplace. " +
  "Founding seller program: 5% commission, no monthly fees, Stripe " +
  "payouts. Apply with this invite link."
);

/**
 * Plus referral program card. Lives on the dashboard's main tab (and
 * inside the Trial banner narrative). Surfaces:
 *   - Maker's unique share link (`/beta?ref=<code>`)
 *   - Progress to the next bonus (e.g. 1 / 3)
 *   - Whether the +30 day trial extension has already been awarded
 *   - "Rotate code" affordance for makers who leaked the link
 *
 * Open to ALL makers — even non-Plus ones. A free maker who refers 3
 * future Plus subscribers earns a credit that activates the moment
 * they start their own Plus trial.
 */
export default function ReferralCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) return;
    fetchMakerReferrals().then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  const pct = Math.min(100, (data.completed_count / data.threshold) * 100);
  const remaining = Math.max(0, data.threshold - data.completed_count);
  const awarded = !!data.bonus_applied_at;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(data.share_link);
      setCopied(true);
      toast.success("Invite link copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {/* clipboard blocked — fall back silently */}
  };

  const rotate = async () => {
    if (!confirm(
      "Generate a brand-new invite code? Any links you've already shared with the old code will stop counting new signups."
    )) return;
    setBusy(true);
    try {
      const r = await regenerateMakerReferralCode();
      setData(r);
      toast.success("New invite code generated.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't rotate the code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="border border-brand/30 bg-gradient-to-br from-brand/5 via-surface to-surface p-5 md:p-6"
      data-testid="referral-card"
    >
      <div className="flex items-start gap-3 mb-4">
        <Gift size={18} className="text-brand mt-1 shrink-0" />
        <div className="flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
            ◆ Refer a maker · earn {data.bonus_days} free trial days
          </div>
          <h3 className="font-display text-xl md:text-2xl uppercase mt-1">
            Invite {data.threshold} makers, get {data.bonus_days} days free.
          </h3>
          <p className="font-mono text-xs text-ink-muted mt-2 leading-relaxed max-w-lg">
            When {data.threshold} makers sign up via your link and reach
            Crafters Plus, we add {data.bonus_days} days to your current
            trial.{" "}
            {!awarded
              ? "Already in trial? The extension applies instantly via Stripe."
              : "Bonus already applied — thanks for spreading the word."}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2 mb-5" data-testid="referral-progress">
        <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.22em]">
          <span className="text-ink-muted">Progress</span>
          <span className="text-ink">
            <span className={awarded ? "text-emerald-400" : "text-brand"}>
              {data.completed_count}
            </span>
            <span className="text-ink-muted"> / {data.threshold}</span>
            {awarded && <span className="text-emerald-400 ml-2">· awarded ✓</span>}
          </span>
        </div>
        <div className="h-2 bg-surface border border-line relative overflow-hidden">
          <div
            className={`h-full transition-all duration-700 ${
              awarded ? "bg-emerald-500" : "bg-brand"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {!awarded && remaining > 0 && (
          <p className="font-mono text-[10px] text-ink-muted">
            {remaining} more {remaining === 1 ? "signup" : "signups"} until your{" "}
            {data.bonus_days}-day extension unlocks.
          </p>
        )}
      </div>

      {/* Share link */}
      <div
        className="bg-paper border border-line p-3 flex items-center gap-2 flex-wrap"
        data-testid="referral-share-link"
      >
        <div className="flex-1 min-w-[180px] font-mono text-[11px] text-ink break-all">
          {data.share_link}
        </div>
        <button
          onClick={copyLink}
          className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition inline-flex items-center gap-1.5"
          data-testid="referral-copy-btn"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={rotate}
          disabled={busy}
          className="px-3 py-1.5 border border-line hover:border-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink transition inline-flex items-center gap-1.5 disabled:opacity-50"
          data-testid="referral-rotate-btn"
          title="Rotate to a fresh code"
        >
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
          {busy ? "…" : "Rotate"}
        </button>
      </div>

      <p className="font-mono text-[10px] text-ink-muted mt-3 leading-relaxed">
        Your code: <span className="text-ink-muted">{data.code}</span>. Anyone
        who applies via your link is auto-credited once they're approved and
        subscribe to Plus.
      </p>

      {/* One-tap share buttons — open the platform's compose dialog in a
          new tab with the maker's link pre-filled. Falls back to the
          OS share sheet on mobile when available. */}
      <ShareRow shareLink={data.share_link} />
    </section>
  );
}

function ShareRow({ shareLink }) {
  const encodedUrl = encodeURIComponent(shareLink);
  const encodedText = encodeURIComponent(`${INVITE_TEXT_SHORT} ${shareLink}`);
  const pinImage = encodeURIComponent(
    "https://craftersmarket.org/downloads/cnc-garage-builders.png",
  );
  const pinDesc = encodeURIComponent(PINTEREST_DESC);

  const targets = [
    {
      key: "x",
      label: "X",
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(INVITE_TEXT_SHORT)}&url=${encodedUrl}`,
    },
    {
      key: "facebook",
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodeURIComponent(INVITE_TEXT)}`,
    },
    {
      key: "pinterest",
      label: "Pinterest",
      href: `https://pinterest.com/pin/create/button/?url=${encodedUrl}&media=${pinImage}&description=${pinDesc}`,
    },
    {
      key: "email",
      label: "Email",
      href: `mailto:?subject=${encodeURIComponent("Join me on Crafters Market")}&body=${encodedText}`,
    },
    {
      key: "sms",
      label: "SMS",
      href: `sms:?&body=${encodedText}`,
    },
  ];

  const tryNativeShare = async () => {
    if (!navigator.share) return false;
    try {
      await navigator.share({
        title: "Crafters Market — founding seller invite",
        text: INVITE_TEXT_SHORT,
        url: shareLink,
      });
      return true;
    } catch {
      // User canceled or device blocked — fall back silently.
      return false;
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-line" data-testid="referral-share-row">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2.5">
        ◆ Share in one tap
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Native OS share sheet (mobile Safari, Chrome Android, etc.) —
            no-op on desktop. Lives first so phone users hit it before
            scanning the per-platform list. */}
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button
            onClick={tryNativeShare}
            className="px-3 py-1.5 border border-brand bg-brand/10 hover:bg-brand/20 text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
            data-testid="referral-share-native"
            title="Open native share sheet"
          >
            ↗ Share…
          </button>
        )}
        {targets.map((t) => (
          <a
            key={t.key}
            href={t.href}
            target={t.key === "email" || t.key === "sms" ? undefined : "_blank"}
            rel="noopener noreferrer"
            className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted transition"
            data-testid={`referral-share-${t.key}`}
          >
            {t.label}
          </a>
        ))}
      </div>
      <p className="font-mono text-[9px] text-ink-muted mt-2 leading-relaxed">
        Each click opens that platform's composer with your link pre-filled.
        Pinterest pins use the Crafters Market brand image.
      </p>
    </div>
  );
}
