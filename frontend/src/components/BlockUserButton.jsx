/**
 * Block / unblock button for a DM thread — Google Play UGC compliance.
 * Behavior:
 *   • Block: prevents future messages from the other party (bidirectional),
 *     hides the thread from the actor's inbox, disables the reply box.
 *   • Unblock: restores messaging and re-shows the thread.
 *
 * Props:
 *   • threadId: string    (required)
 *   • blocked:  boolean   (server-supplied — draw the correct label)
 *   • role:     "maker" | "buyer"
 *   • onToggle: (nowBlocked: boolean) => void
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

function _authHeader(role) {
  const t = role === "maker"
    ? (localStorage.getItem("cm_maker_jwt") || localStorage.getItem("cm_buyer_jwt"))
    : (localStorage.getItem("cm_buyer_jwt") || localStorage.getItem("cm_maker_jwt"));
  return t ? { Authorization: `Bearer ${t}` } : null;
}

export function BlockUserButton({ threadId, blocked, role = "buyer", onToggle }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function call(endpoint) {
    const hdr = _authHeader(role);
    if (!hdr) {
      toast.error("Sign in required.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hdr },
        body: JSON.stringify({ thread_id: threadId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      const nowBlocked = endpoint.endsWith("/blocks");
      toast.success(nowBlocked ? "User blocked." : "User unblocked.");
      onToggle?.(nowBlocked);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); setConfirming(false); }
  }

  if (blocked) {
    return (
      <button
        type="button"
        onClick={() => call("/api/messages/blocks/remove")}
        disabled={busy}
        className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink transition"
        data-testid="dm-unblock-btn"
      >
        <Ban size={12} aria-hidden />
        {busy ? "…" : "Unblock user"}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-red-500 hover:border-red-500 transition"
        data-testid="dm-block-btn"
      >
        <Ban size={12} aria-hidden />
        Block user
      </button>

      {confirming && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center px-4"
             onClick={(e) => e.target === e.currentTarget && setConfirming(false)}
             data-testid="block-confirm-modal">
          <div className="max-w-md w-full bg-paper border border-line p-6">
            <h3 className="font-display text-xl mb-3">Block this user?</h3>
            <p className="text-ink-muted text-sm mb-4">
              Neither of you will be able to send messages to the other.
              This conversation will be hidden from your inbox. You can
              unblock at any time.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-surface-2"
                data-testid="block-cancel-btn"
              >
                Cancel
              </button>
              <button
                onClick={() => call("/api/messages/blocks")}
                disabled={busy}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-mono text-xs uppercase tracking-[0.22em] px-4 py-2"
                data-testid="block-confirm-btn"
              >
                {busy ? "…" : "Block user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default BlockUserButton;
