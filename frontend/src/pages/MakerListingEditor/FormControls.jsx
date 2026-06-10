import React from "react";
import { Copy, Eye, Save, Send, Check, Loader2, AlertCircle } from "lucide-react";

/**
 * Shared form controls for the Listing Editor. These are pure presentational
 * components — no state of their own, all behavior is driven by props from
 * the parent orchestrator. Kept together in one file because they're each
 * 5-15 lines and always change together; one file = one mental model.
 */

export function Section({ eyebrow, title, subtitle, counter, right, children }) {
  return (
    <section className="grid md:grid-cols-[280px_1fr] gap-6 md:gap-12 pb-12 border-b border-line">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-3">
          {eyebrow}
        </div>
        <h2 className="font-display text-2xl md:text-3xl uppercase">{title}</h2>
        {subtitle && <p className="font-mono text-xs text-ink-muted mt-3 leading-relaxed">{subtitle}</p>}
        {counter && <p className="font-mono text-[10px] text-ink-muted mt-3 uppercase tracking-[0.22em]">{counter}</p>}
      </div>
      <div className="space-y-1">
        {right && <div className="flex justify-end mb-3">{right}</div>}
        {children}
      </div>
    </section>
  );
}

export function Label({ children }) {
  return (
    <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1.5">
      {children}
    </label>
  );
}

export function FieldError({ msg }) {
  return (
    <p className="font-mono text-[11px] text-red-400 mt-1" data-testid="editor-field-error">{msg}</p>
  );
}

export function NumInput({ value, onChange, placeholder, testid }) {
  return (
    <input
      type="number" step="any" value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
      data-testid={testid}
    />
  );
}

export function Select({ value, onChange, options, testid }) {
  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
      data-testid={testid}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  );
}

