import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  fetchMakerMe, fetchMakerOrders, fetchMakerProducts,
} from "../lib/api";

import ShopManagerLayout from "./MakerDashboard/ShopManagerLayout";
import ProductsList from "./MakerDashboard/ProductsList";
import OrdersList from "./MakerDashboard/OrdersList";
import StatsTab from "./MakerDashboard/StatsTab";
import ViolationsTab from "./MakerDashboard/ViolationsTab";
import MarketingTab from "./MakerDashboard/MarketingTab";
import FinancialsTab from "./MakerDashboard/FinancialsTab";
import HelpTab from "./MakerDashboard/HelpTab";
import UpgradeTab from "./MakerDashboard/UpgradeTab";
import MessagesTab from "./MakerDashboard/MessagesTab";
import ProfileForm from "./MakerDashboard/ProfileForm";
import useModalA11y from "../hooks/useModalA11y";

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
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  const [tab, setTab] = useState(() => (window.location.hash || "#listings").replace("#", ""));
  useEffect(() => {
    const onHash = () => setTab((window.location.hash || "#listings").replace("#", ""));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const changeTab = (id) => { window.location.hash = id; setTab(id); };

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
        const [me, ords, prods] = await Promise.all([
          fetchMakerMe(), fetchMakerOrders(), fetchMakerProducts(),
        ]);
        setMaker(me); setOrders(ords); setProducts(prods);
      } catch (e) {
        if (e?.response?.status === 401) { logout(); return; }
        setErr(e?.response?.data?.detail || "Failed to load.");
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {tab === "listings"   && <ProductsList products={products} onRefresh={refreshProducts} />}
        {tab === "orders"     && <OrdersTabWrapper orders={orders} />}
        {tab === "messages"   && <MessagesTab maker={maker} />}
        {tab === "stats"      && <StatsTab />}
        {tab === "violations" && <ViolationsTab />}
        {tab === "marketing"  && <MarketingTab />}
        {tab === "financials" && <FinancialsTab />}
        {tab === "help"       && <HelpTab />}
        {tab === "upgrade"    && <UpgradeTab maker={maker} />}
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
function OrdersTabWrapper({ orders }) {
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
      <OrdersList orders={visible} />
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
