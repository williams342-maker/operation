import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  fetchAdminMe,
  fetchAdminApplications,
  fetchAdminCustomOrders,
  fetchAdminOrders,
  fetchAdminAnalytics,
  fetchAdminCommunityUsers,
  adminPatchProduct,
  adminDeleteProduct,
  adminCreateReview,
  adminDeleteReview,
  decideMakerApplication,
  quoteCustomOrder,
  fetchProducts,
  fetchMakers,
  fetchReviews,
} from "../lib/api";

const TABS = [
  { id: "analytics", label: "Analytics" },
  { id: "applications", label: "Applications" },
  { id: "custom", label: "Custom Orders" },
  { id: "orders", label: "Paid Orders" },
  { id: "listings", label: "Listings" },
  { id: "users", label: "Users" },
  { id: "reviews", label: "Reviews" },
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

        {tab === "analytics" && <AnalyticsTab />}
        {tab === "applications" && (
          <ApplicationsList items={apps} onChange={refresh} />
        )}
        {tab === "custom" && <CustomOrdersList items={custom} onChange={refresh} />}
        {tab === "orders" && <PaidOrdersList items={orders} />}
        {tab === "listings" && <ListingsTab />}
        {tab === "users" && <UsersTab />}
        {tab === "reviews" && <ReviewsTab />}
      </div>
    </div>
  );
}

