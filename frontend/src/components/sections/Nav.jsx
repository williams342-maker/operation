import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ShoppingBag, User } from "lucide-react";
import { Link } from "react-router-dom";
import { useCart } from "../../lib/cart";
import { useSiteSettings } from "../../hooks/useSiteSettings";
import ActivityTicker from "./ActivityTicker";

const links = [
  { label: "Shop", href: "/shop", route: true },
  { label: "Makers", href: "/makers", route: true },
  { label: "Custom", href: "/custom-order", route: true },
  { label: "Community", href: "/community", route: true },
  { label: "Journal", href: "/journal", route: true },
  { label: "What's new", href: "/updates", route: true },
  { label: "Contact", href: "/contact", route: true },
];

// Pull whichever JWT is present so we can switch the nav to "My account"
// when the user is signed in. Reads on every render — cheap, runs in browser.
function readSignedInRole() {
  if (typeof window === "undefined") return null;
  if (localStorage.getItem("cm_admin_jwt")) return "admin";
  if (localStorage.getItem("cm_maker_jwt")) return "maker";
  if (localStorage.getItem("cm_buyer_jwt")) return "buyer";
  return null;
}

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [signedInRole, setSignedInRole] = useState(readSignedInRole);
  const { count } = useCart() || { count: 0 };
  // Admin-toggleable Founding Seller Beta signup switch. Default to TRUE
  // so we don't flash-hide the button on first paint while settings fetch;
  // the 60s polling will flip it off as soon as admin disables it.
  const siteSettings = useSiteSettings();
  const betaSignupEnabled = siteSettings?.beta_signup_enabled !== false;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll);
    // Listen for storage changes (sign-in / sign-out from another tab)
    const onStorage = () => setSignedInRole(readSignedInRole());
    window.addEventListener("storage", onStorage);
    // Also re-check on focus — covers same-tab login flow
    const onFocus = () => setSignedInRole(readSignedInRole());
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const accountHref = signedInRole === "admin" ? "/admin/dashboard"
    : signedInRole === "maker" ? "/maker/dashboard"
    : signedInRole === "buyer" ? "/community/me"
    : "/signin";

  return (
    <motion.header
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
      style={{ top: "var(--beta-banner-h, 0px)" }}
      className={`fixed left-0 right-0 z-50 transition-colors duration-500 ${
        scrolled ? "bg-black/85 backdrop-blur-xl border-b border-[#262626]" : "bg-black/40 backdrop-blur-sm"
      }`}
      data-testid="site-nav"
    >
      <ActivityTicker />
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 flex items-center justify-between py-4">
        <Link to="/" className="flex items-center gap-3 group" data-testid="nav-logo">
          <div className="w-9 h-9 border border-[#ff4500] flex items-center justify-center">
            <span className="font-display text-[#ff4500] text-xl">CM</span>
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="font-display text-lg tracking-wide">Crafters Market</span>
            <span className="font-mono text-[10px] text-[#a3a3a3] tracking-[0.25em] uppercase mt-1">
              EST · 2026 · Precision Craft
            </span>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center gap-10" data-testid="nav-links">
          {links.map((l) => (
            <Link
              key={l.href}
              to={l.href}
              className="industrial-link font-mono text-xs uppercase tracking-[0.22em] text-[#e5e5e5] hover:text-[#ff4500]"
              data-testid={`nav-link-${l.label.toLowerCase().replace(/\s/g, "-")}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {/* Founding Seller Beta CTA — bold, always visible at top of screen.
              Sits ahead of Sign in / Cart so it reads as the primary action
              while we're actively recruiting the first 100 sellers. Admin
              can hide the whole pill via Settings → Founding Seller Beta
              Signup toggle. */}
          {betaSignupEnabled && (
            <>
              <Link
                to="/beta"
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-[#ff4500] hover:bg-[#ff5722] text-black border border-[#ff4500] font-mono text-[11px] font-bold uppercase tracking-[0.22em] transition shadow-[0_0_0_2px_rgba(255,69,0,0.15)]"
                data-testid="nav-beta-signup-btn"
              >
                ◆ Beta Signup
              </Link>
              {/* Mobile variant — compact, same destination */}
              <Link
                to="/beta"
                className="sm:hidden inline-flex items-center px-3 py-2 bg-[#ff4500] hover:bg-[#ff5722] text-black border border-[#ff4500] font-mono text-[10px] font-bold uppercase tracking-[0.2em] transition"
                data-testid="nav-beta-signup-btn-mobile"
              >
                Beta
              </Link>
            </>
          )}
          {/* Founding Member Login pill intentionally removed from the
              top Nav in iter61 — the maker/login page is now the single
              sign-in entry point (which welcomes both regular makers AND
              Founding Sellers). Keeping one CTA reduces cognitive load
              and funnel leakage. */}
          {/* Sign-in button — placed next to Cart so a returning user can
              authenticate from anywhere on the site. Switches to "Account"
              when signed in (any role). */}
          <Link
            to={accountHref}
            className="hidden sm:inline-flex relative items-center gap-2 px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
            data-testid="nav-signin-btn"
          >
            <User size={14} /> {signedInRole ? "Account" : "Sign in"}
          </Link>
          <Link
            to="/cart"
            className="relative inline-flex items-center gap-2 px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
            data-testid="nav-cart-btn"
          >
            <ShoppingBag size={14} /> Cart
            {count > 0 && (
              <span className="ml-1 bg-[#ff4500] text-white text-[10px] font-mono px-1.5 py-0.5">
                {count}
              </span>
            )}
          </Link>
          <button
            onClick={() => setOpen(true)}
            className="lg:hidden p-2 border border-[#262626] hover:border-[#ff4500] transition"
            aria-label="Open menu"
            data-testid="nav-mobile-open"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black"
            data-testid="mobile-menu"
          >
            <div className="flex justify-between items-center px-6 py-5 border-b border-[#262626]">
              <span className="font-display text-2xl">Crafters Market</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" data-testid="nav-mobile-close">
                <X size={24} />
              </button>
            </div>
            <ul className="flex flex-col p-8 gap-6">
              {/* Sign in / Account — first item, always visible. Mobile users
                  were getting stranded looking for this in the hamburger
                  (it was only in the top-bar cluster which got squeezed off
                  small screens). Putting it at the top of the drawer
                  removes that dead-end completely. */}
              <motion.li
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0 }}
              >
                <Link
                  to={accountHref}
                  onClick={() => setOpen(false)}
                  className="font-display text-5xl block hover:text-[#ff4500] transition flex items-center gap-3"
                  data-testid="mobile-nav-signin"
                >
                  <User size={28} className="text-[#ff4500]" />
                  {signedInRole ? "Account" : "Sign in"}
                </Link>
              </motion.li>
              {betaSignupEnabled && (
                <motion.li
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 }}
                >
                  <Link
                    to="/beta"
                    onClick={() => setOpen(false)}
                    className="font-display text-5xl block text-[#ff4500] hover:brightness-110 transition"
                    data-testid="mobile-nav-beta-signup"
                  >
                    ◆ Beta Signup
                  </Link>
                </motion.li>
              )}
              {links.map((l, i) => (
                <motion.li
                  key={l.href}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: (i + 2) * 0.05 }}
                >
                  <Link
                    to={l.href}
                    onClick={() => setOpen(false)}
                    className="font-display text-5xl block hover:text-[#ff4500] transition"
                    data-testid={`mobile-nav-link-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    {l.label}
                  </Link>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
