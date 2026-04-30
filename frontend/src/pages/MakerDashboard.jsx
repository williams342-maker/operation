import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import {
  fetchMakerMe, fetchMakerOrders, fetchMakerProducts, fetchMakerThreads,
} from "../lib/api";

import ShopManagerLayout from "./MakerDashboard/ShopManagerLayout";
import DashboardTab from "./MakerDashboard/DashboardTab";
import SettingsTab from "./MakerDashboard/SettingsTab";
import ProductsList from "./MakerDashboard/ProductsList";
import OrdersList from "./MakerDashboard/OrdersList";
import StatsTab from "./MakerDashboard/StatsTab";
import ViolationsTab from "./MakerDashboard/ViolationsTab";
import MarketingTab from "./MakerDashboard/MarketingTab";
import FinancialsTab from "./MakerDashboard/FinancialsTab";
import HelpTab from "./MakerDashboard/HelpTab";
import MessagesTab from "./MakerDashboard/MessagesTab";
import BriefsTab from "./MakerDashboard/BriefsTab";
import ProfileForm from "./MakerDashboard/ProfileForm";
import useModalA11y from "../hooks/useModalA11y";

// Legacy `#upgrade` URLs (the old top-level Upgrade tab) now route to the
// Subscription section inside Settings — keeps any bookmarked links working.
function normalizeTab(id) {
  if (id === "upgrade") return "settings";
  return id;
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
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  // Tracks which KPI tiles incremented on the last poll so the Dashboard
  // can pulse them. `freshKey` bumps on every increment so the pulse
  // animation re-fires even if the same KPI keeps gaining (e.g. 2 → 3 → 4).
  const [fresh, setFresh] = useState({ orders: false, messages: false, products: false });
  const [freshKey, setFreshKey] = useState(0);

  const [tab, setTab] = useState(() => normalizeTab((window.location.hash || "#dashboard").replace("#", "")));
  useEffect(() => {
    const onHash = () => setTab(normalizeTab((window.location.hash || "#dashboard").replace("#", "")));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const changeTab = (id) => { window.location.hash = id; setTab(id); };

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
        const [me, ords, prods, ths] = await Promise.all([
          fetchMakerMe(), fetchMakerOrders(), fetchMakerProducts(),
          fetchMakerThreads().catch(() => ({ threads: [] })),
        ]);
        setMaker(me); setOrders(ords); setProducts(prods);
        // /messages/maker/threads returns `{threads: [...]}` — unwrap it.
        setThreads(Array.isArray(ths) ? ths : (ths?.threads || []));
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
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
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
            fresh={fresh}
            freshKey={freshKey}
            onTabChange={changeTab}
          />
        )}
        {tab === "listings"   && <ProductsList products={products} onRefresh={refreshProducts} />}
        {tab === "orders"     && <OrdersTabWrapper orders={orders} reload={() => fetchMakerOrders().then(setOrders).catch(() => {})} />}
        {tab === "messages"   && <MessagesTab maker={maker} />}
        {tab === "briefs"     && <BriefsTab />}
        {tab === "stats"      && <StatsTab />}
        {tab === "violations" && <ViolationsTab />}
        {tab === "marketing"  && <MarketingTab />}
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

/** Orders tab — wraps the existing list with Pending/Fulfilled subtabs. */
function OrdersTabWrapper({ orders, reload }) {
  const [sub, setSub] = useState("pending");
  const pending = orders.filter((o) => (o.order_status || "pending") !== "fulfilled");
  const fulfilled = orders.filter((o) => o.order_status === "fulfilled");
  const visible = sub === "pending" ? pending : fulfilled;
  return (
    <div className="space-y-6" data-testid="orders-tab">
      <header className="pb-6 border-b border-[#262626]">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Orders.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2">
          Pending orders need shipping action. Fulfilled orders are paid out via Stripe.
        </p>
      </header>
      <div className="flex gap-2" data-testid="orders-subtabs">
        <SubTab active={sub === "pending"} onClick={() => setSub("pending")} count={pending.length} testid="orders-sub-pending">
          Pending
        </SubTab>
        <SubTab active={sub === "fulfilled"} onClick={() => setSub("fulfilled")} count={fulfilled.length} testid="orders-sub-fulfilled">
          Fulfilled
        </SubTab>
      </div>
      <OrdersList orders={visible} onChange={reload} />
    </div>
  );
}

function SubTab({ active, onClick, count, children, testid }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 border font-mono text-[11px] uppercase tracking-[0.22em] inline-flex items-center gap-2 ${
        active
          ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]"
          : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
      }`}
      data-testid={testid}
    >
      {children}
      <span className={`text-[10px] ${active ? "text-[#ff4500]" : "text-[#525252]"}`}>· {count}</span>
    </button>
  );
}

/** Profile drawer — opens from the top-bar gear; wraps the existing
 *  ProfileForm so we don't duplicate field/validation logic. */
function ProfileDrawer({ maker, onClose, onSaved }) {
  const ref = useModalA11y(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        className="relative w-full max-w-2xl bg-[#0a0a0a] border-l border-[#262626] overflow-y-auto"
        data-testid="profile-drawer"
      >
        <div className="sticky top-0 bg-[#0a0a0a] border-b border-[#262626] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
              ◆ Shop Profile
            </div>
            <h2 className="font-display text-2xl uppercase">Edit Shop</h2>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]"
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
