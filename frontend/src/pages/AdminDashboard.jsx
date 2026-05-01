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
import ApprovedMakersTab from "../components/admin/ApprovedMakersTab";
import RejectedAppsTab from "../components/admin/RejectedAppsTab";
import PlusMembersTab from "../components/admin/PlusMembersTab";
import BroadcastTab from "../components/admin/BroadcastTab";
import DesignFileReportsTab from "../components/admin/DesignFileReportsTab";
import CustomOrdersList from "../components/admin/CustomOrdersList";
import PaidOrdersList from "../components/admin/PaidOrdersList";
import ListingsTab from "../components/admin/ListingsTab";
import UsersTab from "../components/admin/UsersTab";
import ReviewsTab from "../components/admin/ReviewsTab";
import DigestsTab from "../components/admin/DigestsTab";
import FeedbackTab from "../components/admin/FeedbackTab";
import ContactInboxTab from "../components/admin/ContactInboxTab";
import SettingsTab from "../components/admin/SettingsTab";
import AuditTab from "../components/admin/AuditTab";
import AdsTab from "../components/admin/AdsTab";
import BufferTab from "../components/admin/BufferTab";
import ChatModTab from "../components/admin/ChatModTab";
import RetentionTab from "../components/admin/RetentionTab";
import TeamTab from "../components/admin/TeamTab";
import RefundApprovalsTab from "../components/admin/RefundApprovalsTab";
import ShippingLedgerTab from "../components/admin/ShippingLedgerTab";
import RotatePasswordModal from "../components/admin/RotatePasswordModal";
import EmailHealthBadge from "../components/admin/EmailHealthBadge";
import LiveNowBadge from "../components/admin/LiveNowBadge";

