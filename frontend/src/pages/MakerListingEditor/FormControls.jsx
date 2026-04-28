import React from "react";
import { Copy, Eye, Save, Send } from "lucide-react";

/**
 * Shared form controls for the Listing Editor. These are pure presentational
 * components — no state of their own, all behavior is driven by props from
 * the parent orchestrator. Kept together in one file because they're each
 * 5-15 lines and always change together; one file = one mental model.
 */

export function Section({ eyebrow, title, subtitle, counter, right, children }) {
  return (
    <section className="grid md:grid-cols-[280px_1fr] gap-6 md:gap-12 pb-12 border-b border-[#1f1f1f]">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
          {eyebrow}
        </div>
        <h2 className="font-display text-2xl md:text-3xl uppercase">{title}</h2>
        {subtitle && <p className="font-mono text-xs text-[#a3a3a3] mt-3 leading-relaxed">{subtitle}</p>}
        {counter && <p className="font-mono text-[10px] text-[#525252] mt-3 uppercase tracking-[0.22em]">{counter}</p>}
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
    <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1.5">
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
      className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
      data-testid={testid}
    />
  );
}

export function Select({ value, onChange, options, testid }) {
  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
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
                ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]"
                : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
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
      <span className={`w-9 h-5 border ${on ? "border-[#ff4500] bg-[#ff4500]/20" : "border-[#262626] bg-[#1a1a1a]"} relative transition`}>
        <span className={`absolute top-0.5 transition-all ${on ? "right-0.5 bg-[#ff4500]" : "left-0.5 bg-[#525252]"} w-3.5 h-3.5`} />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</span>
    </button>
  );
}

export function ToggleRow({ label, hint, on, onChange, testid }) {
  return (
    <div className="flex items-start justify-between gap-4 border border-[#1f1f1f] p-4">
      <div className="min-w-0">
        <div className="font-mono text-xs uppercase tracking-[0.22em] text-[#e5e5e5]">{label}</div>
        {hint && <p className="font-mono text-[11px] text-[#737373] mt-1">{hint}</p>}
      </div>
      <Toggle on={on} onChange={onChange} testid={testid} label="" />
    </div>
  );
}

export function ActionButtons({ isEdit, saving, canPublish, onClone, onPreview, onSaveDraft, onPublish }) {
  return (
    <div className="flex items-center gap-2">
      {isEdit && (
        <button
          type="button" onClick={onClone}
          className="hidden sm:inline-flex px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] items-center gap-2"
          data-testid="editor-clone-btn"
        >
          <Copy size={12} /> Clone
        </button>
      )}
      <button
        type="button" onClick={onPreview}
        className="hidden sm:inline-flex px-3 py-1.5 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[10px] uppercase tracking-[0.22em] items-center gap-2"
        data-testid="editor-preview-btn"
      >
        <Eye size={12} /> Preview
      </button>
      <button
        type="button" onClick={onSaveDraft} disabled={saving}
        className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2 disabled:opacity-50"
        data-testid="editor-save-draft-btn"
      >
        <Save size={12} /> {saving ? "Saving…" : "Save Draft"}
      </button>
      <button
        type="button" onClick={onPublish} disabled={saving || !canPublish}
        className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50 px-4 py-1.5"
        data-testid="editor-publish-btn"
      >
        <Send size={12} /> {saving ? "Publishing…" : "Publish Listing"}
      </button>
    </div>
  );
}
