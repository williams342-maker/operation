import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, X, Trash2 } from "lucide-react";
import { updateMakerProfile } from "../lib/api";

const STORAGE = "cm_proc_profiles_v1";

// Built-in presets — match what most CNC / wood / metal makers actually
// quote in the wild. Two "kinds" (made-to-order vs ready-to-ship) ×
// realistic turnaround times. Buyers see whichever turnaround the
// maker applies on the listing.
const BUILT_INS = [
  { id: "preset-mto-1-2w", kind: "Made to order",  range: "1-2 weeks" },
  { id: "preset-mto-2-4w", kind: "Made to order",  range: "2-4 weeks" },
  { id: "preset-mto-4-6w", kind: "Made to order",  range: "4-6 weeks" },
  { id: "preset-rts-1-3d", kind: "Ready to ship",  range: "1-3 days" },
  { id: "preset-rts-3-5d", kind: "Ready to ship",  range: "3-5 days" },
  { id: "preset-rts-1-2w", kind: "Ready to ship",  range: "1-2 weeks" },
];

const profileLabel = (p) => `${p.kind} · ${p.range}`;

/**
 * Etsy-style processing profile picker.
 *
 * Replaces the legacy single-select dropdown with a card grid. The
 * canonical value is still the `processing_time` string the parent
 * stores on the listing (e.g. "Made to order · 1-2 weeks"); we just
 * give makers a richer chooser + the ability to save reusable custom
 * profiles.
 *
 * Persistence: when a `maker` object is provided, custom profiles
 * round-trip through `PATCH /api/maker/profile` so they carry across
 * devices. On first mount we one-shot-migrate any existing
 * localStorage profiles into the maker doc (then leave the local copy
 * as a read-through fallback for offline/legacy use).
 *
 * Without a `maker` prop the component still works in a localStorage-
 * only mode — useful for any embed where we don't have the maker doc
 * loaded yet (rare, but keeps the contract resilient).
 */
