import React from "react";
import { Link } from "react-router-dom";

/**
 * Industrial empty-state. Always 3 ingredients:
 *   1. A bold mono eyebrow + display title (the "shape of nothing")
 *   2. One clear action (CTA) — the user's next best move
 *   3. Optional secondary action / hint
 *
 * Avoid generic "no data" messages — every empty state should sell
 * the user on the next move.
 */
export default function EmptyState({
  icon: Icon,
  eyebrow = "◆ Empty",
  title,
  body,
  cta,
  secondary,
  testId = "empty-state",
}) {
  return (
    <div
      className="border border-[#262626] bg-[#0f0f0f] p-10 md:p-16 text-center"
      data-testid={testId}
    >
      {Icon && (
        <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center bg-[#1a1a1a] text-[#ff4500] border border-[#262626]">
          <Icon size={24} />
        </div>
      )}
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#525252] mb-3">
        {eyebrow}
      </div>
      <h3 className="font-display text-3xl md:text-5xl tracking-[-0.01em] leading-[0.95] mb-4">
        {title}
      </h3>
      {body && (
        <p className="font-mono text-sm text-[#a3a3a3] max-w-[42ch] mx-auto mb-8 leading-relaxed">
          {body}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-4">
        {cta && (
          <CTAButton href={cta.href} onClick={cta.onClick} testId={cta.testId}>
            {cta.label} →
          </CTAButton>
        )}
        {secondary && (
          <CTALink href={secondary.href} onClick={secondary.onClick}>
            {secondary.label}
          </CTALink>
        )}
      </div>
    </div>
  );
}

function CTAButton({ href, onClick, children, testId }) {
  if (href) {
    return (
      <Link to={href} className="btn-industrial btn-primary" data-testid={testId}>
        {children}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className="btn-industrial btn-primary" data-testid={testId}>
      {children}
    </button>
  );
}

function CTALink({ href, onClick, children }) {
  const cls =
    "font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition";
  if (href) return <Link to={href} className={cls}>{children}</Link>;
  return <button onClick={onClick} className={cls}>{children}</button>;
}
