/**
 * Lightweight 0-stock notify modal — mirrors BackorderRequestModal's
 * tone but asks for nothing more than name + email + (optional) phone.
 * Single email (and optional SMS) goes out the moment the maker raises
 * stock from 0 → positive on this listing. No commitment, no maker
 * decision needed.
 *
 * iter266 — Added optional "Also text me" SMS opt-in. Phone input only
 * appears once the checkbox is ticked, and the consent timestamp is
 * stamped at click-time so the backend has an audit trail.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { joinRestockWaitlist } from "../lib/api";

export default function RestockWaitlistModal({ product, onClose }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Enter a valid email.");
      return;
    }
    if (smsOptIn && !/^\+?[\d\s().-]{7,20}$/.test(phone.trim())) {
      toast.error("Enter a valid phone number, or untick the text-me box.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        buyer_email: email.trim(),
        buyer_name: name.trim(),
      };
      if (smsOptIn && phone.trim()) {
        payload.phone = phone.trim();
        payload.sms_consent_at = new Date().toISOString();
      }
      await joinRestockWaitlist(product.slug, payload);
      setDone(true);
      toast.success(
        smsOptIn
          ? "On the list — we'll email + text you when it's back."
          : "On the list — we'll email you when it's back."
      );
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't add you. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="restock-modal"
    >
      <div
        className="bg-paper border border-line w-full max-w-md p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 hover:bg-surface"
          data-testid="restock-modal-close"
          aria-label="Close"
        >
          <X size={16} className="text-ink-muted" />
        </button>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
          ◆ Restock alert
        </div>
        <h2 className="font-display text-2xl mt-1 text-ink">
          {done ? "You're on the list." : "Notify when restocked"}
        </h2>
        <p className="font-mono text-xs text-ink-muted mt-2 leading-relaxed">
          {done
            ? `We'll let you know the moment ${product.title} is back in stock — no marketing, no follow-ups.`
            : `We'll send you exactly one alert the moment ${product.title} is back in stock. No marketing, no follow-ups.`}
        </p>

        {!done && (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                Email *
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 bg-paper border border-line focus:border-brand outline-none px-3 py-2.5 font-mono text-sm text-ink"
                placeholder="you@studio.com"
                data-testid="restock-modal-email"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                Name (optional)
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 bg-paper border border-line focus:border-brand outline-none px-3 py-2.5 font-mono text-sm text-ink"
                placeholder="So we can address you nicely"
                data-testid="restock-modal-name"
              />
            </label>

            {/* iter266 — SMS opt-in (collapsed by default) */}
            <div className="border border-line p-3" data-testid="restock-modal-sms-block">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsOptIn}
                  onChange={(e) => setSmsOptIn(e.target.checked)}
                  className="mt-1 accent-[#ff4500]"
                  data-testid="restock-modal-sms-optin"
                />
                <span className="font-mono text-xs text-ink leading-snug">
                  Also text me — they sell out faster than email reads.
                </span>
              </label>
              {smsOptIn && (
                <div className="mt-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                    Mobile number *
                  </span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full mt-1 bg-paper border border-line focus:border-brand outline-none px-3 py-2.5 font-mono text-sm text-ink"
                    placeholder="+1 555 123 4567"
                    data-testid="restock-modal-phone"
                  />
                  <p className="font-mono text-[10px] text-ink-muted mt-1 leading-relaxed">
                    Msg & data rates may apply. One text per restock event. Reply STOP to opt out anytime.
                  </p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="btn-industrial btn-primary w-full justify-center disabled:opacity-50"
              data-testid="restock-modal-submit"
            >
              {busy ? "Adding…" : "Notify me when it's back →"}
            </button>
          </form>
        )}

        {done && (
          <button
            type="button"
            onClick={onClose}
            className="btn-industrial btn-primary w-full justify-center mt-4"
            data-testid="restock-modal-done"
          >
            Got it →
          </button>
        )}
      </div>
    </div>
  );
}
