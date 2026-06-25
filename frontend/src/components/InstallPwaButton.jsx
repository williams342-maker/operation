import React, { useEffect, useState } from "react";

// Floating "Install app" prompt for Android/Chrome/Edge.
// Listens for the `beforeinstallprompt` event, surfaces a small CTA,
// and auto-hides on iOS (Safari uses the share-sheet "Add to Home Screen"
// flow which the browser doesn't expose programmatically).
const DISMISS_KEY = "cm_pwa_install_dismissed_at";
const DISMISS_DAYS = 14;

function recentlyDismissed() {
  try {
    const ts = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10);
    if (!ts) return false;
    return Date.now() - ts < DISMISS_DAYS * 86400 * 1000;
  } catch {
    return false;
  }
}

export default function InstallPwaButton() {
  const [deferredEvent, setDeferredEvent] = useState(null);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Already running standalone — never show.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }
    if (recentlyDismissed()) return;

    const onBefore = (e) => {
      e.preventDefault();
      setDeferredEvent(e);
      setVisible(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setDeferredEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !visible || !deferredEvent) return null;

  const handleInstall = async () => {
    try {
      deferredEvent.prompt();
      const choice = await deferredEvent.userChoice;
      if (choice?.outcome !== "accepted") {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
      }
    } catch {
      /* user cancelled — fine */
    } finally {
      setVisible(false);
      setDeferredEvent(null);
    }
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setVisible(false);
  };

  return (
    // iter413ch — Compact pill (was a centered strip taking ~70px height
    // with long copy). New form: ~32px high, bottom-right corner, short
    // "Install app" label only. Full functionality preserved (Install /
    // Dismiss with 14-day suppress).
    <div
      data-testid="pwa-install-banner"
      className="fixed bottom-3 right-3 z-[60] flex items-center gap-1.5 border border-brand bg-paper shadow-[0_4px_16px_rgba(0,0,0,0.4)] px-2 py-1"
    >
      <span aria-hidden="true" className="text-[12px] leading-none">📲</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink hidden sm:inline">
        Install app
      </span>
      <button
        type="button"
        onClick={handleInstall}
        data-testid="pwa-install-btn"
        className="px-2 py-0.5 border border-brand text-brand hover:bg-brand hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.18em] transition"
      >
        Install
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        data-testid="pwa-install-dismiss"
        aria-label="Dismiss install prompt"
        className="font-mono text-[12px] text-ink-muted hover:text-ink px-1 leading-none"
      >
        ×
      </button>
    </div>
  );
}
