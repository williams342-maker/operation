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
    <div
      data-testid="pwa-install-banner"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 border border-[#ff4500] bg-[#0a0a0a] shadow-[0_8px_24px_rgba(0,0,0,0.6)] px-4 py-3 max-w-[92vw]"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
        ◆ Install
      </span>
      <span className="font-mono text-xs text-[#e5e5e5] hidden sm:inline">
        Add Crafters Market to your home screen — full-screen, push notifications, faster load.
      </span>
      <span className="font-mono text-xs text-[#e5e5e5] sm:hidden">
        Add to home screen
      </span>
      <button
        type="button"
        onClick={handleInstall}
        data-testid="pwa-install-btn"
        className="px-3 py-1.5 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500] hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] transition"
      >
        Install →
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        data-testid="pwa-install-dismiss"
        aria-label="Dismiss install prompt"
        className="font-mono text-[14px] text-[#525252] hover:text-[#e5e5e5] px-2 leading-none"
      >
        ×
      </button>
    </div>
  );
}
