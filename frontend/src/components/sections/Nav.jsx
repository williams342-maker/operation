import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ShoppingBag, User, ChevronDown, MessageSquare, Camera, ArrowUpRight, Shield, Hammer, ShoppingBasket, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { useCart } from "../../lib/cart";
import { http } from "../../lib/api";
import ActivityTicker from "./ActivityTicker";

// Primary nav — 5 items only. Secondary/tertiary surfaces live under the
// Community dropdown or in the footer. Keeps the bar one-line at >=1100px
// and stops the cyan "Where we're going" link from wrapping at /grow.
const primaryLinks = [
  { label: "Shop", href: "/shop" },
  { label: "Makers", href: "/makers" },
  { label: "Custom", href: "/custom-order" },
  { label: "Studio", href: "/studio", accent: "cyan" },
];

// Lives inside the Community dropdown — these used to be top-level
// nav entries but all share the same "browse content / hang out"
// intent. Surfacing them under one parent is cleaner + reflects user
// behaviour (commerce links go to Shop, content links go here).
const communityMenu = [
  { label: "Forum",    href: "/community?tab=forum",    blurb: "Threads · Q&A · help" },
  { label: "Clips",    href: "/clips",                  blurb: "Short workshop videos" },
  { label: "Journal",  href: "/journal",                blurb: "Long-form articles" },
  { label: "Showcase", href: "/community?tab=showcase", blurb: "Buyer + maker photos" },
  { label: "Design kits", href: "/kits",                blurb: "Free SVG + DXF bundles" },
];

// Tertiary surfaces — kept out of the desktop bar but still reachable
// from the mobile drawer + footer. "What's New" and "Contact" both
// live in the footer in their own columns now.
const tertiaryLinks = [
  { label: "What's new", href: "/updates" },
  { label: "Contact",    href: "/contact" },
];

