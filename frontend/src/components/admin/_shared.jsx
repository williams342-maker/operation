import React from "react";

export const Stat = ({ label, value, testId }) => (
  <div className="border border-[#262626] p-4 md:p-6" data-testid={testId}>
    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</div>
    <div className="font-display text-3xl md:text-5xl mt-2 text-[#e5e5e5]">{value}</div>
  </div>
);
