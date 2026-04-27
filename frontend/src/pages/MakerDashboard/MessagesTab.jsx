import React, { useState } from "react";
import { MessageSquare, Bell } from "lucide-react";
import { toast } from "sonner";
import { subscribeNewsletter } from "../../lib/api";

/** Messages tab — coming-soon stub with interest collector.
 *  Tags makers as `dms-waitlist` in Kit so we can ship to them when DMs land. */
export default function MessagesTab({ maker }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const notifyMe = async () => {
    if (!maker?.email) {
      toast.error("Sign in to subscribe");
      return;
    }
    setBusy(true);
    try {
      await subscribeNewsletter(maker.email, "dms-waitlist");
      setDone(true);
      toast.success("You're on the list — we'll email when DMs ship.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save your interest.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="messages-tab">
      <header className="pb-6 border-b border-[#262626]">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Messages.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
          Direct messages between buyers, makers, and admin — coming soon.
        </p>
      </header>
      <div className="border border-[#1f1f1f] bg-[#0d0d0d] p-10 text-center max-w-lg mx-auto">
        <MessageSquare size={36} className="text-[#ff4500] mx-auto mb-4" />
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
          ◆ In development
        </div>
        <h3 className="font-display text-3xl md:text-4xl uppercase mb-3">DMs ship next.</h3>
        <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mb-6">
          Order-related questions currently route through email. We're building a
          proper DM thread system with read receipts, attachments, and the same AI
          moderation that protects the live chat.
        </p>
        {done ? (
          <div className="border border-emerald-700 bg-emerald-900/20 px-4 py-3 font-mono text-xs text-emerald-300 inline-block">
            ✓ You'll be the first to know.
          </div>
        ) : (
          <button
            onClick={notifyMe}
            disabled={busy}
            className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="messages-notify-btn"
          >
            <Bell size={14} /> {busy ? "Saving…" : "Notify me when DMs ship"}
          </button>
        )}
      </div>
    </div>
  );
}
