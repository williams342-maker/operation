import React from "react";

export const Stat = ({ label, value, testId }) => (
  <div className="border border-[#262626] p-3 md:p-6" data-testid={testId}>
    <div className="font-mono text-[9px] md:text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] truncate">{label}</div>
    <div className="font-display text-2xl md:text-5xl mt-1 md:mt-2 text-[#e5e5e5] truncate">{value}</div>
  </div>
);

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
