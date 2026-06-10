import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  fetchMakerMe, fetchMakerOrders, fetchMakerProducts, fetchMakerThreads,
  fetchMakerBackorderRequests, updateMakerProfile,
} from "../lib/api";

import ShopManagerLayout from "./MakerDashboard/ShopManagerLayout";
import DashboardTab from "./MakerDashboard/DashboardTab";
import SettingsTab from "./MakerDashboard/SettingsTab";
import ProductsList from "./MakerDashboard/ProductsList";
import RenewalsTab from "./MakerDashboard/RenewalsTab";
import OrdersList from "./MakerDashboard/OrdersList";
import BackordersList from "./MakerDashboard/BackordersList";
import StatsTab from "./MakerDashboard/StatsTab";
import ViolationsTab from "./MakerDashboard/ViolationsTab";
import MarketingTab from "./MakerDashboard/MarketingTab";
import PromoteTab from "./MakerDashboard/PromoteTab";
import FinancialsTab from "./MakerDashboard/FinancialsTab";
import HelpTab from "./MakerDashboard/HelpTab";
import MessagesTab from "./MakerDashboard/MessagesTab";
import BriefsTab from "./MakerDashboard/BriefsTab";
import ReviewsTab from "./MakerDashboard/ReviewsTab";
import ProfileForm from "./MakerDashboard/ProfileForm";
import useModalA11y from "../hooks/useModalA11y";

// Legacy `#upgrade` URLs (the old top-level Upgrade tab) now route to the
// Subscription section inside Settings — keeps any bookmarked links working.
function normalizeTab(id) {
  if (id === "upgrade") return "settings";
  // iter356 — deep-link `?tab=seo` lands inside the Marketing tab's
  // SEO Health section. We rewrite the id here so the rest of the
  // routing treats it as `marketing`.
  if (id === "seo") return "marketing";
  return id;
}

// Valid top-level tab ids. Used to guard against `?tab=<anything>` junk
// (e.g. rewriter-mangled links) — unknown ids fall back to "dashboard".
const KNOWN_TABS = new Set([
  "dashboard", "listings", "renewals", "orders", "messages", "briefs", "reviews", "stats",
  "violations", "marketing", "promote", "financials", "help", "settings",
]);

/**
 * Resolve the initial tab from the URL, supporting BOTH deep-link patterns:
 *   • `#orders`           — original hash fragment (keeps back-button working)
 *   • `?tab=orders`       — query param (email link-rewriters often strip
 *                          fragments so this is the safer pattern in
 *                          transactional emails)
 *   • `?tab=orders#orders`— both present, query param wins
 * When a `?tab=` query param is present, we also rewrite the URL to put
 * it in the hash so the existing `hashchange` listener stays authoritative
 * for subsequent nav within the page.
 */
function resolveInitialTabFromUrl() {
  try {
    const sp = new URLSearchParams(window.location.search);
    const q = (sp.get("tab") || "").trim().toLowerCase();
    if (q) {
      const id = normalizeTab(q);
      const valid = KNOWN_TABS.has(id);
      // iter356 — `?tab=seo` is sugar for the Marketing tab's SEO
      // section. Fire the section event after mount completes so
      // MarketingTab can pre-select its inner sub-nav.
      if (q === "seo") {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("cm:open-marketing-section", {
            detail: { section: "seo" },
          }));
        }, 0);
      }
      // Always strip the `tab` param — whether valid (rewritten to hash)
      // or invalid (dropped entirely) — so we don't keep junk params in
      // the URL bar after the user shared a mangled link.
      sp.delete("tab");
      const qs = sp.toString();
      const newUrl = `${window.location.pathname}${qs ? "?" + qs : ""}${valid ? "#" + id : ""}`;
      window.history.replaceState(null, "", newUrl);
      if (valid) return id;
    }
  } catch {
    // URLSearchParams throws in ancient browsers — fall through.
  }
  return normalizeTab((window.location.hash || "#dashboard").replace("#", ""));
}

/**
 * MakerDashboard 2.0 — Etsy-inspired Shop Manager layout.
 * Top bar (status badges + Edit Shop + Sign Out) → left sidebar nav →
 * tabbed content. Brand-aligned (industrial dark + orange).
 *
 * URL hash drives the active tab so deep-links and back-button work:
 * /maker/dashboard#stats, /maker/dashboard#financials, etc.
 */
