import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  fetchMakerMe,
  fetchMakerOrders,
  fetchMakerProducts,
} from "../lib/api";

import { Stat } from "./MakerDashboard/_shared";
import ProfileForm from "./MakerDashboard/ProfileForm";
import ProductsList from "./MakerDashboard/ProductsList";
import OrdersList from "./MakerDashboard/OrdersList";
import PayoutsTab from "./MakerDashboard/PayoutsTab";
import BillingTab from "./MakerDashboard/BillingTab";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "products", label: "Listings" },
  { id: "orders", label: "Orders" },
  { id: "payouts", label: "Payouts" },
  { id: "billing", label: "Billing" },
];

export default function MakerDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("profile");
  const [maker, setMaker] = useState(null);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const logout = () => {
    localStorage.removeItem("cm_maker_jwt");
    localStorage.removeItem("cm_maker_slug");
    navigate("/maker/login", { replace: true });
  };

  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) {
      navigate("/maker/login", { replace: true });
      return;
    }
    (async () => {
      try {
        const [me, ords, prods] = await Promise.all([
          fetchMakerMe(),
          fetchMakerOrders(),
          fetchMakerProducts(),
        ]);
        setMaker(me);
        setOrders(ords);
        setProducts(prods);
      } catch (e) {
        if (e?.response?.status === 401) {
          logout();
          return;
        }
        setErr(e?.response?.data?.detail || "Failed to load.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="pt-40 pb-24 min-h-screen grain text-center" data-testid="maker-dashboard-loading">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
          ◆ Loading workshop…
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

  const totalRevenue = orders.reduce((s, o) => s + (o.maker_subtotal || 0), 0);

  return (
    <div className="pt-32 pb-24 min-h-screen grain" data-testid="maker-dashboard">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10 pb-6 border-b border-[#262626]"
        >
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
              ◆ Maker Portal · {maker.slug}
            </div>
            <h1 className="font-display text-[44px] md:text-[72px] leading-[0.9] uppercase">
              {maker.name}.
            </h1>
            <p className="font-mono text-xs text-[#a3a3a3] mt-2">
              {maker.email} · {maker.location}
            </p>
          </div>
          <button
            onClick={logout}
            className="self-start md:self-auto px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
            data-testid="maker-logout-btn"
          >
            Sign Out
          </button>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 md:gap-6 mb-10">
          <Stat label="Listings" value={products.length} testId="stat-listings" />
          <Stat label="Paid Orders" value={orders.length} testId="stat-orders" />
          <Stat label="Revenue" value={`$${totalRevenue.toFixed(0)}`} testId="stat-revenue" />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#262626] mb-8 overflow-x-auto" data-testid="maker-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] border-b-2 transition whitespace-nowrap ${
                tab === t.id
                  ? "border-[#ff4500] text-[#ff4500]"
                  : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
              data-testid={`tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "profile" && (
          <ProfileForm maker={maker} onSaved={setMaker} />
        )}
        {tab === "products" && (
          <ProductsList
            products={products}
            onChanged={async () => {
              const ps = await fetchMakerProducts();
              setProducts(ps);
            }}
          />
        )}
        {tab === "orders" && <OrdersList orders={orders} />}
        {tab === "payouts" && <PayoutsTab />}
        {tab === "billing" && <BillingTab />}
      </div>
    </div>
  );
}
