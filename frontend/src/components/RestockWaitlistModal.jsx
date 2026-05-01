/**
 * Lightweight 0-stock notify modal — mirrors BackorderRequestModal's
 * tone but asks for nothing more than name + email. Single email goes
 * out the moment the maker raises stock from 0 → positive on this
 * listing. No commitment, no maker decision needed.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { joinRestockWaitlist } from "../lib/api";

export default function RestockWaitlistModal({ product, onClose }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Enter a valid email.");
      return;
    }
    setBusy(true);
    try {
      await joinRestockWaitlist(product.slug, {
        buyer_email: email.trim(),
        buyer_name: name.trim(),
      });
      setDone(true);
      toast.success("On the list — we'll email you when it's back.");
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
        className="bg-[#0a0a0a] border border-[#262626] w-full max-w-md p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 hover:bg-[#1a1a1a]"
          data-testid="restock-modal-close"
          aria-label="Close"
        >
          <X size={16} className="text-[#a3a3a3]" />
        </button>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
          ◆ Restock alert
        </div>
        <h2 className="font-display text-2xl mt-1 text-[#e5e5e5]">
          {done ? "You're on the list." : "Notify when restocked"}
        </h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 leading-relaxed">
          {done
            ? `We'll email you the moment ${product.title} is back in stock — single email, no marketing.`
            : `We'll send you exactly one email the moment ${product.title} is back in stock. No marketing, no follow-ups.`}
        </p>

        {!done && (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Email *
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2.5 font-mono text-sm text-[#e5e5e5]"
                placeholder="you@studio.com"
                data-testid="restock-modal-email"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Name (optional)
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2.5 font-mono text-sm text-[#e5e5e5]"
                placeholder="So we can address you nicely"
                data-testid="restock-modal-name"
              />
            </label>
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
