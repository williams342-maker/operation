import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  fetchMakerMe,
  fetchMakerOrders,
  fetchMakerProducts,
  updateMakerProfile,
} from "../lib/api";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "products", label: "Listings" },
  { id: "orders", label: "Orders" },
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
        {tab === "products" && <ProductsList products={products} />}
        {tab === "orders" && <OrdersList orders={orders} />}
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

function ProfileForm({ maker, onSaved }) {
  const [form, setForm] = useState({
    name: maker.name || "",
    bio: maker.bio || "",
    location: maker.location || "",
    techniques: (maker.techniques || []).join(", "),
    portrait: maker.portrait || "",
    cover: maker.cover || "",
    email: maker.email || "",
  });
  const [status, setStatus] = useState({ kind: "idle", message: "" });

  const change = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ kind: "loading", message: "" });
    try {
      const payload = {
        ...form,
        techniques: form.techniques
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean),
      };
      const updated = await updateMakerProfile(payload);
      onSaved(updated);
      setStatus({ kind: "saved", message: "Profile saved." });
      setTimeout(() => setStatus({ kind: "idle", message: "" }), 2400);
    } catch (e2) {
      setStatus({
        kind: "error",
        message: e2?.response?.data?.detail || "Save failed.",
      });
    }
  };

  return (
    <form onSubmit={submit} className="grid md:grid-cols-2 gap-6" data-testid="profile-form">
      <Field label="Studio name" value={form.name} onChange={change("name")} testId="profile-name" />
      <Field
        label="Contact email"
        value={form.email}
        onChange={change("email")}
        type="email"
        testId="profile-email"
      />
      <Field
        label="Location"
        value={form.location}
        onChange={change("location")}
        testId="profile-location"
      />
      <Field
        label="Techniques (comma-separated)"
        value={form.techniques}
        onChange={change("techniques")}
        testId="profile-techniques"
      />
      <Field
        label="Portrait image URL"
        value={form.portrait}
        onChange={change("portrait")}
        testId="profile-portrait"
        wide
      />
      <Field
        label="Cover image URL"
        value={form.cover}
        onChange={change("cover")}
        testId="profile-cover"
        wide
      />
      <label className="block md:col-span-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          Bio
        </span>
        <textarea
          value={form.bio}
          onChange={change("bio")}
          rows={5}
          className="mt-2 w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5] resize-y transition"
          data-testid="profile-bio"
        />
      </label>

      <div className="md:col-span-2 flex items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={status.kind === "loading"}
          className="btn-industrial btn-primary disabled:opacity-60"
          data-testid="profile-save"
        >
          {status.kind === "loading" ? "Saving…" : "Save Changes"}
        </button>
        {status.kind === "saved" && (
          <span
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500]"
            data-testid="profile-saved-msg"
          >
            ✓ {status.message}
          </span>
        )}
        {status.kind === "error" && (
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-red-400">
            {status.message}
          </span>
        )}
      </div>
    </form>
  );
}

const Field = ({ label, value, onChange, type = "text", testId, wide = false }) => (
  <label className={`block ${wide ? "md:col-span-2" : ""}`}>
    <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
      {label}
    </span>
    <input
      type={type}
      value={value}
      onChange={onChange}
      className="mt-2 w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5] transition"
      data-testid={testId}
    />
  </label>
);

function ProductsList({ products }) {
  if (!products.length) {
    return (
      <p
        className="font-mono text-sm text-[#a3a3a3]"
        data-testid="products-empty"
      >
        No listings yet — your shop is ready for its first piece.
      </p>
    );
  }
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="products-list">
      {products.map((p) => (
        <div key={p.id} className="border border-[#262626] hover:border-[#ff4500] transition group">
          <div className="aspect-square overflow-hidden bg-[#121212]">
            {p.images?.[0] && (
              <img
                src={p.images[0]}
                alt={p.title}
                className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-700"
              />
            )}
          </div>
          <div className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              {p.category} · {p.technique}
            </div>
            <div className="font-display text-xl mt-2 leading-tight">{p.title}</div>
            <div className="flex items-center justify-between mt-3">
              <span className="font-display text-2xl text-[#ff4500]">${p.price.toFixed(0)}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                {p.in_stock} in stock
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrdersList({ orders }) {
  if (!orders.length) {
    return (
      <p
        className="font-mono text-sm text-[#a3a3a3]"
        data-testid="orders-empty"
      >
        No paid orders yet. When a buyer checks out one of your pieces, it'll show up here.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="orders-list">
      {orders.map((o) => (
        <div
          key={o.session_id}
          className="border border-[#262626] hover:border-[#ff4500] transition p-5"
          data-testid={`order-${o.session_id}`}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pb-3 border-b border-[#262626]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
                ◆ Paid · {formatDate(o.created_at)}
              </div>
              <div className="font-mono text-xs text-[#a3a3a3] mt-1">
                {o.buyer_email ? (
                  <>
                    Buyer:{" "}
                    <a href={`mailto:${o.buyer_email}`} className="text-[#e5e5e5] underline">
                      {o.buyer_email}
                    </a>
                  </>
                ) : (
                  "Buyer email not provided"
                )}
              </div>
            </div>
            <div className="font-display text-3xl text-[#ff4500]">
              ${o.maker_subtotal.toFixed(2)}
            </div>
          </div>
          <ul className="mt-3 space-y-1">
            {o.items.map((it) => (
              <li
                key={it.product_slug}
                className="flex justify-between font-mono text-xs text-[#e5e5e5]"
              >
                <span>
                  {it.title} <span className="text-[#525252]">× {it.quantity}</span>
                </span>
                <span className="text-[#a3a3a3]">${it.subtotal.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