// Pull whichever JWT is present so we can switch the nav to "My account"
// when the user is signed in. Reads on every render — cheap, runs in browser.
function readSignedInRoles() {
  if (typeof window === "undefined") return [];
  const out = [];
  if (localStorage.getItem("cm_admin_jwt")) out.push("admin");
  if (localStorage.getItem("cm_maker_jwt")) out.push("maker");
  if (localStorage.getItem("cm_buyer_jwt")) out.push("buyer");
  return out;
}
function readSignedInRole() {
  return readSignedInRoles()[0] || null;
}

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [signedInRole, setSignedInRole] = useState(readSignedInRole);
  const [signedInRoles, setSignedInRoles] = useState(readSignedInRoles);
  const { count } = useCart() || { count: 0 };
  // useSiteSettings used to gate the now-removed beta pill — removed in
  // iter153 along with the pill itself. The bottom-of-home <BetaSignupCTA />
  // owns its own settings fetch, so we don't import the hook here anymore.

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll);
    // Listen for storage changes (sign-in / sign-out from another tab)
    const onStorage = () => {
      setSignedInRole(readSignedInRole());
      setSignedInRoles(readSignedInRoles());
    };
    window.addEventListener("storage", onStorage);
    // Also re-check on focus — covers same-tab login flow
    const onFocus = () => {
      setSignedInRole(readSignedInRole());
      setSignedInRoles(readSignedInRoles());
    };
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

        <DesktopNav signedInRole={signedInRole} />

        <div className="flex items-center gap-3">
          {/* Founding Seller Beta CTA moved out of the top Nav (iter153)
              — see <BetaSignupCTA /> at the bottom of the home page.
              Keeping the global header lean reduces visual noise so
              admins on a small laptop can fit everything on one row
              without the orange pill jumping the layout. */}
          {/* Founding Member Login pill intentionally removed from the
              top Nav in iter61 — the maker/login page is now the single
              sign-in entry point (which welcomes both regular makers AND
              Founding Sellers). Keeping one CTA reduces cognitive load
              and funnel leakage. */}
          {/* Sign-in button / role switcher — placed next to Cart so a
              returning user can authenticate or jump roles from anywhere
              on the site. When signed into multiple roles, becomes a
              dropdown listing each available context. */}
          {signedInRoles.length > 1 ? (
            <RoleSwitcher
              roles={signedInRoles}
              activeRole={signedInRole}
              onSignOutAll={() => {
                localStorage.removeItem("cm_admin_jwt");
                localStorage.removeItem("cm_maker_jwt");
                localStorage.removeItem("cm_maker_jwt_exp");
                localStorage.removeItem("cm_buyer_jwt");
                setSignedInRole(null);
                setSignedInRoles([]);
                window.location.href = "/";
              }}
            />
          ) : (
            <Link
              to={accountHref}
              className="hidden sm:inline-flex relative items-center gap-2 px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
              data-testid="nav-signin-btn"
            >
              <User size={14} /> {signedInRole ? "Account" : "Sign in"}
            </Link>
          )}
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

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black flex flex-col"
              data-testid="mobile-menu"
            >
            <div className="flex justify-between items-center px-6 py-5 border-b border-[#262626] shrink-0">
              <span className="font-display text-2xl">Crafters Market</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" data-testid="nav-mobile-close">
                <X size={24} />
              </button>
            </div>
            <ul className="flex flex-col p-8 gap-6 overflow-y-auto flex-1">
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
                  className="font-display text-3xl sm:text-4xl block hover:text-[#ff4500] transition flex items-center gap-3"
                  data-testid="mobile-nav-signin"
                >
                  <User size={22} className="text-[#ff4500]" />
                  {signedInRole ? "Account" : "Sign in"}
                </Link>
              </motion.li>
              {/* Primary mobile nav — single flat list including the
                  community dropdown items, the grow highlight, and
                  the tertiary surfaces. Mobile users get everything in
                  one tap-friendly column. */}
              {[
                ...primaryLinks,
                { label: "Forum",    href: "/community?tab=forum" },
                { label: "Clips",    href: "/clips" },
                { label: "Journal",  href: "/journal" },
                { label: "Showcase", href: "/community?tab=showcase" },
                { label: "Design kits", href: "/kits" },
                { label: "Where we're going", href: "/grow", highlight: true },
                ...tertiaryLinks,
              ].map((l, i) => (
                <motion.li
                  key={l.href + l.label}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: (i + 2) * 0.05 }}
                >
                  <Link
                    to={l.href}
                    onClick={() => setOpen(false)}
                    className={`font-display text-3xl sm:text-4xl block transition ${
                      l.highlight ? "text-[#00ffff] hover:text-[#ff4500]" : "hover:text-[#ff4500]"
                    }`}
                    data-testid={`mobile-nav-link-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    {l.highlight ? "◆ " : ""}{l.label}
                  </Link>
                </motion.li>
              ))}
            </ul>
          </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </motion.header>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Desktop nav — 5 visible items + Community dropdown + ◆ Grow highlight.
// Replaces the old flat 9-link bar that wrapped multi-line at /grow.
// Hover-to-open dropdown (with a small open delay on leave so users
// can travel cursor → menu without it slamming shut).
// ─────────────────────────────────────────────────────────────────────
function DesktopNav() {
  const [openMenu, setOpenMenu] = useState(false);
  const closeTimerRef = useRef(null);

  const handleOpen = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setOpenMenu(true);
  };
  const handleClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpenMenu(false), 120);
  };

  return (
    <nav className="hidden lg:flex items-center gap-9 xl:gap-10" data-testid="nav-links">
      {primaryLinks.map((l) => (
        <Link
          key={l.href}
          to={l.href}
          className={`industrial-link font-mono text-xs uppercase tracking-[0.22em] hover:text-[#ff4500] inline-flex items-center gap-1.5 ${
            l.accent === "cyan" ? "text-[#00ffff]" : "text-[#e5e5e5]"
          }`}
          data-testid={`nav-link-${l.label.toLowerCase().replace(/\s/g, "-")}`}
        >
          {l.label}
          {l.accent === "cyan" && (
            <span className="text-[8px] border border-[#00ffff]/60 px-1 py-[1px] leading-none tracking-[0.18em]" aria-label="AI">
              AI
            </span>
          )}
        </Link>
      ))}

      {/* Community ▾ — replaces the standalone Community / Clips /
          Journal / Forum / Showcase links. Click goes to the community
          hub; hover reveals the sub-surfaces with one-line blurbs. */}
      <div
        className="relative"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        data-testid="nav-community-group"
      >
        <Link
          to="/community"
          className="industrial-link font-mono text-xs uppercase tracking-[0.22em] text-[#e5e5e5] hover:text-[#ff4500] inline-flex items-center gap-1"
          data-testid="nav-link-community"
          onFocus={handleOpen}
        >
          Community
          <ChevronDown size={12} className={`transition-transform ${openMenu ? "rotate-180" : ""}`} aria-hidden="true" />
        </Link>

        <AnimatePresence>
          {openMenu && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
              className="absolute left-1/2 -translate-x-1/2 top-full mt-3 w-[680px] bg-[#0a0a0a] border border-[#262626] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.8)] z-50"
              role="menu"
              data-testid="nav-community-menu"
            >
              {/* Decorative chevron pointing back at the trigger */}
              <div
                aria-hidden="true"
                className="absolute -top-[5px] left-1/2 -translate-x-1/2 w-2 h-2 bg-[#0a0a0a] border-l border-t border-[#262626] rotate-45"
              />
              <div className="grid grid-cols-2 divide-x divide-[#262626]">
                {/* LEFT — navigation links */}
                <div className="p-3">
                  <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-[#737373] px-3 pt-1 pb-2">
                    ◆ Browse
                  </div>
                  <ul>
                    {communityMenu.map((item) => (
                      <li key={item.href}>
                        <Link
                          to={item.href}
                          className="block px-3 py-2.5 hover:bg-[#171717] transition group"
                          data-testid={`nav-community-${item.label.toLowerCase()}`}
                        >
                          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#e5e5e5] group-hover:text-[#ff4500] flex items-center gap-2">
                            {item.label}
                            <ArrowUpRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <div className="font-mono text-[10px] text-[#737373] mt-0.5">
                            {item.blurb}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* RIGHT — live "what's hot" cards */}
                <div className="p-3">
                  <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-[#737373] px-3 pt-1 pb-2">
                    ◆ What&apos;s hot
                  </div>
                  <MegaMenuHotPreview />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ◆ Grow highlight — cyan accent. Stays visible on lg+, abbreviated
          to a pill on smaller screens via the responsive `xl:` reveal. */}
      <Link
        to="/grow"
        className="industrial-link font-mono text-xs uppercase tracking-[0.22em] text-[#00ffff] hover:text-[#ff4500] inline-flex items-center gap-1.5 whitespace-nowrap"
        data-testid="nav-link-where-we're-going"
        title="Where we're going · public roadmap"
      >
        <span aria-hidden="true">◆</span>
        <span className="hidden xl:inline">Where we&apos;re going</span>
        <span className="xl:hidden">Roadmap</span>
      </Link>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MegaMenuHotPreview — right column of the Community dropdown.
// Fetches top 3 trending forum threads + top 3 recent showcase posts,
// then auto-rotates each card slot every 5 seconds (paused on hover).
// Tiny dot progress indicator at the bottom shows rotation position.
// Both fetches fail-silent so the menu always renders even if backend
// is down.
// ─────────────────────────────────────────────────────────────────────
function MegaMenuHotPreview() {
  const [threads, setThreads] = useState([]);
  const [showcases, setShowcases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      http.get("/community/forum/trending", { params: { days: 30, limit: 3 } }).then((r) => r.data),
      http.get("/community/showcase/recent", { params: { limit: 3 } }).then((r) => r.data),
    ]).then((results) => {
      if (!alive) return;
      if (results[0].status === "fulfilled") setThreads(results[0].value?.threads || []);
      if (results[1].status === "fulfilled") setShowcases(results[1].value?.items || []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  // Slots auto-rotate together so the panel reads as one cycling billboard.
  // Step = max(threads.length, showcases.length, 1) — caps the rotation
  // to the longest list so we never show an undefined slot.
  const cycleLen = Math.max(threads.length, showcases.length, 1);
  useEffect(() => {
    if (loading || paused || cycleLen <= 1) return;
    const timer = setInterval(() => {
      setIdx((i) => (i + 1) % cycleLen);
    }, 5000);
    return () => clearInterval(timer);
  }, [loading, paused, cycleLen]);

  const thread = threads.length ? threads[idx % threads.length] : null;
  const showcase = showcases.length ? showcases[idx % showcases.length] : null;

  if (loading) {
    return (
      <div className="space-y-2 px-3 py-2">
        <div className="h-16 bg-[#171717] animate-pulse" />
        <div className="h-16 bg-[#171717] animate-pulse" />
      </div>
    );
  }

  return (
    <div
      className="space-y-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-testid="megamenu-hot-wrapper"
    >
      {/* Hot forum thread — fades on rotation */}
      <AnimatePresence mode="wait">
        {thread ? (
          <motion.div
            key={`thread-${thread.id}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <Link
              to={`/community?tab=forum&open=${thread.id}`}
              className="block p-3 hover:bg-[#171717] transition group border border-transparent hover:border-[#262626]"
              data-testid="megamenu-hot-thread"
            >
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare size={12} className="text-[#ff4500]" aria-hidden="true" />
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#ff4500]">
                  Forum · {thread.reply_count} repl{thread.reply_count === 1 ? "y" : "ies"}
                </span>
              </div>
              <div className="font-mono text-[11px] text-[#e5e5e5] group-hover:text-white leading-snug line-clamp-2">
                {thread.title}
              </div>
              <div className="font-mono text-[9px] text-[#737373] mt-1 uppercase tracking-[0.18em]">
                {thread.category || "general"}
              </div>
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Showcase card — fades on rotation */}
      <AnimatePresence mode="wait">
        {showcase ? (
          <motion.div
            key={`showcase-${showcase.id}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <Link
              to={`/community?tab=showcase&open=${showcase.id}`}
              className="flex gap-3 p-3 hover:bg-[#171717] transition group border border-transparent hover:border-[#262626]"
              data-testid="megamenu-hot-showcase"
            >
              {showcase.image_url ? (
                <div className="w-14 h-14 shrink-0 overflow-hidden border border-[#262626] bg-[#0a0a0a]">
                  <img
                    src={showcase.image_url}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                </div>
              ) : (
                <div className="w-14 h-14 shrink-0 border border-[#262626] bg-[#171717] flex items-center justify-center">
                  <Camera size={16} className="text-[#525252]" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Camera size={12} className="text-[#00ffff]" aria-hidden="true" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#00ffff]">
                    Showcase
                  </span>
                </div>
                <div className="font-mono text-[11px] text-[#e5e5e5] group-hover:text-white leading-snug line-clamp-2">
                  {showcase.title || "Untitled post"}
                </div>
                <div className="font-mono text-[9px] text-[#737373] mt-1 uppercase tracking-[0.18em] truncate">
                  {showcase.maker_slug ? `by ${showcase.maker_slug}` : (showcase.user_name || "Member")}
                </div>
              </div>
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Rotation indicator — only shown when there are multiple items to
          cycle through. Tiny dots, click to jump to that slot. */}
      {cycleLen > 1 && (
        <div className="flex items-center justify-center gap-1.5 pt-1" data-testid="megamenu-hot-dots">
          {Array.from({ length: cycleLen }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show preview ${i + 1} of ${cycleLen}`}
              onClick={() => setIdx(i)}
              className={`h-1 transition-all duration-300 ${
                i === idx ? "w-5 bg-[#ff4500]" : "w-2 bg-[#262626] hover:bg-[#525252]"
              }`}
              data-testid={`megamenu-hot-dot-${i}`}
            />
          ))}
        </div>
      )}

      {!thread && !showcase && (
        <div className="px-3 py-4 font-mono text-[10px] text-[#525252] italic">
          Community starts here. Check back soon.
        </div>
      )}
    </div>
  );
}