export default function ProcessingProfilePicker({ value, onChange, maker, onMakerUpdated }) {
  // Initial state: prefer server-side profiles when we have them; fall
  // back to localStorage. Both are arrays of `{id, kind, range}`.
  const [custom, setCustom] = useState(() => {
    if (Array.isArray(maker?.processing_profiles) && maker.processing_profiles.length) {
      return maker.processing_profiles;
    }
    try {
      const raw = localStorage.getItem(STORAGE);
      return raw ? (JSON.parse(raw) || []) : [];
    } catch { return []; }
  });
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ kind: "Made to order", range: "1-2 weeks" });
  const migratedRef = useRef(false);

  // Sync down whenever the maker doc changes (e.g. parent reloaded).
  // Only when the server has ANY value — otherwise we'd clobber the
  // pre-migration localStorage copy.
  useEffect(() => {
    if (Array.isArray(maker?.processing_profiles) && maker.processing_profiles.length) {
      setCustom(maker.processing_profiles);
    }
  }, [maker?.processing_profiles]);

  // One-shot migration: if the server has none but localStorage has
  // some, push them up. Idempotent via `migratedRef` so a re-render
  // doesn't spam the API.
  useEffect(() => {
    if (migratedRef.current) return;
    if (!maker) return;
    const serverProfiles = Array.isArray(maker.processing_profiles) ? maker.processing_profiles : [];
    if (serverProfiles.length > 0) { migratedRef.current = true; return; }
    let local = [];
    try {
      const raw = localStorage.getItem(STORAGE);
      local = raw ? (JSON.parse(raw) || []) : [];
    } catch { /* ignore */ }
    if (local.length === 0) { migratedRef.current = true; return; }
    migratedRef.current = true;
    updateMakerProfile({ processing_profiles: local })
      .then((updated) => onMakerUpdated?.(updated))
      .catch(() => { /* graceful — keeps localStorage copy until next attempt */ });
  }, [maker, onMakerUpdated]);

  // Single source-of-truth persistence helper. Writes to local first
  // (instant feedback even if the API is slow) then patches the maker.
  const persist = (next) => {
    setCustom(next);
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); } catch { /* ignore */ }
    if (maker) {
      updateMakerProfile({ processing_profiles: next })
        .then((updated) => onMakerUpdated?.(updated))
        .catch(() => { /* user keeps their local copy; next save retries */ });
    }
  };

  const profiles = useMemo(() => [...BUILT_INS, ...custom], [custom]);
  const matchByLabel = (label) => profiles.find((p) => profileLabel(p) === label);
  const applied = matchByLabel(value);

  const apply = (p) => onChange(profileLabel(p));

  const addCustom = () => {
    if (!draft.kind.trim() || !draft.range.trim()) return;
    const id = `custom-${Date.now()}`;
    const next = [...custom, { id, kind: draft.kind.trim(), range: draft.range.trim() }];
    persist(next);
    apply({ id, kind: draft.kind.trim(), range: draft.range.trim() });
    setCreating(false);
    setDraft({ kind: "Made to order", range: "1-2 weeks" });
  };

  const removeCustom = (id) => {
    const removed = custom.find((p) => p.id === id);
    persist(custom.filter((p) => p.id !== id));
    if (removed && profileLabel(removed) === value) {
      // Fall back to the first preset so the listing isn't left with a deleted profile
      onChange(profileLabel(BUILT_INS[0]));
    }
  };

  // Group "More profiles" by kind so the grid reads nicely
  const byKind = useMemo(() => {
    const out = {};
    profiles.forEach((p) => { (out[p.kind] = out[p.kind] || []).push(p); });
    return out;
  }, [profiles]);

  return (
    <div className="space-y-5" data-testid="processing-profile-picker">
      {/* Currently applied highlight */}
      {applied && (
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted">
            ◆ Currently applied
          </div>
          <ProfileCard p={applied} applied onClick={() => apply(applied)} testIdSuffix="current" />
        </div>
      )}

      {/* All profiles, grouped */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted">
            ◆ All profiles
          </div>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="px-2.5 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 transition"
              data-testid="processing-profile-create"
            >
              <Plus size={11} /> Create new
            </button>
          )}
        </div>

        {/* Inline create form */}
        {creating && (
          <div className="border border-brand/40 bg-brand/10 p-4 space-y-3" data-testid="processing-profile-form">
            <div className="grid grid-cols-2 gap-3">
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                className="bg-paper border border-line px-3 py-2 font-mono text-xs text-ink"
                data-testid="processing-profile-kind"
              >
                <option value="Made to order">Made to order</option>
                <option value="Ready to ship">Ready to ship</option>
                <option value="Pre-order">Pre-order</option>
                <option value="Custom">Custom</option>
              </select>
              <input
                value={draft.range}
                onChange={(e) => setDraft({ ...draft, range: e.target.value })}
                placeholder="e.g. 5-7 business days"
                className="bg-paper border border-line px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-muted"
                data-testid="processing-profile-range"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addCustom}
                disabled={!draft.kind.trim() || !draft.range.trim()}
                className="px-3 py-1.5 border border-brand bg-brand text-black hover:bg-brand-hover font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
                data-testid="processing-profile-save"
              >
                Save & apply
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="px-3 py-1.5 border border-line hover:border-line font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
              >
                <X size={11} /> Cancel
              </button>
            </div>
          </div>
        )}

        {/* Grid */}
        {Object.entries(byKind).map(([kind, list]) => (
          <div key={kind} className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              {kind}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {list.map((p) => (
                <ProfileCard
                  key={p.id}
                  p={p}
                  applied={profileLabel(p) === value}
                  onClick={() => apply(p)}
                  onRemove={p.id.startsWith("custom-") ? () => removeCustom(p.id) : null}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="font-mono text-[10px] text-ink-muted">
        ◆ Custom or made-to-order items often need longer processing time than ready-to-ship inventory.
      </p>
    </div>
  );
}

function ProfileCard({ p, applied, onClick, onRemove, testIdSuffix }) {
  const tid = testIdSuffix ?? p.id;
  return (
    <div
      className={`relative flex items-center justify-between gap-3 px-4 py-3 border transition cursor-pointer ${
        applied
          ? "border-emerald-400 bg-emerald-500/10"
          : "border-line bg-surface hover:border-brand/60"
      }`}
      onClick={onClick}
      data-testid={`processing-profile-card-${tid}`}
    >
      <div className="min-w-0">
        <div className="font-mono text-sm text-ink font-bold">{p.kind}</div>
        <div className="font-mono text-[11px] text-ink-muted mt-0.5">{p.range}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {applied ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700 font-bold">
            <Check size={12} /> Applied
          </span>
        ) : (
          <span className="px-2.5 py-1 border border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Apply
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-ink-muted hover:text-red-400 transition"
            title="Delete this custom profile"
            data-testid={`processing-profile-delete-${tid}`}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
