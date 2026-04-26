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
  <div className="border border-[#262626] p-4 md:p-6" data-testid={testId}>
    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</div>
    <div className="font-display text-3xl md:text-5xl mt-2 text-[#e5e5e5]">{value}</div>
  </div>
);

export const Field = ({ label, value, onChange, type = "text", testId, wide = false }) => (
  <label className={`block ${wide ? "md:col-span-2" : ""}`}>
    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</span>
    <input
      type={type}
      value={value}
      onChange={onChange}
      className="mt-2 w-full bg-[#0f0f0f] border border-[#262626] focus:border-[#ff4500] focus:outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5]"
      data-testid={testId}
    />
  </label>
);

// Used inside the New-Listing modal (slightly different shape — the label
// renders above as a div, then children render as-is).
export const LabeledField = ({ label, children }) => (
  <label className="block">
    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
      {label}
    </div>
    {children}
  </label>
);
