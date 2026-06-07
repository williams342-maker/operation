import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * Rotating cinematic hero headline (iter220).
 *
 * Pulls the live pool from /api/hero/headlines (publicly cached 5min,
 * AI-drafted daily via Gemini + admin-curated seed). Renders one
 * variant at a time in the two-line "STATEMENT. ACCENT CLOSER." shape:
 *
 *     LINE 1 (white, drop-shadow): "{statement}."
 *     LINE 2 (orange + outline):   "{accent} {closer}."
 *
 * Behavior:
 *   - On mount, shuffles the pool once so two adjacent visits don't
 *     start on the same headline (rotation looks intentional).
 *   - Cycles every CYCLE_MS using AnimatePresence cross-fade.
 *   - When the API returns `pinned: true` (only 1 item), rotation is
 *     disabled and that one headline renders static — admin override.
 *   - prefers-reduced-motion: rotation is disabled, fade transitions
 *     drop to 0ms, and the first variant of the shuffled pool renders
 *     as a permanent static headline.
 *   - On fetch failure or empty pool, the FALLBACK constant renders so
 *     the hero is NEVER blank.
 */
const CYCLE_MS = 7000;

const FALLBACK = {
  id: "fallback",
  statement: "Makers • Growers • Creators",
  accent: "Belong",
  closer: "Here",
  source: "fallback",
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function RotatingHeadline({ testId = "hero-rotating-headline" }) {
  const reduced = useReducedMotion();
  const [pool, setPool] = useState([FALLBACK]);
  const [pinned, setPinned] = useState(false);
  const [idx, setIdx] = useState(0);
  const timer = useRef(null);

  // 1) Fetch the live pool once on mount.
  useEffect(() => {
    let alive = true;
    // Use native fetch directly — bypasses the axios `http` instance's
    // 422-detail interceptor which was eating responses on some
    // first-render races in dev mode.
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/hero/headlines`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        const items = Array.isArray(data.items) && data.items.length ? data.items : [FALLBACK];
        setPool(shuffle(items));
        setPinned(Boolean(data.pinned));
        setIdx(0);
      })
      .catch(() => {
        // Endpoint down → keep FALLBACK, hero never breaks
      });
    return () => { alive = false; };
  }, []);

  // 2) Drive the rotation timer. Stops on pin, reduced-motion, or
  //    pool size < 2 (no point cycling a 1-item list).
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (reduced || pinned || pool.length < 2) return;
    timer.current = setInterval(() => {
      setIdx((i) => (i + 1) % pool.length);
    }, CYCLE_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [reduced, pinned, pool.length]);

  const current = pool[idx] || FALLBACK;

  // Stable transition config — AnimatePresence cross-fade between
  // variants. With reduced-motion the durations collapse to ~0 so the
  // swap is effectively a static replace.
  const duration = reduced ? 0.001 : 0.55;
  const initial = useMemo(() => ({ opacity: 0, y: 12 }), []);
  const animate = useMemo(() => ({ opacity: 1, y: 0 }), []);
  const exit = useMemo(() => ({ opacity: 0, y: -10 }), []);

  return (
    <div
      className="relative"
      data-testid={testId}
      data-headline-id={current.id}
      data-headline-source={current.source}
    >
      <h1
        className="font-display text-[48px] sm:text-[68px] md:text-[102px] lg:text-[126px] leading-[0.9] tracking-tighter drop-shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
        aria-live="polite"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`statement-${current.id}`}
            initial={initial}
            animate={animate}
            exit={exit}
            transition={{ duration, ease: [0.16, 1, 0.3, 1] }}
            data-testid={`${testId}-statement`}
          >
            {current.statement}.
          </motion.div>
        </AnimatePresence>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`closer-${current.id}`}
            initial={initial}
            animate={animate}
            exit={exit}
            transition={{ duration, delay: reduced ? 0 : 0.08, ease: [0.16, 1, 0.3, 1] }}
            data-testid={`${testId}-closer`}
          >
            <span className="text-[#ff4500]">{current.accent}</span>{" "}
            <span className="text-outline">{current.closer}.</span>
          </motion.div>
        </AnimatePresence>
      </h1>
    </div>
  );
}
