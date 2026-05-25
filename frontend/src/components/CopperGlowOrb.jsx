import React from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Reusable ambient copper-glow orb. Drop into any `position: relative`
 * parent as decorative-only (pointer-events:none, aria-hidden). Drifts
 * slowly when motion is allowed; pins on prefers-reduced-motion.
 *
 * Props (all optional):
 *   size      — px diameter (default 480)
 *   x, y      — absolute positioning (default top-left)
 *   warm      — when true, use the warmer orange (#ff4500) tint instead
 *               of the molten-copper amber
 *   intensity — 0..1 opacity multiplier (default 0.85)
 *   delay     — animation delay in seconds (stagger multiple orbs)
 */
export default function CopperGlowOrb({
  size = 480,
  x = "50%",
  y = "50%",
  warm = false,
  intensity = 0.85,
  delay = 0,
  className = "",
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      aria-hidden="true"
      className={`copper-glow ${warm ? "copper-glow-warm" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        opacity: intensity,
      }}
      animate={
        reduced
          ? {}
          : {
              x: [0, 18, -10, 0],
              y: [0, -22, 14, 0],
              scale: [1, 1.07, 0.97, 1],
            }
      }
      transition={
        reduced
          ? undefined
          : {
              duration: 16,
              delay,
              repeat: Infinity,
              ease: "easeInOut",
            }
      }
    />
  );
}
