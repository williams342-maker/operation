import React, { useMemo } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Animated ember field — soft glowing particles drifting upward like
 * sparks rising from a forge. CSS-only (no JS RAF loop, no canvas), so
 * the cost is essentially zero even on weak hardware.
 *
 * Implementation: each ember is an absolutely-positioned 2-3px copper
 * dot with a CSS keyframe that translates it up + fades it out over a
 * random duration (8-16s) and delay (0-12s). Seeded once at mount via
 * useMemo so the same browser session gets a stable particle layout
 * (no re-render churn).
 *
 * Mounts pointer-events:none + aria-hidden — purely decorative.
 * `prefers-reduced-motion`: returns null (renders nothing) so the
 * reduced-motion experience is just the static hero photo + glow.
 */
export default function EmberField({ count = 24, className = "" }) {
  const reduced = useReducedMotion();
  const embers = useMemo(() => {
    if (reduced) return [];
    return Array.from({ length: count }, (_, i) => {
      const seed = i / count;
      return {
        id: i,
        left: `${Math.random() * 100}%`,
        size: 1.5 + Math.random() * 2.5, // 1.5–4px
        duration: 8 + Math.random() * 8, // 8–16s rise
        delay: -Math.random() * 12,      // negative so they're already mid-cycle on mount
        opacity: 0.35 + Math.random() * 0.45,
        warm: seed > 0.5,                // half copper, half warm-orange
      };
    });
  }, [count, reduced]);

  if (reduced) return null;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none overflow-hidden ${className}`}
      data-testid="hero-ember-field"
    >
      {embers.map((e) => (
        <span
          key={e.id}
          className="absolute bottom-[-10px] rounded-full ember-rise"
          style={{
            left: e.left,
            width: `${e.size}px`,
            height: `${e.size}px`,
            background: e.warm ? "#ffb066" : "#f59e0b",
            boxShadow: e.warm
              ? "0 0 8px 1px rgba(255, 176, 102, 0.7), 0 0 16px 2px rgba(255, 100, 30, 0.4)"
              : "0 0 8px 1px rgba(245, 158, 11, 0.7), 0 0 16px 2px rgba(255, 69, 0, 0.3)",
            opacity: e.opacity,
            animationDuration: `${e.duration}s`,
            animationDelay: `${e.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