// ===================== ANALYTICS =====================
function AnalyticsTab() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetchAdminAnalytics().then(setData).catch(() => setData(null));
  }, []);
  if (!data) {
    return <p className="font-mono text-sm text-[#a3a3a3]" data-testid="analytics-loading">Loading…</p>;
  }
  return (
    <div className="space-y-8" data-testid="analytics-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="GMV (all-time)" value={`$${data.gmv.toFixed(0)}`} testId="an-gmv" />
        <Stat label="GMV · 30d" value={`$${data.gmv_30d.toFixed(0)}`} testId="an-gmv-30" />
        <Stat label="GMV · 7d" value={`$${data.gmv_7d.toFixed(0)}`} testId="an-gmv-7" />
        <Stat label="Avg Order" value={`$${data.avg_order.toFixed(0)}`} testId="an-avg-order" />
        <Stat label="Paid Orders" value={data.paid_orders} testId="an-orders" />
        <Stat label="Community" value={data.community_users} testId="an-users" />
        <Stat label="Showcase" value={data.showcase_posts} testId="an-showcase" />
        <Stat label="Forum" value={data.forum_threads} testId="an-forum" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-display text-2xl mb-4">Top Products</h3>
          {!data.top_products.length ? (
            <p className="font-mono text-xs text-[#a3a3a3]">No paid orders yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="an-top-products">
              {data.top_products.map((p) => (
                <li key={p.slug} className="border border-[#262626] p-3 flex justify-between items-center">
                  <div>
                    <div className="font-display text-base">{p.title}</div>
                    <div className="font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.22em]">
                      by {p.maker_slug}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-xl text-[#ff4500]">${p.revenue.toFixed(0)}</div>
                    <div className="font-mono text-[10px] text-[#525252]">{p.units} sold</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="font-display text-2xl mb-4">Top Makers</h3>
          {!data.top_makers.length ? (
            <p className="font-mono text-xs text-[#a3a3a3]">No paid orders yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="an-top-makers">
              {data.top_makers.map((m) => (
                <li key={m.slug} className="border border-[#262626] p-3 flex justify-between items-center">
                  <div className="font-display text-base">{m.name}</div>
                  <div className="font-display text-xl text-[#ff4500]">${m.revenue.toFixed(0)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-6 border-t border-[#262626]">
        <Stat label="Pending Apps" value={data.applications_pending} testId="an-pending-apps" />
        <Stat label="Open Briefs" value={data.custom_orders_open} testId="an-pending-custom" />
        <Stat label="Listings" value={data.products_count} testId="an-listings" />
        <Stat label="Files" value={data.design_files} testId="an-files" />
      </div>
    </div>
  );
}

// ===================== LISTINGS =====================
function ListingsTab() {
  const [products, setProducts] = useState([]);
  const refresh = () => fetchProducts().then(setProducts);
  useEffect(() => { refresh(); }, []);
  return (
    <div data-testid="listings-tab" className="space-y-3">
      {products.map((p) => (
        <ListingRow key={p.slug} p={p} onChange={refresh} />
      ))}
    </div>
  );
}

function ListingRow({ p, onChange }) {
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState(p.in_stock);
  const toggleFeatured = async () => {
    setBusy(true);
    try { await adminPatchProduct(p.slug, { featured: !p.featured }); onChange(); }
    finally { setBusy(false); }
  };
  const saveStock = async () => {
    setBusy(true);
    try { await adminPatchProduct(p.slug, { in_stock: parseInt(stock || 0, 10) }); onChange(); }
    finally { setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm(`Delete listing "${p.title}"? This can't be undone.`)) return;
    setBusy(true);
    try { await adminDeleteProduct(p.slug); onChange(); }
    finally { setBusy(false); }
  };
  return (
    <div
      className={`border ${p.featured ? "border-[#ff4500]/40" : "border-[#262626]"} hover:border-[#ff4500] transition p-4 flex flex-col md:flex-row md:items-center gap-4`}
      data-testid={`listing-${p.slug}`}
    >
      <img src={p.images?.[0]} alt="" className="w-full md:w-24 h-24 object-cover" />
      <div className="flex-1 min-w-0">
        <div className="font-display text-xl truncate">{p.title}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1">
          {p.category} · {p.technique} · by {p.maker_slug}
          {p.model_url && <span className="text-[#ff4500] ml-2">· 3D</span>}
        </div>
        <div className="font-display text-2xl text-[#ff4500] mt-2">${p.price.toFixed(0)}</div>
      </div>
      <div className="flex flex-col gap-2 md:items-end">
        <button
          onClick={toggleFeatured}
          disabled={busy}
          className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border transition disabled:opacity-50 ${
            p.featured ? "border-[#ff4500] text-[#ff4500]" : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]"
          }`}
          data-testid={`listing-featured-${p.slug}`}
        >
          {p.featured ? "★ Featured" : "☆ Feature"}
        </button>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            min="0"
            className="w-16 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-2 py-1 font-mono text-[11px]"
            data-testid={`listing-stock-${p.slug}`}
          />
          <button
            onClick={saveStock}
            disabled={busy || stock === p.in_stock}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] disabled:opacity-50"
            data-testid={`listing-stock-save-${p.slug}`}
          >
            save
          </button>
        </div>
        <button
          onClick={del}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-200 disabled:opacity-50"
          data-testid={`listing-delete-${p.slug}`}
        >
          ⊗ delete
        </button>
      </div>
    </div>
  );
}

// ===================== USERS =====================
function UsersTab() {
  const [users, setUsers] = useState([]);
  useEffect(() => { fetchAdminCommunityUsers().then(setUsers); }, []);
  if (!users.length) {
    return <p className="font-mono text-sm text-[#a3a3a3]" data-testid="users-empty">No community signups yet.</p>;
  }
  return (
    <div data-testid="users-tab" className="space-y-2">
      <p className="font-mono text-xs text-[#a3a3a3] mb-3">{users.length} community members</p>
      {users.map((u) => (
        <div
          key={u.user_id}
          className="border border-[#262626] hover:border-[#ff4500] transition p-3 flex items-center gap-3"
          data-testid={`user-${u.user_id}`}
        >
          {u.picture ? (
            <img src={u.picture} alt="" className="w-10 h-10 rounded-full object-cover border border-[#262626]" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#121212] border border-[#262626] flex items-center justify-center font-mono text-xs text-[#a3a3a3]">
              {(u.name || u.email)[0]?.toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-display text-base truncate">{u.name || u.email.split("@")[0]}</div>
            <a href={`mailto:${u.email}`} className="font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.22em] hover:text-[#ff4500]">
              {u.email}
            </a>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] text-right">
            <div>joined {(u.created_at || "").slice(0, 10)}</div>
            <div>last seen {(u.last_seen || u.created_at || "").slice(0, 10)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===================== REVIEWS =====================
function ReviewsTab() {
  const [reviews, setReviews] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const refresh = () => fetchReviews().then(setReviews);
  useEffect(() => { refresh(); }, []);
  return (
    <div data-testid="reviews-tab" className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="font-mono text-xs text-[#a3a3a3]">{reviews.length} reviews</p>
        <button onClick={() => setShowNew((s) => !s)} className="btn-industrial btn-primary inline-flex" data-testid="reviews-new-btn">
          {showNew ? "Cancel" : "+ Add review"}
        </button>
      </div>
      {showNew && <NewReviewForm onSaved={() => { setShowNew(false); refresh(); }} />}
      {reviews.map((r) => (
        <div key={r.id} className="border border-[#262626] p-4" data-testid={`review-${r.id}`}>
          <div className="flex justify-between items-baseline">
            <div>
              <div className="font-display text-lg">{r.name}</div>
              <div className="font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.22em]">
                {r.location} · {"★".repeat(r.rating)}
              </div>
            </div>
            <button
              onClick={async () => {
                if (window.confirm("Delete this review?")) {
                  await adminDeleteReview(r.id);
                  refresh();
                }
              }}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-200"
              data-testid={`review-delete-${r.id}`}
            >
              ⊗ delete
            </button>
          </div>
          <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-2">{r.text}</p>
        </div>
      ))}
    </div>
  );
}

function NewReviewForm({ onSaved }) {
  const [r, setR] = useState({ name: "", location: "", rating: 5, text: "", product_slug: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await adminCreateReview({ ...r, rating: parseInt(r.rating, 10) || 5 }); onSaved(); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="border border-[#262626] p-4 grid md:grid-cols-2 gap-3" data-testid="review-new-form">
      <input required placeholder="Reviewer name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-name" />
      <input required placeholder="Location (City, ST)" value={r.location} onChange={(e) => setR({ ...r, location: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-location" />
      <input type="number" min="1" max="5" value={r.rating} onChange={(e) => setR({ ...r, rating: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-rating" />
      <input placeholder="Product slug (optional)" value={r.product_slug} onChange={(e) => setR({ ...r, product_slug: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs" data-testid="review-product" />
      <textarea required rows={3} placeholder="Review text…" value={r.text} onChange={(e) => setR({ ...r, text: e.target.value })}
                className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                data-testid="review-text" />
      <button type="submit" disabled={busy} className="btn-industrial btn-primary md:col-span-2 disabled:opacity-50" data-testid="review-submit">
        {busy ? "Saving…" : "Add review →"}
      </button>
    </form>
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
