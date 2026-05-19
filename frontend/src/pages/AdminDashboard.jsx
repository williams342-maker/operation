import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";
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
import DesignFilesTab from "../components/admin/DesignFilesTab";
import AdminCommandPalette from "../components/admin/AdminCommandPalette";
import ReviewDisputesTab from "../components/admin/ReviewDisputesTab";
import ProdHealthTab from "../components/admin/ProdHealthTab";
import ProdHealthBanner from "../components/admin/ProdHealthBanner";
import SecretsRotationBanner from "../components/admin/SecretsRotationBanner";
import UpdatesAdminTab from "../components/admin/UpdatesAdminTab";
import AdminTabBoundary from "../components/admin/AdminTabBoundary";
import GrowthStatsBar from "../components/admin/GrowthStatsBar";
import CustomOrdersList from "../components/admin/CustomOrdersList";
import PaidOrdersList from "../components/admin/PaidOrdersList";
import ListingsTab from "../components/admin/ListingsTab";
import UsersTab from "../components/admin/UsersTab";
import ReviewsTab from "../components/admin/ReviewsTab";
import DigestsTab from "../components/admin/DigestsTab";
import FeedbackTab from "../components/admin/FeedbackTab";
import ComingSoonTab from "../components/admin/ComingSoonTab";
import ShowcaseAnalyticsTab from "../components/admin/ShowcaseAnalyticsTab";
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
import BackupTab from "../components/admin/BackupTab";
import SecretsTab from "../components/admin/SecretsTab";
import PushNotificationsTab from "../components/admin/PushNotificationsTab";
import RotatePasswordModal from "../components/admin/RotatePasswordModal";
import EmailHealthBadge from "../components/admin/EmailHealthBadge";
import LiveNowBadge from "../components/admin/LiveNowBadge";
import useLiveOrderToasts from "../hooks/useLiveOrderToasts";

const TABS = [
  // Source-of-truth list — sorted alphabetically by label below so adding
  // Tab definition. `caps` is the list of admin capabilities that can
  // see + open this tab. Missing/empty `caps` means every admin can
  // see it (read-only / cross-functional surfaces like Audit Log,
  // Analytics, Settings). `superOnly: true` further locks the tab to
  // env-defined super admins regardless of capability.
  // Order in this array is not meaningful — runtime sort below
  // guarantees A→Z so adding a new tab doesn't require manual
  // reordering.
  { id: "ads", label: "Ads", caps: ["finance"] },
  { id: "analytics", label: "Analytics" },
  { id: "applications", label: "Applications", caps: ["marketplace"] },
  { id: "approved-makers", label: "Approved Makers", caps: ["marketplace"] },
  { id: "audit", label: "Audit Log" },
  { id: "backup", label: "Backup", superOnly: true },
  { id: "feedback", label: "Beta Feedback", caps: ["support"] },
  { id: "broadcast", label: "Broadcast", caps: ["content"] },
  { id: "chat", label: "Chat Mod", caps: ["moderation"] },
  { id: "coming-soon", label: "Coming Soon", caps: ["content"] },
  { id: "contact", label: "Contact Inbox", caps: ["support"] },
  { id: "custom", label: "Custom Orders", caps: ["support", "marketplace"] },
  { id: "digests", label: "Digests", caps: ["content"] },
  { id: "file-reports", label: "File Reports", caps: ["moderation", "content"] },
  { id: "design-files", label: "Design Files", caps: ["content"] },
  { id: "listings", label: "Listings", caps: ["marketplace"] },
  { id: "makers", label: "Maker Analytics" },
  { id: "orders", label: "Paid Orders", caps: ["finance", "support"] },
  { id: "plus-members", label: "Plus Members", caps: ["finance", "marketplace"] },
  { id: "prod-health", label: "Prod Health" },
  { id: "push", label: "Push Notifications", caps: ["content"] },
  { id: "approvals", label: "Refund Approvals", caps: ["finance"] },
  { id: "rejected-apps", label: "Rejected", caps: ["marketplace"] },
  { id: "retention", label: "Retention", caps: ["content", "finance"] },
  { id: "reviews", label: "Reviews", caps: ["moderation"] },
  { id: "review-disputes", label: "Review Disputes", caps: ["moderation"] },
  { id: "secrets", label: "Secrets", superOnly: true },
  { id: "settings", label: "Settings" },
  { id: "showcase-analytics", label: "Showcase Analytics", caps: ["content"] },
  { id: "shipping-ledger", label: "Shipping Ledger", caps: ["finance"] },
  { id: "buffer", label: "Social", caps: ["content"] },
  { id: "team", label: "Team", superOnly: true },
  { id: "updates", label: "Updates", caps: ["content"] },
  { id: "users", label: "Users", caps: ["moderation"] },
  { id: "web", label: "Web Analytics" },
];
// Defensive: guarantee A→Z order at runtime so any future TABS edits that
// forget the sort still render alphabetically.
TABS.sort((a, b) => a.label.localeCompare(b.label));

