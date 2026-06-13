import React from "react";
import { Link, useLocation } from "react-router-dom";

/**
 * iter413o — Mobile-only persistent CTA bar.
 *
 * Eliminates the #1 mobile UX failure on marketplace homepages: the
 * primary CTA scrolls out of view and never comes back. A 56px-tall
 * bar pinned to the bottom of the viewport keeps both audiences'
 * next-best-actions one tap away from every scroll position.
 *
 *   ┌──────────────────────┬──────────────────────┐
 *   │   SELL HERE →        │   SHOP NOW →         │
 *   │   (vendor-focused)   │   (buyer-focused)    │
 *   └──────────────────────┴──────────────────────┘
 *
 * Hidden on routes where it would compete with the user's primary
 * task (checkout flow, cart, signed-in dashboards). Never renders on
 * desktop (md+) regardless of route.
 *
 * The +56px reserved space at the bottom of the page is handled in
 * App.js via a global `pb-14 md:pb-0` on the outer wrapper so the
 * bar never covers footer content.
 */

// Routes where the persistent CTA bar competes with the user's primary
// task and so must NOT render. Match by `startsWith`. We deliberately
// keep most discovery surfaces (shop, search, blog, guides, makers,
// landing pages) WITH the bar — that's where conversion happens.
const HIDE_ON_PREFIXES = [
  "/admin",
  "/maker/dashboard",
  "/maker/listings",   // listing editor full-screen flow
  "/maker/billing",    // Stripe redirect bounce
  "/maker/login",      // bar would distract from sign-in
  "/maker/verify",
  "/cart",
  "/checkout",
  "/community/auth",   // community OAuth bounce
];

function shouldHideOnRoute(pathname) {
  for (const prefix of HIDE_ON_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

export default function MobileStickyCTA() {
  const { pathname } = useLocation();
  if (shouldHideOnRoute(pathname)) return null;

  return (
    <nav
      aria-label="Quick actions"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-2 border-t border-line bg-paper/95 backdrop-blur-md"
      data-testid="mobile-sticky-cta"
      // `pb-[env(safe-area-inset-bottom)]` keeps the bar above the
      // iOS home-indicator on notched devices.
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <Link
        to="/apply"
        className="flex items-center justify-center gap-1.5 py-3.5 font-mono text-[11px] uppercase tracking-[0.22em] text-ink border-r border-line hover:bg-surface active:bg-surface transition"
        data-testid="mobile-sticky-cta-sell"
      >
        Sell Here
        <span aria-hidden className="text-brand">→</span>
      </Link>
      <Link
        to="/shop"
        className="flex items-center justify-center gap-1.5 py-3.5 font-mono text-[11px] uppercase tracking-[0.22em] bg-brand text-paper hover:bg-brand-hover active:bg-brand-hover transition"
        data-testid="mobile-sticky-cta-shop"
      >
        Shop Now
        <span aria-hidden>→</span>
      </Link>
    </nav>
  );
}
