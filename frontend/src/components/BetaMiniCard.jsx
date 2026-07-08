/**
 * iter428c — Compact dark app-store card for the home-page hero.
 * ~50% the visual size of the full /app-testing device-split card.
 * Hidden until backend confirms beta_program.enabled, and can be dismissed
 * once per browser via the small X (localStorage: cm-beta-mini-dismissed).
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X, ArrowRight } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;
const KEY = "cm-beta-mini-dismissed";

export default function BetaMiniCard() {
  const [enabled, setEnabled] = useState(false);
  const [show, setShow] = useState(true);

  useEffect(() => {
    try { if (localStorage.getItem(KEY) === "1") setShow(false); } catch { /* noop */ }
    fetch(`${API}/api/beta-program/config`, { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.enabled) setEnabled(true);
      })
      .catch(() => {});
  }, []);

  const dismiss = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setShow(false);
    try { localStorage.setItem(KEY, "1"); } catch { /* noop */ }
  };

  if (!enabled || !show) return null;

  return (
    <div
      className="w-full max-w-[420px] bg-[#0a0a0a] border border-[#1a1a1a] p-3 relative shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
      data-testid="beta-mini-card"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss app-testing card"
        data-testid="beta-mini-close"
        className="absolute top-1.5 right-1.5 p-0.5 text-[#666] hover:text-white transition"
      >
        <X size={12} />
      </button>

      <div className="grid grid-cols-2 gap-0 divide-x divide-[#1f1f1f]">
        {/* Android side */}
        <div className="pr-3 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-full border border-[#3ddc84] flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 128 128" className="w-5 h-5" aria-hidden="true">
                <g fill="#3ddc84">
                  <path d="M27.9 51.2c-3 0-5.4 2.5-5.4 5.5v22.9c0 3 2.4 5.5 5.4 5.5 3 0 5.4-2.5 5.4-5.5V56.7c0-3-2.4-5.5-5.4-5.5zm72.2 0c-3 0-5.4 2.5-5.4 5.5v22.9c0 3 2.4 5.5 5.4 5.5 3 0 5.4-2.5 5.4-5.5V56.7c0-3-2.4-5.5-5.4-5.5z" />
                  <path d="M37.4 52v37.4c0 2.4 2 4.3 4.3 4.3h6.5v13.7c0 3 2.4 5.5 5.4 5.5s5.4-2.5 5.4-5.5V93.7h9v13.7c0 3 2.4 5.5 5.4 5.5s5.4-2.5 5.4-5.5V93.7h6.5c2.4 0 4.3-1.9 4.3-4.3V52H37.4z" />
                  <path d="M83.8 27.7l4.7-6.9c.5-.7.4-1.7-.3-2.2-.7-.5-1.7-.4-2.2.3l-5 7.3c-3.9-1.7-8.4-2.7-13-2.7s-9.1 1-13 2.7l-5-7.3c-.5-.7-1.5-.8-2.2-.3-.7.5-.8 1.5-.3 2.2l4.7 6.9c-8.9 4.7-14.9 13.4-14.9 23.4h60.9c0-10-6-18.7-14.4-23.4zM52.1 41.5c-1.5 0-2.8-1.2-2.8-2.8s1.2-2.8 2.8-2.8 2.8 1.2 2.8 2.8-1.2 2.8-2.8 2.8zm23.8 0c-1.5 0-2.8-1.2-2.8-2.8s1.2-2.8 2.8-2.8 2.8 1.2 2.8 2.8-1.3 2.8-2.8 2.8z" />
                </g>
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white font-bold leading-none">
                Android App Testing
              </div>
              <p className="text-[#a3a3a3] text-[10px] mt-1 leading-tight">
                Join our Android beta program on Google Play.
              </p>
            </div>
          </div>
          <Link
            to="/app-testing/android"
            className="mt-1 w-full border border-[#3ddc84] text-[#3ddc84] font-mono text-[9px] uppercase tracking-[0.2em] py-1.5 px-2 flex items-center justify-between hover:bg-[#3ddc84]/10 transition"
            data-testid="beta-mini-android"
          >
            <span>Sign up for Android</span>
            <ArrowRight size={10} />
          </Link>
        </div>

        {/* iOS side */}
        <div className="pl-3 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-full border border-white flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 384 512" className="w-4 h-4" aria-hidden="true" fill="white">
                <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white font-bold leading-none">
                iOS App Testing
              </div>
              <p className="text-[#a3a3a3] text-[10px] mt-1 leading-tight">
                Join our TestFlight beta program for iPhone and iPad.
              </p>
            </div>
          </div>
          <Link
            to="/app-testing/ios"
            className="mt-1 w-full border border-white text-white font-mono text-[9px] uppercase tracking-[0.2em] py-1.5 px-2 flex items-center justify-between hover:bg-white/10 transition"
            data-testid="beta-mini-ios"
          >
            <span>Sign up for iOS</span>
            <ArrowRight size={10} />
          </Link>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-[#1f1f1f] text-center">
        <p className="text-[#d4d4d4] text-[10px]">
          Spots are limited.{" "}
          <Link to="/app-testing" className="text-brand hover:underline">
            Sign up today
          </Link>
          {" "}and be part of the journey!
        </p>
      </div>
    </div>
  );
}