export default function MakerDashboard() {
  const navigate = useNavigate();
  const [maker, setMaker] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [threads, setThreads] = useState([]);
  // Pending backorder requests count — surfaced as a 5th KPI tile on the
  // Dashboard tab so makers see incoming requests at a glance instead
  // of having to drill into Orders → Backorders. Lazy-fetched and
  // refreshed alongside the rest of the dashboard data.
  const [pendingBackorders, setPendingBackorders] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  // Tracks which KPI tiles incremented on the last poll so the Dashboard
  // can pulse them. `freshKey` bumps on every increment so the pulse
  // animation re-fires even if the same KPI keeps gaining (e.g. 2 → 3 → 4).
  const [fresh, setFresh] = useState({ orders: false, messages: false, products: false });
  const [freshKey, setFreshKey] = useState(0);

  const [tab, setTab] = useState(() => resolveInitialTabFromUrl());
  useEffect(() => {
    const onHash = () => setTab(normalizeTab((window.location.hash || "#dashboard").replace("#", "")));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const changeTab = (id) => { window.location.hash = id; setTab(id); };

  // iter274 — When the user is already on /maker/dashboard and clicks
  // a <Link to="/maker/dashboard?tab=settings&section=clips"> from
  // inside the dashboard, React Router navigates within the same
  // component without remounting it. Without this effect, `tab` state
  // stays stale → "nothing happens" UX bug on the dashboard's CLAIM SLOT
  // card. We re-run the tab resolver whenever `location.search` changes.
  // Reuses the existing `cm:open-settings` event so `?section=` deep-
  // links the right sub-section (clips / videos / subscription / etc).
  const location = useLocation();
  useEffect(() => {
    if (!location.search) return;
    const sp = new URLSearchParams(location.search);
    const tabParam = (sp.get("tab") || "").trim().toLowerCase();
    const sectionParam = (sp.get("section") || "").trim().toLowerCase();
    if (tabParam === "settings" && sectionParam) {
      // Use the existing event so SettingsTab's `initialSection` prop
      // gets pre-populated with the requested sub-section.
      window.dispatchEvent(new CustomEvent("cm:open-settings", {
        detail: { section: sectionParam },
      }));
    } else if (tabParam === "seo") {
      // iter356 — `?tab=seo` is sugar for the Marketing tab's SEO Health
      // section. Switch to Marketing, then signal the sub-section after
      // the tab has had a tick to mount.
      changeTab("marketing");
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("cm:open-marketing-section", {
          detail: { section: "seo" },
        }));
      }, 0);
    } else if (tabParam === "marketing" && sectionParam) {
      changeTab("marketing");
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("cm:open-marketing-section", {
          detail: { section: sectionParam },
        }));
      }, 0);
    } else if (tabParam && KNOWN_TABS.has(tabParam)) {
      changeTab(tabParam);  // also rewrites the hash via window.location
    }
    // Strip the query params after handling so subsequent in-tab nav
    // doesn't re-fire this effect on every render.
    if (tabParam || sectionParam) {
      sp.delete("tab"); sp.delete("section");
      const qs = sp.toString();
      window.history.replaceState(
        null, "",
        `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash || ""}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Reset scroll to top whenever the active tab changes — otherwise
  // switching from a long Dashboard scroll into Listings/Orders keeps
  // the previous scroll offset and lands buyers mid-page.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [tab]);

  // ⌘+L / Ctrl+L · keyboard shortcut to flip light ↔ dark mode without
  // needing to navigate to Settings → Options. Optimistically updates
  // local state so the theme flips instantly; PATCH runs in the
  // background so the choice survives across devices. Skipped while
  // typing in inputs/textareas so we don't hijack browser autocomplete.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.key === "l" || e.key === "L")) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (!maker) return;
      e.preventDefault();
      const next = maker.appearance_mode === "light" ? "dark" : "light";
      setMaker((m) => ({ ...m, appearance_mode: next }));
      toast.success(`${next === "light" ? "Light" : "Dark"} mode · ${navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"}+L to toggle`);
      updateMakerProfile({ appearance_mode: next }).catch(() => {
        // Roll back the optimistic flip if the backend rejects it.
        setMaker((m) => ({ ...m, appearance_mode: maker.appearance_mode }));
        toast.error("Couldn't save theme — try again.");
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maker]);

  // The Dashboard tab's "Edit shop" checklist CTA dispatches this event
  // instead of routing to a tab — opens the same profile drawer the
  // top-bar "Edit Shop" button uses.
  useEffect(() => {
    const handler = () => setProfileOpen(true);
    window.addEventListener("cm:open-profile-drawer", handler);
    return () => window.removeEventListener("cm:open-profile-drawer", handler);
  }, []);

  // The Crafters Plus upgrade nudge dispatches this — switch to Settings AND
  // pre-select the desired sub-section in a single user click. We forward
  // the section detail along by stashing it on a ref the SettingsTab reads.
  const initialSettingsSectionRef = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      initialSettingsSectionRef.current = e.detail?.section || null;
      changeTab("settings");
    };
    window.addEventListener("cm:open-settings", handler);
    return () => window.removeEventListener("cm:open-settings", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Crafters Plus checkout returns the maker here with `?plus=success` (or
  // `?plus=canceled` on cancel). Celebrate the upgrade with a brief
  // confetti burst + toast, refresh the maker doc so the badge updates,
  // and clean the URL so a refresh doesn't re-fire the celebration.
  useEffect(() => {
    // Skip the celebration if the maker isn't actually signed-in — they'll
    // be bounced to /maker/login and the canvas would render briefly on
    // top of the login page (looks like a bug, isn't useful).
    if (!localStorage.getItem("cm_maker_jwt")) return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("plus");
    if (!flag) return;
    if (flag === "success") {
      // Stripe webhooks are async — give the subscription a moment to flip
      // active before we re-fetch the maker doc.
      const fire = () => {
        const burst = (origin) => confetti({
          particleCount: 60, spread: 70, startVelocity: 45,
          origin, colors: ["#ff4500", "#ffffff", "#ff8c42", "#fbbf24"],
          disableForReducedMotion: true,
        });
        burst({ x: 0.2, y: 0.3 });
        setTimeout(() => burst({ x: 0.8, y: 0.3 }), 220);
        setTimeout(() => burst({ x: 0.5, y: 0.2 }), 440);
      };
      fire();
      toast.success("Welcome to Crafters Plus! 1% lower commission and 15 free listings/mo are live.", { duration: 6000 });
      setTimeout(() => { fetchMakerMe().then(setMaker).catch(() => {}); }, 1500);
      // Pre-route to billing tab so the maker sees the active subscription card.
      window.location.hash = "settings";
    } else if (flag === "canceled") {
      toast("Upgrade canceled — no charge made.", { duration: 4000 });
    }
    const hashKept = window.location.hash || "";
    window.history.replaceState({}, "", window.location.pathname + hashKept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = () => {
    localStorage.removeItem("cm_maker_jwt");
    localStorage.removeItem("cm_maker_slug");
    localStorage.removeItem("cm_maker_jwt_exp");
    navigate("/maker/login", { replace: true });
  };

  const refreshMaker = async () => {
    try { setMaker(await fetchMakerMe()); }
    catch { /* will surface on next load */ }
  };
  const refreshProducts = async () => {
    try { setProducts(await fetchMakerProducts()); }
    catch { /* swallow */ }
  };

  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) {
      navigate("/maker/login", { replace: true });
      return;
    }
    (async () => {
      try {
        const [me, ords, prods, ths, bos] = await Promise.all([
          fetchMakerMe(), fetchMakerOrders(), fetchMakerProducts(),
          fetchMakerThreads().catch(() => ({ threads: [] })),
          // Don't fail the whole dashboard load if the backorder endpoint
          // hiccups — treat it as zero pending and surface nothing.
          fetchMakerBackorderRequests().catch(() => []),
        ]);
        setMaker(me); setOrders(ords); setProducts(prods);
        setThreads(Array.isArray(ths) ? ths : (ths?.threads || []));
        setPendingBackorders(
          (Array.isArray(bos) ? bos : []).filter((b) => b.status === "pending").length,
        );
      } catch (e) {
        if (e?.response?.status === 401) { logout(); return; }
        setErr(e?.response?.data?.detail || "Failed to load.");
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Live polling (30s) ----------------------------------------------
  // Why a single ref-based interval and NOT a per-tile auto-refresh hook?
  //  - The same source of truth (orders/products/threads) feeds the
  //    Dashboard KPIs AND the deeper tabs. Polling once and propagating
  //    via React state keeps every surface in sync without duplicate
  //    requests.
  //  - The browser tab visibility check stops polling when the maker
  //    backgrounds the tab — saves API hits while still updating the
  //    moment they switch back (visibilitychange refetches immediately).
  //  - We compare counts via refs (not state) so the polling closure
  //    always sees the latest, regardless of React render timing.
  const ordersRef = useRef(orders);
  const threadsRef = useRef(threads);
  const productsRef = useRef(products);
  ordersRef.current = orders;
  threadsRef.current = threads;
  productsRef.current = products;

  useEffect(() => {
    if (loading || !localStorage.getItem("cm_maker_jwt")) return;
    let cancelled = false;

    const unreadCount = (ths) =>
      (ths || []).reduce((s, t) => s + (t.unread_for_maker || 0), 0);

    const poll = async () => {
      if (cancelled || document.hidden) return;
      try {
        const [ords, prods, ths] = await Promise.all([
          fetchMakerOrders().catch(() => null),
          fetchMakerProducts().catch(() => null),
          fetchMakerThreads().catch(() => null),
        ]);
        if (cancelled) return;
        // /messages/maker/threads returns `{threads: [...]}` — unwrap.
        const thsList = Array.isArray(ths) ? ths : (ths?.threads || null);
        const next = { orders: false, messages: false, products: false };
        let bump = false;

        if (Array.isArray(ords)) {
          if (ords.length > (ordersRef.current?.length || 0)) {
            next.orders = true; bump = true;
          }
          setOrders(ords);
        }
        if (Array.isArray(thsList)) {
          if (unreadCount(thsList) > unreadCount(threadsRef.current)) {
            next.messages = true; bump = true;
          }
          setThreads(thsList);
        }
        if (Array.isArray(prods)) {
          // Quietly refresh products (no pulse — makers edit these
          // themselves, surprise pulses would be noise).
          setProducts(prods);
        }
        if (bump) {
          setFresh(next);
          setFreshKey((k) => k + 1);
          // Self-clear the pulse flags after the animation duration so
          // re-renders don't re-fire stale animations.
          setTimeout(() => {
            setFresh({ orders: false, messages: false, products: false });
          }, 4000);
          // Light touch toast — only when the maker is on the dashboard
          // (other tabs already surface their own activity).
          if ((window.location.hash || "#dashboard").includes("dashboard")) {
            if (next.orders && next.messages) {
              toast.success("New order and new message just came in.");
            } else if (next.orders) {
              toast.success("New order just came in.");
            } else if (next.messages) {
              toast.success("New message from a buyer.");
            }
          }
        }
      } catch {
        /* polling errors are non-fatal — we'll try again next interval */
      }
    };

    const id = setInterval(poll, 30_000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loading]);

  if (loading) {
    return (
      <div className="pt-40 pb-24 min-h-screen grain text-center" data-testid="maker-dashboard-loading">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
          ◆ Loading shop manager…
        </div>
      </div>
    );
  }
  if (err && !maker) {
    return (
      <div className="pt-40 pb-24 min-h-screen grain text-center px-4">
        <p className="font-mono text-sm text-red-400">{err}</p>
        <button onClick={logout} className="btn-industrial btn-primary mt-6 inline-flex">
          Sign in again
        </button>
      </div>
    );
  }

  return (
    <>
      <ShopManagerLayout
        maker={maker}
        tab={tab}
        onTabChange={changeTab}
        onLogout={logout}
        onOpenProfile={() => setProfileOpen(true)}
      >
        {tab === "dashboard"  && (
          <DashboardTab
            maker={maker}
            orders={orders}
            products={products}
            unreadMessages={threads.reduce((s, t) => s + (t.unread_for_maker || 0), 0)}
            pendingBackorders={pendingBackorders}
            fresh={fresh}
            freshKey={freshKey}
            onTabChange={changeTab}
          />
        )}
        {tab === "listings"   && <ProductsList products={products} onRefresh={refreshProducts} />}
        {tab === "renewals"   && <RenewalsTab />}
        {tab === "orders"     && <OrdersTabWrapper
            orders={orders}
            reload={() => fetchMakerOrders().then(setOrders).catch(() => {})}
            onBackordersChange={(list) => setPendingBackorders(list.filter((b) => b.status === "pending").length)}
          />}
        {tab === "messages"   && <MessagesTab maker={maker} />}
        {tab === "briefs"     && <BriefsTab />}
        {tab === "reviews"    && <ReviewsTab />}
        {tab === "stats"      && <StatsTab />}
        {tab === "violations" && <ViolationsTab />}
        {tab === "marketing"  && <MarketingTab />}
        {tab === "promote"    && <PromoteTab />}
        {tab === "financials" && <FinancialsTab />}
        {tab === "help"       && <HelpTab />}
        {tab === "settings"   && (
          <SettingsTab
            maker={maker}
            onMakerUpdated={(m) => setMaker(m)}
            onTabChange={changeTab}
            initialSection={initialSettingsSectionRef.current}
          />
        )}
      </ShopManagerLayout>

      {profileOpen && (
        <ProfileDrawer
          maker={maker}
          onClose={() => setProfileOpen(false)}
          onSaved={async () => { await refreshMaker(); toast.success("Shop profile updated."); }}
        />
      )}
    </>
  );
}

/** Orders tab — wraps the existing list with Pending/Fulfilled/Backorders subtabs. */
function OrdersTabWrapper({ orders, reload, onBackordersChange }) {
  const [sub, setSub] = useState("pending");
  const [backorders, setBackorders] = useState([]);
  // Lazy-load backorder requests on first switch into that tab so we
  // avoid an extra API hit on every dashboard mount. Refetched after
  // every accept/decline/fulfill via reloadBackorders() handed down.
  const reloadBackorders = React.useCallback(
    () => fetchMakerBackorderRequests()
      .then((list) => {
        setBackorders(list);
        onBackordersChange?.(list);
      })
      .catch(() => {}),
    [onBackordersChange],
  );
  useEffect(() => {
    if (sub === "backorders") reloadBackorders();
  }, [sub, reloadBackorders]);

  const pending = orders.filter((o) => (o.order_status || "pending") !== "fulfilled");
  const fulfilled = orders.filter((o) => o.order_status === "fulfilled");
  const visible = sub === "pending" ? pending : sub === "fulfilled" ? fulfilled : null;
  const pendingBackorders = backorders.filter((b) => b.status === "pending").length;

  return (
    <div className="space-y-6" data-testid="orders-tab">
      <header className="pb-6 border-b border-line">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Orders.</h2>
        <p className="font-mono text-xs text-ink-muted mt-2">
          Pending orders need shipping action. Fulfilled orders are paid out via Stripe.
          Backorder requests are handled off-platform.
        </p>
      </header>
      <div className="flex gap-2 flex-wrap" data-testid="orders-subtabs">
        <SubTab active={sub === "pending"} onClick={() => setSub("pending")} count={pending.length} testid="orders-sub-pending">
          Pending
        </SubTab>
        <SubTab active={sub === "fulfilled"} onClick={() => setSub("fulfilled")} count={fulfilled.length} testid="orders-sub-fulfilled">
          Fulfilled
        </SubTab>
        <SubTab active={sub === "backorders"} onClick={() => setSub("backorders")} count={pendingBackorders} testid="orders-sub-backorders">
          Backorders
        </SubTab>
      </div>
      {sub === "backorders"
        ? <BackordersList requests={backorders} onChange={reloadBackorders} />
        : <OrdersList orders={visible} onChange={reload} />}
    </div>
  );
}

function SubTab({ active, onClick, count, children, testid }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 border font-mono text-[11px] uppercase tracking-[0.22em] inline-flex items-center gap-2 ${
        active
          ? "border-brand bg-brand/10 text-brand"
          : "border-line text-ink-muted hover:border-ink-muted"
      }`}
      data-testid={testid}
    >
      {children}
      <span className={`text-[10px] ${active ? "text-brand" : "text-ink-muted"}`}>· {count}</span>
    </button>
  );
}

/** Profile drawer — opens from the top-bar gear; wraps the existing
 *  ProfileForm so we don't duplicate field/validation logic. */
function ProfileDrawer({ maker, onClose, onSaved }) {
  const ref = useModalA11y(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-paper/70 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        className="relative w-full max-w-2xl bg-paper border-l border-line overflow-y-auto"
        data-testid="profile-drawer"
      >
        <div className="sticky top-0 bg-paper border-b border-line px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-1">
              ◆ Shop Profile
            </div>
            <h2 className="font-display text-2xl uppercase">Edit Shop</h2>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em]"
            data-testid="profile-drawer-close"
          >
            Done
          </button>
        </div>
        <div className="p-6">
          <ProfileForm maker={maker} onSaved={async () => { await onSaved(); }} />
        </div>
      </div>
    </div>
  );
}
