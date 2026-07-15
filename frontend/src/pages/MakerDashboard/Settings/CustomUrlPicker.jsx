import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Check, X, Copy } from "lucide-react";
import {
  fetchMakerCustomUrl, checkMakerCustomUrl, claimMakerCustomUrl,
} from "../../../lib/api";

/**
 * Custom shop URL picker (available to all approved makers). Lives inside
 * the Settings → Account panel below the subscription block.
 *
 * UX:
 *  - Current value rendered with copy-to-clipboard + edit button
 *  - Edit mode opens an inline input with 300ms debounced availability
 *    checks. The Save button is disabled until the check is `available`.
 *  - Reserved-word rejection comes from the server (frontend doesn't
 *    duplicate the blocklist).
 */
export default function CustomUrlPicker() {
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [check, setCheck] = useState(null); // {available, reason} | null
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    fetchMakerCustomUrl().then(setState).catch(() => {});
  }, []);

  // Debounced availability check as the maker types.
  useEffect(() => {
    if (!editing) return;
    if (!draft) {
      setCheck(null);
      return;
    }
    setChecking(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await checkMakerCustomUrl(draft);
        setCheck(r);
      } catch (e) {
        setCheck({ available: false, reason: e?.response?.data?.detail || "Couldn't check that name." });
      } finally {
        setChecking(false);
      }
    }, 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [draft, editing]);

  if (!state) return null;

  const origin = window.location.origin;
  const fullUrl = state.custom_url ? `${origin}/makers/${state.custom_url}` : null;

  const startEdit = () => {
    setDraft(state.custom_url || "");
    setCheck(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft("");
    setCheck(null);
  };

  const save = async () => {
    if (!check?.available) return;
    setSaving(true);
    try {
      const r = await claimMakerCustomUrl(draft.trim().toLowerCase());
      setState(r);
      setEditing(false);
      setDraft("");
      setCheck(null);
      toast.success("Custom URL claimed.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save that URL.");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast.success("Copied.");
    } catch {/* clipboard may be blocked in some preview contexts */}
  };

  return (
    <section className="border border-line p-5" data-testid="custom-url-section">
      <div className="flex items-start gap-3 mb-4">
        <Sparkles size={16} className="text-brand mt-1 shrink-0" />
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
            ◆ Custom store URL
          </div>
          <h3 className="font-display text-xl uppercase mt-1">Vanity URL.</h3>
          <p className="font-mono text-xs text-ink-muted mt-2 leading-relaxed max-w-md">
            Claim a memorable URL like <span className="text-ink">craftersmarket.org/makers/ugogold</span> —
            easier to share, cleaner on business cards and social media. Your old
            store links keep working: they permanently redirect to the new address,
            so Google results, pins, and bookmarks are preserved.
          </p>
        </div>
      </div>

      {!editing && state.custom_url && (
        <div className="bg-paper border border-line p-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] font-mono text-xs text-ink break-all" data-testid="custom-url-current">
            <span className="text-ink-muted">{origin}/makers/</span>
            <span className="text-brand">{state.custom_url}</span>
          </div>
          <button
            onClick={copy}
            className="px-3 py-1.5 border border-line hover:border-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink transition inline-flex items-center gap-1.5"
            data-testid="custom-url-copy-btn"
          >
            <Copy size={11} /> Copy
          </button>
          <button
            onClick={startEdit}
            className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
            data-testid="custom-url-edit-btn"
          >
            Change
          </button>
        </div>
      )}

      {!editing && !state.custom_url && (
        <button
          onClick={startEdit}
          className="btn-industrial btn-primary text-xs"
          data-testid="custom-url-claim-btn"
        >
          Claim your URL →
        </button>
      )}

      {editing && (
        <div className="space-y-3">
          <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Your vanity URL
          </label>
          <div className="flex items-stretch gap-2 flex-wrap">
            <span className="px-3 py-2 bg-paper border border-line font-mono text-xs text-ink-muted flex items-center">
              {origin}/makers/
            </span>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="your-shop-name"
              maxLength={30}
              className="flex-1 min-w-[160px] px-3 py-2 bg-paper border border-line focus:border-brand focus:outline-none font-mono text-sm text-ink"
              data-testid="custom-url-input"
              autoFocus
            />
          </div>
          {/* Live availability feedback */}
          <div className="font-mono text-[11px] min-h-[18px]" data-testid="custom-url-availability">
            {checking && <span className="text-ink-muted">Checking…</span>}
            {!checking && check?.available && (
              <span className="text-emerald-700 inline-flex items-center gap-1">
                <Check size={12} /> Available
              </span>
            )}
            {!checking && check && !check.available && (
              <span className="text-red-400 inline-flex items-center gap-1">
                <X size={12} /> {check.reason}
              </span>
            )}
          </div>
          <div className="font-mono text-[10px] text-ink-muted leading-relaxed">
            {state.rules}
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={save}
              disabled={!check?.available || saving}
              className="btn-industrial btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="custom-url-save-btn"
            >
              {saving ? "Saving…" : "Save URL"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="px-3 py-2 border border-line hover:border-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink transition disabled:opacity-50"
              data-testid="custom-url-cancel-btn"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
