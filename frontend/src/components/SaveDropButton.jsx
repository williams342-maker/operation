import React, { useState } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";
import { nativeHaptic } from "@/lib/nativeBridge";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const STORE_KEY = "cm_saved_drops";  // localStorage cache of slugs

function readCache() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); }
  catch { return []; }
}
function writeCache(arr) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); } catch {}
}

/**
 * ♡ Save this drop — opt-in to a per-maker Kit segment.
 *
 * One-click flow when the buyer has a known email (logged-in maker / past
 * order); two-click otherwise (collect email inline). On success we cache
 * the saved maker_slug in localStorage so the heart fills in even after
 * page reload, before any auth.
 */
export default function SaveDropButton({ makerSlug, makerName, productSlug, knownEmail }) {
  const [saved, setSaved] = useState(() => readCache().includes(makerSlug));
  const [showInput, setShowInput] = useState(false);
  const [email, setEmail] = useState(knownEmail || "");
  const [submitting, setSubmitting] = useState(false);

  const sendSave = async (e) => {
    if (!e || !/.+@.+\..+/.test(e)) {
      toast.error("Drop a real email and we'll watch for the next one.");
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`${API}/save-drop`, {
        email: e,
        maker_slug: makerSlug,
        product_slug: productSlug || null,
      });
      const next = Array.from(new Set([...readCache(), makerSlug]));
      writeCache(next);
      setSaved(true);
      setShowInput(false);
      nativeHaptic("medium");
      toast.success(`Saved. We'll email you the next drop from ${makerName || makerSlug}.`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't save — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onClick = () => {
    if (saved) {
      // Already saved — toast a quick confirmation. We don't expose unsave
      // from the product page (privacy nudge: unsubscribe link in every email).
      toast.info(`You're already on ${makerName || makerSlug}'s drop list.`);
      return;
    }
    if (knownEmail) sendSave(knownEmail);
    else setShowInput(true);
  };

  if (showInput && !saved) {
    return (
      <form
        onSubmit={(e) => { e.preventDefault(); sendSave(email); }}
        className="border border-brand/40 bg-brand/10 p-3 flex gap-2 items-center"
        data-testid="save-drop-form"
      >
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@workshop.org"
          className="flex-1 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-muted"
          data-testid="save-drop-email"
        />
        <button
          type="submit"
          disabled={submitting}
          className="px-3 py-2 bg-brand text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="save-drop-submit"
        >
          {submitting ? "…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setShowInput(false)}
          className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand"
        >
          ✕
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={saved ? "Saved — you'll be emailed on the next drop" : "Save this drop — get notified next time this maker drops a high-value piece"}
      className={`px-4 py-3 border transition-colors flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] ${
        saved
          ? "border-brand bg-brand/10 text-brand"
          : "border-line hover:border-brand text-ink-muted hover:text-brand"
      }`}
      data-testid="save-drop-btn"
    >
      <Heart size={14} className={saved ? "fill-[#ff4500]" : ""} />
      <span>{saved ? "Saved" : "Save drop"}</span>
    </button>
  );
}