// iter247 — Role switcher dropdown. Appears in place of the "Account"
// link when the user holds JWTs for multiple roles (after the williams
// merge, this is the common case for the founder account). Lets you
// jump between admin/maker/buyer dashboards without re-logging-in.
const ROLE_META = {
  admin:  { label: "Admin",     href: "/admin/dashboard",  icon: Shield,         accent: "#ff4500" },
  maker:  { label: "Maker",     href: "/maker/dashboard",  icon: Hammer,         accent: "#00ffff" },
  buyer:  { label: "Shopper",   href: "/community/me",     icon: ShoppingBasket, accent: "#a3a3a3" },
};

function RoleSwitcher({ roles, activeRole, onSignOutAll }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = ROLE_META[activeRole] || ROLE_META.buyer;
  const ActiveIcon = active.icon;

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="hidden sm:inline-block relative" data-testid="nav-role-switcher">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
        data-testid="nav-role-switcher-btn"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <ActiveIcon size={14} style={{ color: active.accent }} />
        <span>{active.label}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] min-w-[220px] bg-black border border-[#262626] shadow-xl z-50"
          role="menu"
          data-testid="nav-role-switcher-menu"
        >
          <div className="px-3 py-2 border-b border-[#262626] font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">
            Switch role
          </div>
          {roles.map((r) => {
            const meta = ROLE_META[r];
            if (!meta) return null;
            const Icon = meta.icon;
            const isActive = r === activeRole;
            return (
              <Link
                key={r}
                to={meta.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] hover:bg-[#0d0d0d] transition ${
                  isActive ? "bg-[#0a0a0a] text-white" : "text-[#a3a3a3]"
                }`}
                role="menuitem"
                data-testid={`nav-role-switcher-${r}`}
              >
                <Icon size={13} style={{ color: meta.accent }} />
                <span className="flex-1">{meta.label}</span>
                {isActive && (
                  <span className="font-mono text-[8px] tracking-[0.18em] text-[#525252]">◆ now</span>
                )}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={onSignOutAll}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 border-t border-[#262626] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] hover:bg-[#0d0d0d] transition"
            data-testid="nav-role-switcher-signout"
          >
            <LogOut size={12} /> Sign out of all
          </button>
        </div>
      )}
    </div>
  );
}