export function ChipGrid({ options, selected, onToggle, testidPrefix }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt} type="button" onClick={() => onToggle(opt)}
            className={`px-3 py-1.5 border font-mono text-[11px] transition ${
              on
                ? "border-brand bg-brand/10 text-brand"
                : "border-line text-ink-muted hover:border-line"
            }`}
            data-testid={`${testidPrefix}-${opt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, label, testid }) {
  return (
    <button
      type="button" onClick={() => onChange(!on)}
      className="inline-flex items-center gap-3"
      data-testid={testid}
    >
      <span className={`w-9 h-5 border ${on ? "border-brand bg-brand/20" : "border-line bg-surface"} relative transition`}>
        <span className={`absolute top-0.5 transition-all ${on ? "right-0.5 bg-brand" : "left-0.5 bg-ink-muted"} w-3.5 h-3.5`} />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{label}</span>
    </button>
  );
}

export function ToggleRow({ label, hint, on, onChange, testid }) {
  return (
    <div className="flex items-start justify-between gap-4 border border-line p-4">
      <div className="min-w-0">
        <div className="font-mono text-xs uppercase tracking-[0.22em] text-ink">{label}</div>
        {hint && <p className="font-mono text-[11px] text-ink-muted mt-1">{hint}</p>}
      </div>
      <Toggle on={on} onChange={onChange} testid={testid} label="" />
    </div>
  );
}

export function ActionButtons({ isEdit, saving, canPublish, errors, autoStatus, lastSavedAt, agoTick, onClone, onPreview, onSaveDraft, onPublish, uploadingPhotos = 0 }) {
  // Build a short "what's missing" hint shown next to a disabled Publish
  // button so the maker isn't left wondering why the orange CTA is greyed
  // out. We only show it when there are actual validation issues; the hint
  // disappears the moment the form is publish-ready.
  const missingFields = errors ? Object.keys(errors) : [];
  const missingHint = missingFields.length > 0
    ? `Add ${missingFields.slice(0, 3).join(", ")}${missingFields.length > 3 ? "…" : ""} to publish`
    : "";
  // While photos are still streaming up to R2 we want both Save Draft and
  // Publish disabled. We piggy-back on the existing `saving` styling so the
  // visual treatment matches, but show a distinct label so the maker knows
  // why the button is locked out.
  const photoBusy = uploadingPhotos > 0;
  const photoLabel = photoBusy
    ? `Uploading ${uploadingPhotos} photo${uploadingPhotos === 1 ? "" : "s"}…`
    : null;

  return (
    <div className="flex items-center gap-2">
      <AutoSaveIndicator status={autoStatus} lastSavedAt={lastSavedAt} agoTick={agoTick} />
      {isEdit && (
        <button
          type="button" onClick={onClone}
          className="hidden sm:inline-flex px-3 py-1.5 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em] items-center gap-2"
          data-testid="editor-clone-btn"
        >
          <Copy size={12} /> Clone
        </button>
      )}
      <button
        type="button" onClick={onPreview}
        className="hidden sm:inline-flex px-3 py-1.5 border border-brand text-brand hover:bg-brand/10 font-mono text-[10px] uppercase tracking-[0.22em] items-center gap-2"
        data-testid="editor-preview-btn"
      >
        <Eye size={12} /> Preview
      </button>
      {/* Save Draft is the always-available escape hatch — the safest action
          for a half-finished listing. Painted bright (white text + emerald
          left border accent) so it never gets lost next to the orange
          Publish CTA. */}
      <button
        type="button" onClick={onSaveDraft} disabled={saving || photoBusy}
        className="px-4 py-1.5 border-2 border-emerald-500/70 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-400 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2 disabled:opacity-50 transition"
        data-testid="editor-save-draft-btn"
        title={photoLabel || undefined}
      >
        <Save size={12} /> {photoBusy ? photoLabel : (saving ? "Saving…" : "Save Draft")}
      </button>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button" onClick={onPublish} disabled={saving || !canPublish || photoBusy}
          className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50 px-4 py-1.5"
          data-testid="editor-publish-btn"
          title={photoLabel || (!canPublish && missingHint ? missingHint : undefined)}
        >
          <Send size={12} /> {photoBusy ? photoLabel : (saving ? "Publishing…" : "Publish Listing")}
        </button>
        {!canPublish && missingHint && (
          <span
            className="hidden md:block font-mono text-[9px] uppercase tracking-[0.18em] text-amber-400/80 max-w-[220px] text-right leading-tight"
            data-testid="editor-publish-hint"
          >
            ◇ {missingHint}
          </span>
        )}
      </div>
    </div>
  );
}


// Compact pill that shows the autosave lifecycle. Mounted inside the
// action bar so the maker always knows whether their last keystroke is
// safe on the server. Idle state renders nothing — visually quiet by
// default, only speaks up when there's something to say.
//
//   • saving → spinning loader + "Saving…"
//   • saved  → green check + relative time ("Saved 3s ago")
//   • error  → amber alert + "Save failed"
//
// `agoTick` is a counter the parent bumps every 30s so the relative
// "X ago" string stays fresh without re-rendering on every keystroke.
export function AutoSaveIndicator({ status, lastSavedAt, agoTick }) {
  if (status === "idle") return null;
  // Reference the tick so React re-renders this component periodically.
  void agoTick;

  if (status === "saving") {
    return (
      <span
        className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted"
        data-testid="editor-autosave-saving"
      >
        <Loader2 size={11} className="animate-spin" />
        Saving…
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-400"
        data-testid="editor-autosave-error"
        title="Last autosave failed — use Save Draft to retry."
      >
        <AlertCircle size={11} />
        Save failed
      </span>
    );
  }

  // status === "saved"
  return (
    <span
      className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400/80"
      data-testid="editor-autosave-saved"
    >
      <Check size={11} />
      Saved {relativeTime(lastSavedAt)}
    </span>
  );
}

// Tiny relative-time helper. Coarse buckets — granularity below 5s isn't
// useful, and we never need >24h precision since the page won't outlive
// a single session.
function relativeTime(date) {
  if (!date) return "just now";
  const sec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}
