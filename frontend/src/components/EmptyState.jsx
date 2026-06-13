import React from "react";
import { Link } from "react-router-dom";
import { ILLUSTRATIONS } from "./EmptyStateIllustrations";

/**
 * Industrial empty-state. Always 3 ingredients:
 *   1. A bold mono eyebrow + display title (the "shape of nothing")
 *   2. One clear action (CTA) — the user's next best move
 *   3. Optional secondary action / hint
 *
 * Avoid generic "no data" messages — every empty state should sell
 * the user on the next move.
 *
 * Visual:
 *   • `illustration` (preferred) — a string key from
 *     EmptyStateIllustrations.ILLUSTRATIONS ("orders", "reviews",
 *     "products", "messages", "package", "no-results") OR a custom
 *     SVG node. Renders large, currentColor-aware, on-brand.
 *   • `icon` (legacy fallback) — a lucide icon component rendered in
 *     a 16x16 bordered chip. Kept for backward compat with the 17
 *     existing callsites that haven't been upgraded yet.
 */
export default function EmptyState({
  illustration,
  icon: Icon,
  eyebrow = "◆ Empty",
  title,
  body,
  subtitle, // legacy alias for `body`
  cta,
  secondary,
  testId = "empty-state",
}) {
  // Resolve string key → component; otherwise treat as raw JSX.
  let illustrationNode = null;
  if (typeof illustration === "string") {
    const Comp = ILLUSTRATIONS[illustration];
    if (Comp) illustrationNode = <Comp />;
  } else if (illustration) {
    illustrationNode = illustration;
  }
  const bodyText = body || subtitle;
  return (
    <div
      className="border border-line bg-paper p-10 md:p-16 text-center"
      data-testid={testId}
    >
      {illustrationNode ? (
        <div
          className="mb-6 flex justify-center text-ink-muted"
          data-testid={`${testId}-illustration`}
        >
          {illustrationNode}
        </div>
      ) : Icon ? (
        <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center bg-surface text-brand border border-line">
          <Icon size={24} />
        </div>
      ) : null}
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-muted mb-3">
        {eyebrow}
      </div>
      <h3 className="font-display text-3xl md:text-5xl tracking-[-0.01em] leading-[0.95] mb-4">
        {title}
      </h3>
      {bodyText && (
        <p className="font-mono text-sm text-ink-muted max-w-[42ch] mx-auto mb-8 leading-relaxed">
          {bodyText}
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
    "font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition";
  if (href) return <Link to={href} className={cls}>{children}</Link>;
  return <button onClick={onClick} className={cls}>{children}</button>;
}
