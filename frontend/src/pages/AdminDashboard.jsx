import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  fetchAdminMe,
  fetchAdminApplications,
  fetchAdminCustomOrders,
  fetchAdminOrders,
} from "../lib/api";
import { Stat } from "../components/admin/_shared";
import AnalyticsTab from "../components/admin/AnalyticsTab";
import WebAnalyticsTab from "../components/admin/WebAnalyticsTab";
import MakerAnalyticsTab from "../components/admin/MakerAnalyticsTab";
import ApplicationsList from "../components/admin/ApplicationsList";
import CustomOrdersList from "../components/admin/CustomOrdersList";
import PaidOrdersList from "../components/admin/PaidOrdersList";
import ListingsTab from "../components/admin/ListingsTab";
import UsersTab from "../components/admin/UsersTab";
import ReviewsTab from "../components/admin/ReviewsTab";
import DigestsTab from "../components/admin/DigestsTab";
import SettingsTab from "../components/admin/SettingsTab";
import AuditTab from "../components/admin/AuditTab";
import AdsTab from "../components/admin/AdsTab";
import BufferTab from "../components/admin/BufferTab";
import ChatModTab from "../components/admin/ChatModTab";
import RetentionTab from "../components/admin/RetentionTab";
import LiveNowBadge from "../components/admin/LiveNowBadge";

const TABS = [
  { id: "analytics", label: "Analytics" },
  { id: "retention", label: "Retention" },
  { id: "web", label: "Web Analytics" },
  { id: "makers", label: "Maker Analytics" },
  { id: "applications", label: "Applications" },
  { id: "custom", label: "Custom Orders" },
  { id: "orders", label: "Paid Orders" },
  { id: "listings", label: "Listings" },
  { id: "users", label: "Users" },
  { id: "reviews", label: "Reviews" },
  { id: "audit", label: "Audit Log" },
  { id: "ads", label: "Ads" },
  { id: "buffer", label: "Social" },
  { id: "chat", label: "Chat Mod" },
  { id: "digests", label: "Digests" },
  { id: "settings", label: "Settings" },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("applications");
  const [me, setMe] = useState(null);
  const [apps, setApps] = useState([]);
  const [custom, setCustom] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const logout = () => {
    localStorage.removeItem("cm_admin_jwt");
    navigate("/admin/login", { replace: true });
  };

  const refresh = async () => {
    const [meRes, appRes, custRes, ordRes] = await Promise.all([
      fetchAdminMe(),
      fetchAdminApplications(),
      fetchAdminCustomOrders(),
      fetchAdminOrders(),
    ]);
    setMe(meRes);
    setApps(appRes);
    setCustom(custRes);
    setOrders(ordRes);
  };

  useEffect(() => {
    if (!localStorage.getItem("cm_admin_jwt")) {
      navigate("/admin/login", { replace: true });
      return;
    }
    (async () => {
      try {
        await refresh();
      } catch (e) {
        if (e?.response?.status === 401 || e?.response?.status === 403) {
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
      <div className="pt-40 pb-24 min-h-screen grain text-center" data-testid="admin-dashboard-loading">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
          ◆ Loading console…
        </div>
      </div>
    );
  }

  if (err && !me) {
    return (
      <div className="pt-40 pb-24 min-h-screen grain text-center px-4">
        <p className="font-mono text-sm text-red-400">{err}</p>
        <button onClick={logout} className="btn-industrial btn-primary mt-6 inline-flex">
          Sign in again
        </button>
      </div>
    );
  }

  const totalRevenue = orders.reduce((s, o) => s + (o.amount || 0), 0);
  const pendingApps = apps.filter((a) => !a.status).length;
  const pendingCustom = custom.filter((c) => c.status !== "quoted").length;

  return (
    <div className="pt-32 pb-24 min-h-screen grain" data-testid="admin-dashboard">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8 md:mb-10 pb-6 border-b border-[#262626]"
        >
          <div className="min-w-0">
            <div className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3 truncate">
              ◆ Admin Console · {me?.email}
            </div>
            <h1 className="font-display text-[36px] md:text-[72px] leading-[0.9] uppercase">
              Operations.
            </h1>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto shrink-0">
            <LiveNowBadge />
            <button
              onClick={logout}
              className="px-3 md:px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] md:text-[11px] uppercase tracking-[0.22em] transition"
              data-testid="admin-logout-btn"
            >
              Sign Out
            </button>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-6 mb-8 md:mb-10">
          <Stat label="Pending Apps" value={pendingApps} testId="stat-pending-apps" />
          <Stat label="Open Briefs" value={pendingCustom} testId="stat-pending-custom" />
          <Stat label="Paid Orders" value={orders.length} testId="stat-paid-orders" />
          <Stat label="Revenue" value={`$${totalRevenue.toFixed(0)}`} testId="stat-revenue" />
        </div>

        <div
          className="-mx-4 md:mx-0 px-4 md:px-0 flex border-b border-[#262626] mb-8 overflow-x-auto sticky top-[64px] md:top-0 bg-[#0a0a0a] z-20 scrollbar-thin"
          data-testid="admin-tabs"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 md:px-5 py-3 font-mono text-[10px] md:text-[11px] uppercase tracking-[0.18em] md:tracking-[0.22em] border-b-2 transition whitespace-nowrap shrink-0 ${
                tab === t.id
                  ? "border-[#ff4500] text-[#ff4500]"
                  : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
              data-testid={`admin-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "analytics" && <AnalyticsTab />}
        {tab === "retention" && <RetentionTab />}
        {tab === "web" && <WebAnalyticsTab />}
        {tab === "makers" && <MakerAnalyticsTab />}
        {tab === "applications" && <ApplicationsList items={apps} onChange={refresh} />}
        {tab === "custom" && <CustomOrdersList items={custom} onChange={refresh} />}
        {tab === "orders" && <PaidOrdersList items={orders} />}
        {tab === "listings" && <ListingsTab />}
        {tab === "users" && <UsersTab />}
        {tab === "reviews" && <ReviewsTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "ads" && <AdsTab />}
        {tab === "buffer" && <BufferTab />}
        {tab === "chat" && <ChatModTab />}
        {tab === "digests" && <DigestsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