export default function AdminDashboard() {
  const navigate = useNavigate();
  // Dopamine ticker — toast every new live order as it lands.
  useLiveOrderToasts();
  // iter105 — Deep-link from Slack/Discord webhooks: /admin/dashboard?tab=feedback&open=<id>
  // jumps straight to the right tab + scrolls the highlighted row into view.
  // We read the query params lazily inside useState so the initial render
  // already shows the deep-linked tab (no flash of "applications").
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "applications";
    const t = new URLSearchParams(window.location.search).get("tab");
    // Whitelist: only honor known tab ids so a malformed link can't break the page.
    return t && TABS.some((x) => x.id === t) ? t : "applications";
  });
  const [openRowId, setOpenRowId] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("open") || "";
  });
  const [me, setMe] = useState(null);
  const [apps, setApps] = useState([]);
  const [custom, setCustom] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // `voluntaryRotate` = admin clicked "Rotate now" from the pre-expiry
  // banner. Opens the same RotatePasswordModal in dismissible mode.
  const [voluntaryRotate, setVoluntaryRotate] = useState(false);

  // Tabs visible to this admin — drops:
  //   • `superOnly: true` entries unless this is a super admin
  //   • `caps: [...]` entries unless the admin holds AT LEAST ONE of
  //     the listed capabilities. Empty/missing `caps` ⇒ visible to
  //     every admin (e.g. Audit Log, Settings — read-only stuff).
  // The `read_only` capability sees every tab (it's a view-everything
  // shadow role) and can't mutate anything because the per-action
  // backend guards block writes.
  // Memoized so the command palette and the sidebar share the exact
  // same list (otherwise ⌘K could navigate to a hidden tab).
  const visibleTabs = React.useMemo(() => {
    const caps = new Set(me?.capabilities || []);
    const isSuper = !!me?.is_super_admin;
    const seesEverything = isSuper || caps.has("read_only");
    return TABS.filter((t) => {
      if (t.superOnly && !isSuper) return false;
      if (!t.caps || t.caps.length === 0) return true;
      if (seesEverything) return true;
      return t.caps.some((c) => caps.has(c));
    });
  }, [me]);

  // Fallback if the admin's current tab gets hidden by capability
  // filtering (or just by URL tampering): drop them on the first
  // tab they CAN see, instead of showing a blank pane. Skipped while
  // `me` is loading so we don't bounce off "applications" before the
  // permissions are known.
  //
  // We also:
  //   • Sync the URL (`?tab=…`) so a refresh / share lands on the
  //     correct fallback tab, not the original forbidden one.
  //   • Drop the `?open=` deep-link param too — the row being deep-
  //     linked lived on a tab the admin can't see, so it'd be a 404.
  //   • Toast once explaining why they got redirected. Keyed by the
  //     forbidden tab id so React Strict-Mode double-mounts don't
  //     show the toast twice in dev.
  const lastRedirectFromRef = React.useRef(null);
  useEffect(() => {
    if (!me) return;
    if (!visibleTabs.length) return;
    if (visibleTabs.some((t) => t.id === tab)) return;

    const forbiddenId = tab;
    const fallback = visibleTabs[0];
    setTab(fallback.id);

    // Sync URL — strip any deep-link target that's no longer applicable.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", fallback.id);
      url.searchParams.delete("open");
      window.history.replaceState({}, "", url.toString());
    } catch {/* ignore — non-browser env in tests */}

    if (lastRedirectFromRef.current !== forbiddenId) {
      lastRedirectFromRef.current = forbiddenId;
      const forbiddenLabel = TABS.find((t) => t.id === forbiddenId)?.label || forbiddenId;
      toast.message(`No access to "${forbiddenLabel}"`, {
        description: `Showing "${fallback.label}" instead. Ask a super admin if you need that capability.`,
        duration: 6000,
      });
    }
  }, [me, visibleTabs, tab]);

  // Reset scroll to top whenever the active tab changes — keeps tab
  // switches from landing the admin mid-page on the new section.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [tab]);

  // iter105 — Deep-link consumer: when the URL had ?open=<id>, find the
  // row's data-testid (`feedback-row-<id>` / `contact-row-<id>` / etc.),
  // scroll it into view, and pulse-highlight it for ~2.5s. We retry the
  // lookup a few times because the tab content loads async (the row
  // doesn't exist on first paint). After consuming, strip the query
  // params so a manual refresh doesn't re-pulse the same row.
  useEffect(() => {
    if (!openRowId) return;
    let cancelled = false;
    let attempts = 0;
    const tryHighlight = () => {
      if (cancelled) return;
      attempts += 1;
      // Tab-specific row testids — extend here when more tabs deep-link.
      const candidates = [
        `feedback-row-${openRowId}`,
        `contact-row-${openRowId}`,
      ];
      const el = candidates
        .map((tid) => document.querySelector(`[data-testid="${tid}"]`))
        .find(Boolean);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("admin-deeplink-pulse");
        setTimeout(() => el.classList.remove("admin-deeplink-pulse"), 2500);
        // Strip ?open= so a refresh doesn't re-pulse.
        const url = new URL(window.location.href);
        url.searchParams.delete("open");
        window.history.replaceState({}, "", url.toString());
        setOpenRowId("");
        return;
      }
      if (attempts < 12) setTimeout(tryHighlight, 250); // up to 3s of polling
    };
    // First attempt on next paint so the tab has had a chance to render.
    const t = setTimeout(tryHighlight, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, openRowId]);

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
      // iter106 — preserve the deep-link target (`?tab=…&open=…`) across
      // the magic-link round-trip. We stash the original location in
      // localStorage; AdminVerify (and the password flow on AdminLogin)
      // pick it up after a successful sign-in. Only stash when there's
      // an actual deep-link payload — otherwise we'd accidentally stamp
      // every cold-load with the bare `/admin/dashboard` (no value).
      if (
        window.location.pathname.startsWith("/admin/dashboard") &&
        window.location.search
      ) {
        const here = window.location.pathname + window.location.search;
        try { localStorage.setItem("cm_admin_after", here); } catch {}
      }
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
            <Link
              to="/admin/workshop-analytics"
              className="inline-flex items-center gap-1.5 px-3 md:px-4 py-2 border border-[#ff4500]/40 text-[#ff4500] hover:bg-[#ff4500]/10 hover:border-[#ff4500] font-mono text-[10px] md:text-[11px] uppercase tracking-[0.22em] transition"
              data-testid="admin-workshop-analytics-link"
              title="Full Recharts dashboard with KPIs, cohorts, and time-range pills"
            >
              <BarChart3 size={12} /> Workshop Analytics
            </Link>
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

        {/* Growth heartbeat — opt-in list deltas (24h / 7d). Daily dopamine
            hit and early demand signal for which Coming Soon to launch. */}
        <GrowthStatsBar />

        {/* Prod health watchdog banner — only renders when at least one
            critical endpoint is in the alerted state. Clicking "View"
            jumps to the Prod Health tab. */}
        <ProdHealthBanner onJumpToTab={setTab} />

        {/* Secrets rotation hygiene strip — at-a-glance "days since
            last rotation" for every tracked credential. Red/yellow/
            green coloring; click to jump to the Secrets tab. Only
            visible to super-admins (gated by the GET endpoint). */}
        <SecretsRotationBanner onJumpToTab={setTab} />

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
            {visibleTabs.map((t) => {
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
            <AdminTabBoundary tabId={tab} key={tab}>
            {tab === "analytics" && <AnalyticsTab />}
            {tab === "retention" && <RetentionTab />}
            {tab === "web" && <WebAnalyticsTab />}
            {tab === "makers" && <MakerAnalyticsTab />}
            {tab === "applications" && <ApplicationsList items={apps} onChange={refresh} />}
            {tab === "approved-makers" && <ApprovedMakersTab />}
            {tab === "rejected-apps" && <RejectedAppsTab />}
            {tab === "plus-members" && <PlusMembersTab />}
            {tab === "prod-health" && <ProdHealthTab />}
            {tab === "updates" && <UpdatesAdminTab />}
            {tab === "broadcast" && <BroadcastTab />}
            {tab === "push" && <PushNotificationsTab />}
            {tab === "coming-soon" && <ComingSoonTab />}
            {tab === "file-reports" && <DesignFileReportsTab />}
            {tab === "design-files" && <DesignFilesTab />}
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
            {tab === "backup" && me?.is_super_admin && <BackupTab />}
            {tab === "secrets" && me?.is_super_admin && <SecretsTab />}
            {tab === "settings" && <SettingsTab />}
            {tab === "showcase-analytics" && <ShowcaseAnalyticsTab />}
            </AdminTabBoundary>
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

      {/* ⌘+K / Ctrl+K · admin command palette · global navigator */}
      <AdminCommandPalette
        tabs={visibleTabs}
        onPickTab={(id) => setTab(id)}
        currentTab={tab}
        logout={logout}
      />
    </div>
  );
}
