import { useEffect, useState } from "react";

// Tiny shared hook: ticks every second and returns a formatted countdown
// string ("2d 14h", "4h 22m", "12m 03s") plus the raw msLeft so callers
// can hide themselves once the deadline passes.
//
// Pass either:
//   - `target`: Date | string | number (the absolute deadline)
//   - `weekly`: true to count down to the next Monday 00:00 UTC
//
// Re-targeting (e.g. weekly rollover) is handled internally so the calling
// component never re-renders unnecessarily.
export default function useCountdown({ target, weekly = false } = {}) {
  const computeTarget = () => {
    if (weekly) {
      // Next Monday 00:00 UTC
      const now = new Date();
      const d = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      ));
      // 1 = Monday, 0 = Sunday in getUTCDay
      const dow = d.getUTCDay();
      const daysUntilMonday = (8 - dow) % 7 || 7;
      d.setUTCDate(d.getUTCDate() + daysUntilMonday);
      return d.getTime();
    }
    if (!target) return 0;
    return new Date(target).getTime();
  };

  const [deadline, setDeadline] = useState(computeTarget);
  const [msLeft, setMsLeft] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    setDeadline(computeTarget());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, weekly]);

  useEffect(() => {
    const tick = () => {
      const left = deadline - Date.now();
      if (left <= 0 && weekly) {
        // Roll over to next Monday seamlessly
        setDeadline(computeTarget());
        setMsLeft(0);
      } else {
        setMsLeft(Math.max(0, left));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, weekly]);

  const totalSec = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  // Format priorities:
  //  > 24h   → "2d 14h"
  //  1-24h   → "4h 22m"
  //  < 1h    → "12m 03s"
  let label;
  if (days >= 1) label = `${days}d ${String(hours).padStart(2, "0")}h`;
  else if (hours >= 1) label = `${hours}h ${String(minutes).padStart(2, "0")}m`;
  else label = `${minutes}m ${String(seconds).padStart(2, "0")}s`;

  return { msLeft, days, hours, minutes, seconds, label, expired: msLeft <= 0 };
}
