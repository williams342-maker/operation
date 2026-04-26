import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  fetchAdminMe,
  fetchAdminApplications,
  fetchAdminCustomOrders,
  fetchAdminOrders,
  decideMakerApplication,
  quoteCustomOrder,
} from "../lib/api";

const TABS = [
  { id: "applications", label: "Applications" },
  { id: "custom", label: "Custom Orders" },
  { id: "orders", label: "Paid Orders" },
];

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

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
          className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10 pb-6 border-b border-[#262626]"
        >
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
              ◆ Admin Console · {me?.email}
            </div>
            <h1 className="font-display text-[44px] md:text-[72px] leading-[0.9] uppercase">
              Operations.
            </h1>
          </div>
          <button
            onClick={logout}
            className="self-start md:self-auto px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
            data-testid="admin-logout-btn"
          >
            Sign Out
          </button>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-10">
          <Stat label="Pending Apps" value={pendingApps} testId="stat-pending-apps" />
          <Stat label="Open Briefs" value={pendingCustom} testId="stat-pending-custom" />
          <Stat label="Paid Orders" value={orders.length} testId="stat-paid-orders" />
          <Stat label="Revenue" value={`$${totalRevenue.toFixed(0)}`} testId="stat-revenue" />
        </div>

        <div className="flex border-b border-[#262626] mb-8 overflow-x-auto" data-testid="admin-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] border-b-2 transition whitespace-nowrap ${
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

        {tab === "applications" && (
          <ApplicationsList items={apps} onChange={refresh} />
        )}
        {tab === "custom" && <CustomOrdersList items={custom} onChange={refresh} />}
        {tab === "orders" && <PaidOrdersList items={orders} />}
      </div>
    </div>
  );
}

const Stat = ({ label, value, testId }) => (
  <div className="border border-[#262626] p-4 md:p-6" data-testid={testId}>
    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</div>
    <div className="font-display text-3xl md:text-5xl mt-2 text-[#e5e5e5]">{value}</div>
  </div>
);

function ApplicationsList({ items, onChange }) {
  if (!items.length) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="apps-empty">
        No applications yet.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="apps-list">
      {items.map((a) => (
        <ApplicationRow key={a.id} app={a} onChange={onChange} />
      ))}
    </div>
  );
}

function ApplicationRow({ app, onChange }) {
  const [note, setNote] = useState(app.note || "");
  const [busy, setBusy] = useState(false);
  const decided = app.status === "approved" || app.status === "rejected";
  const decide = async (approved) => {
    setBusy(true);
    try {
      await decideMakerApplication(app.id, { approved, note });
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="border border-[#262626] hover:border-[#ff4500] transition p-5"
      data-testid={`app-${app.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-[#262626]">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ {app.status ? `Decided · ${app.status}` : "Pending"} · {formatDate(app.created_at)}
          </div>
          <div className="font-display text-2xl mt-1">{app.studio_name}</div>
          <div className="font-mono text-xs text-[#a3a3a3] mt-1">
            {app.name} · {app.location} ·{" "}
            <a href={`mailto:${app.email}`} className="underline hover:text-[#ff4500]">
              {app.email}
            </a>
          </div>
          {app.techniques?.length ? (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-2">
              {app.techniques.join(" · ")}
            </div>
          ) : null}
          {app.portfolio_url ? (
            <div className="font-mono text-[10px] mt-1">
              <a
                href={app.portfolio_url}
                target="_blank"
                rel="noreferrer"
                className="text-[#ff4500] hover:underline"
              >
                Portfolio ↗
              </a>
            </div>
          ) : null}
        </div>
      </div>
      <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-3">{app.about}</p>

      {!decided && (
        <div className="mt-4 space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional note (sent to applicant)"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`app-note-${app.id}`}
          />
          <div className="flex gap-3">
            <button
              onClick={() => decide(true)}
              disabled={busy}
              className="btn-industrial btn-primary disabled:opacity-50"
              data-testid={`app-approve-${app.id}`}
            >
              Approve
            </button>
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="px-5 py-3 border border-[#262626] hover:border-red-500 hover:text-red-400 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid={`app-reject-${app.id}`}
            >
              Reject
            </button>
          </div>
        </div>
      )}
      {decided && app.note && (
        <div className="mt-3 font-mono text-xs text-[#a3a3a3] border-l-2 border-[#ff4500] pl-3">
          {app.note}
        </div>
      )}
    </div>
  );
}

function CustomOrdersList({ items, onChange }) {
  if (!items.length) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="custom-empty">
        No custom briefs yet.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="custom-list">
      {items.map((c) => (
        <CustomOrderRow key={c.id} order={c} onChange={onChange} />
      ))}
    </div>
  );
}

function CustomOrderRow({ order, onChange }) {
  const [quote, setQuote] = useState(order.quote || "");
  const [message, setMessage] = useState(order.quote_note || "");
  const [busy, setBusy] = useState(false);
  const submitQuote = async () => {
    if (!quote || isNaN(Number(quote))) return;
    setBusy(true);
    try {
      await quoteCustomOrder(order.id, { quote: Number(quote), message });
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="border border-[#262626] hover:border-[#ff4500] transition p-5"
      data-testid={`custom-${order.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-[#262626]">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ {order.status === "quoted" ? `Quoted · $${order.quote}` : "Open"} · {formatDate(order.created_at)}
          </div>
          <div className="font-display text-2xl mt-1">{order.project_type}</div>
          <div className="font-mono text-xs text-[#a3a3a3] mt-1">
            {order.name} ·{" "}
            <a href={`mailto:${order.email}`} className="underline hover:text-[#ff4500]">
              {order.email}
            </a>{" "}
            {order.phone ? `· ${order.phone}` : ""}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-2">
            {order.material} · {order.size || "size n/a"} · {order.budget || "budget n/a"}
          </div>
        </div>
      </div>
      <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-3">{order.description}</p>

      <div className="mt-4 grid md:grid-cols-3 gap-3 items-start">
        <input
          type="number"
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          placeholder="Quote ($)"
          min="0"
          step="0.01"
          className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
          data-testid={`custom-quote-${order.id}`}
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder="Optional message to buyer"
          className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
          data-testid={`custom-msg-${order.id}`}
        />
      </div>
      <button
        onClick={submitQuote}
        disabled={busy || !quote}
        className="btn-industrial btn-primary mt-3 disabled:opacity-50"
        data-testid={`custom-send-quote-${order.id}`}
      >
        {order.status === "quoted" ? "Re-Send Quote" : "Send Quote"}
      </button>
    </div>
  );
}

function PaidOrdersList({ items }) {
  if (!items.length) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="orders-empty-admin">
        No paid orders yet.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="orders-list-admin">
      {items.map((o) => (
        <div
          key={o.session_id}
          className="border border-[#262626] hover:border-[#ff4500] transition p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
          data-testid={`paid-order-${o.session_id}`}
        >
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
              ◆ Paid · {formatDate(o.created_at)}
            </div>
            <div className="font-mono text-xs text-[#e5e5e5] mt-1">{o.summary}</div>
            <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">
              {o.customer_email || "no buyer email"} ·{" "}
              <span className="text-[#525252]">{o.session_id?.slice(0, 16)}…</span>
            </div>
          </div>
          <div className="font-display text-3xl text-[#ff4500]">${(o.amount || 0).toFixed(2)}</div>
        </div>
      ))}
    </div>
  );
}
