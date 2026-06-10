import React from "react";

export const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

export const Stat = ({ label, value, testId }) => (
  <div className="border border-line p-4 md:p-6" data-testid={testId}>
    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{label}</div>
    <div className="font-display text-3xl md:text-5xl mt-2 text-ink">{value}</div>
  </div>
);

export const Field = ({ label, value, onChange, type = "text", testId, wide = false }) => (
  <label className={`block ${wide ? "md:col-span-2" : ""}`}>
    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{label}</span>
    <input
      type={type}
      value={value}
      onChange={onChange}
      className="mt-2 w-full bg-paper border border-line focus:border-brand focus:outline-none px-4 py-3 font-mono text-sm text-ink"
      data-testid={testId}
    />
  </label>
);

// Used inside the New-Listing modal (slightly different shape — the label
// renders above as a div, then children render as-is).
export const LabeledField = ({ label, children }) => (
  <label className="block">
    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
      {label}
    </div>
    {children}
  </label>
);