const TABS = [
  { id: "analytics", label: "Analytics" },
  { id: "retention", label: "Retention" },
  { id: "web", label: "Web Analytics" },
  { id: "makers", label: "Maker Analytics" },
  { id: "applications", label: "Applications" },
  { id: "approved-makers", label: "Approved Makers" },
  { id: "rejected-apps", label: "Rejected" },
  { id: "plus-members", label: "Plus Members" },
  { id: "broadcast", label: "Broadcast" },
  { id: "custom", label: "Custom Orders" },
  { id: "orders", label: "Paid Orders" },
  { id: "approvals", label: "Refund Approvals" },
  { id: "shipping-ledger", label: "Shipping Ledger" },
  { id: "listings", label: "Listings" },
  { id: "users", label: "Users" },
  { id: "reviews", label: "Reviews" },
  { id: "file-reports", label: "File Reports" },
  { id: "audit", label: "Audit Log" },
  { id: "ads", label: "Ads" },
  { id: "buffer", label: "Social" },
  { id: "chat", label: "Chat Mod" },
  { id: "digests", label: "Digests" },
  { id: "feedback", label: "Beta Feedback" },
  { id: "contact", label: "Contact Inbox" },
  { id: "team", label: "Team", superOnly: true },
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
  // `voluntaryRotate` = admin clicked "Rotate now" from the pre-expiry
  // banner. Opens the same RotatePasswordModal in dismissible mode.
  const [voluntaryRotate, setVoluntaryRotate] = useState(false);

  // Reset scroll to top whenever the active tab changes — keeps tab
  // switches from landing the admin mid-page on the new section.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [tab]);

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
          <div className="flex items-center gap-3 self-start md:self-auto shrink-0 flex-wrap">
            <EmailHealthBadge />
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

        {/* Pre-expiry password rotation warning — shown when the admin is
            within 5 days of the forced rotation deadline but NOT yet past
            it (past = blocking modal takes over). One-click "Rotate now"
            opens the same modal in dismissible mode. */}
        {me && !me.requires_password_rotation
          && typeof me.password_rotation?.days_until_required === "number"
          && me.password_rotation.days_until_required <= 5
          && me.password_rotation.policy_days > 0 && (
          <div
            className="mb-8 border border-yellow-600/60 bg-yellow-600/10 px-4 md:px-5 py-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4"
            data-testid="password-expiry-banner"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-yellow-400 shrink-0">
              ◆ Security
            </div>
            <div className="flex-1 font-mono text-xs text-[#e5e5e5] leading-relaxed">
              Your password expires in{" "}
              <b className="text-yellow-300" data-testid="password-expiry-days">
                {me.password_rotation.days_until_required}{" "}
                {me.password_rotation.days_until_required === 1 ? "day" : "days"}
              </b>
              . Rotate now to reset the {me.password_rotation.policy_days}-day clock.
            </div>
            <button
              onClick={() => setVoluntaryRotate(true)}
              className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-[#0a0a0a] border border-yellow-600 font-mono text-[10px] uppercase tracking-[0.22em] shrink-0 transition"
              data-testid="password-expiry-rotate-btn"
            >
              Rotate now →
            </button>
          </div>
        )}

        {/* Admin nav — left sidebar on desktop (lg+), scrollable horizontal
            bar on mobile/tablet. The sidebar is sticky so long pages keep
            the tab rail visible as you scroll through content. */}
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
          <nav
            className="-mx-4 lg:mx-0 px-4 lg:px-0 mb-6 lg:mb-0 flex lg:flex-col lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-[#262626] lg:pr-4 overflow-x-auto lg:overflow-x-visible scrollbar-thin bg-[#0a0a0a] lg:bg-transparent sticky top-[64px] lg:top-6 z-20"
            data-testid="admin-tabs"
            aria-label="Admin sections"
          >
            {TABS.filter((t) => !t.superOnly || me?.is_super_admin).map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`
                    font-mono text-[10px] md:text-[11px] uppercase tracking-[0.18em] md:tracking-[0.22em] whitespace-nowrap transition
                    px-3 md:px-5 py-3 shrink-0 border-b-2 lg:border-b-0 lg:border-l-2 lg:w-full lg:text-left lg:px-3 lg:py-2.5
                    ${active
                      ? "border-[#ff4500] text-[#ff4500] lg:bg-[#ff4500]/5"
                      : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5] lg:hover:bg-[#121212]"}
                  `}
                  data-testid={`admin-tab-${t.id}`}
                  aria-current={active ? "page" : undefined}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            {tab === "analytics" && <AnalyticsTab />}
            {tab === "retention" && <RetentionTab />}
            {tab === "web" && <WebAnalyticsTab />}
            {tab === "makers" && <MakerAnalyticsTab />}
            {tab === "applications" && <ApplicationsList items={apps} onChange={refresh} />}
            {tab === "approved-makers" && <ApprovedMakersTab />}
            {tab === "rejected-apps" && <RejectedAppsTab />}
            {tab === "plus-members" && <PlusMembersTab />}
            {tab === "broadcast" && <BroadcastTab />}
            {tab === "file-reports" && <DesignFileReportsTab />}
            {tab === "custom" && <CustomOrdersList items={custom} onChange={refresh} />}
            {tab === "orders" && <PaidOrdersList items={orders} />}
            {tab === "approvals" && <RefundApprovalsTab me={me} />}
            {tab === "shipping-ledger" && <ShippingLedgerTab />}
            {tab === "listings" && <ListingsTab />}
            {tab === "users" && <UsersTab />}
            {tab === "reviews" && <ReviewsTab />}
            {tab === "audit" && <AuditTab />}
            {tab === "ads" && <AdsTab />}
            {tab === "buffer" && <BufferTab />}
            {tab === "chat" && <ChatModTab />}
            {tab === "digests" && <DigestsTab />}
            {tab === "feedback" && <FeedbackTab />}
            {tab === "contact" && <ContactInboxTab />}
            {tab === "team" && me?.is_super_admin && <TeamTab />}
            {tab === "settings" && <SettingsTab />}
          </div>
        </div>
      </div>

      {/* Password rotation gate — modal blocks the entire console until the
          admin sets a new password. Driven by `/api/admin/me`, so a simple
          page refresh clears it the moment rotation succeeds. */}
      {me?.requires_password_rotation && (
        <RotatePasswordModal
          email={me.email}
          policyDays={me.password_rotation?.policy_days || 30}
          daysSince={me.password_rotation?.days_since_change || 0}
          onDone={refresh}
        />
      )}

      {/* Voluntary (dismissible) rotation — opened from the pre-expiry banner. */}
      {voluntaryRotate && me && !me.requires_password_rotation && (
        <RotatePasswordModal
          email={me.email}
          policyDays={me.password_rotation?.policy_days || 30}
          daysSince={me.password_rotation?.days_since_change || 0}
          onDone={refresh}
          onClose={() => setVoluntaryRotate(false)}
        />
      )}
    </div>
  );
}
