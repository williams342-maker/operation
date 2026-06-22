// iter413cb — Lightweight console + window error ring buffer.
// Captures the last N console.error and window.onerror events so the
// "Report Bug" button in the impersonation banner can ship the trail
// alongside the admin's note. Boots once on import. Safe in private mode.

const MAX = 20;
const _buf = [];

function _push(kind, args) {
  try {
    const msg = Array.from(args || []).map((a) => {
      if (a == null) return String(a);
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? "\n" + a.stack.split("\n").slice(0, 3).join("\n") : ""}`;
      try { return JSON.stringify(a).slice(0, 500); } catch { return String(a).slice(0, 500); }
    }).join(" ");
    _buf.push({ kind, msg: msg.slice(0, 1000), at: new Date().toISOString() });
    if (_buf.length > MAX) _buf.shift();
  } catch { /* never block on logger */ }
}

let _booted = false;
export function bootErrorCapture() {
  if (_booted || typeof window === "undefined") return;
  _booted = true;
  try {
    const origErr = window.console?.error?.bind(window.console);
    if (origErr) {
      window.console.error = (...a) => { _push("console.error", a); origErr(...a); };
    }
    window.addEventListener("error", (e) => _push("window.error", [e.message, e.filename, `${e.lineno}:${e.colno}`]));
    window.addEventListener("unhandledrejection", (e) => _push("unhandledrejection", [e.reason]));
  } catch { /* private mode */ }
}

export function recentErrors() {
  return _buf.slice(-MAX);
}
