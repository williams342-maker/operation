import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  fetchMakerMe,
  fetchMakerOrders,
  fetchMakerProducts,
  fetchMakerPayouts,
  stripeConnectOnboard,
  stripeConnectStatus,
  stripeConnectDashboardLink,
  createMakerProduct,
  deleteMakerProduct,
  restoreMakerProduct,
  updateMakerProduct,
  updateMakerProfile,
} from "../lib/api";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "products", label: "Listings" },
  { id: "orders", label: "Orders" },
  { id: "payouts", label: "Payouts" },
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

function ProductsList({ products, onChanged }) {
  const [creating, setCreating] = useState(false);
  // Show deleted listings together but visually muted, with restore option.
  const live = products.filter((p) => !p.deleted_at);
  const removed = products.filter((p) => p.deleted_at);

  return (
    <div className="space-y-8" data-testid="products-list">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          ◆ {live.length} active{removed.length > 0 ? ` · ${removed.length} archived` : ""}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="btn-industrial btn-primary"
          data-testid="new-listing-btn"
        >
          + New Listing
        </button>
      </div>

      {live.length === 0 && removed.length === 0 ? (
        <p
          className="font-mono text-sm text-[#a3a3a3]"
          data-testid="products-empty"
        >
          No listings yet — click <span className="text-[#ff4500]">+ New Listing</span> to add your first piece.
        </p>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {live.map((p) => (
            <ProductEditCard key={p.id} product={p} onChanged={onChanged} />
          ))}
          {removed.map((p) => (
            <ProductEditCard key={p.id} product={p} onChanged={onChanged} archived />
          ))}
        </div>
      )}

      {creating && (
        <NewListingModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onChanged && onChanged();
          }}
        />
      )}
    </div>
  );
}

function ProductEditCard({ product, archived = false, onChanged }) {
  const [p, setP] = useState(product);
  const [open, setOpen] = useState(false);
  const [modelUrl, setModelUrl] = useState(product.model_url || "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await updateMakerProduct(p.slug, { model_url: modelUrl.trim() });
      setP(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm(`Delete "${p.title}"? It hides from the shop instantly. Order history stays intact and you can restore it anytime.`)) return;
    setRemoving(true);
    try {
      await deleteMakerProduct(p.slug);
      onChanged && onChanged();
    } finally {
      setRemoving(false);
    }
  };

  const onRestore = async () => {
    setRemoving(true);
    try {
      await restoreMakerProduct(p.slug);
      onChanged && onChanged();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className={`border border-[#262626] transition group ${archived ? "opacity-60" : "hover:border-[#ff4500]"}`}
      data-testid={`product-edit-${p.slug}`}
    >
      <div className="aspect-square overflow-hidden bg-[#121212] relative">
        {p.images?.[0] && (
          <img
            src={p.images[0]}
            alt={p.title}
            className={`w-full h-full object-cover ${archived ? "" : "group-hover:scale-[1.03]"} transition duration-700`}
          />
        )}
        {archived && (
          <div className="absolute top-3 left-3 bg-black/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 border border-red-400/40">
            ◇ Archived
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          {p.category} · {p.technique}
          {p.model_url && <span className="text-[#ff4500] ml-2">· 3D</span>}
        </div>
        <div className="font-display text-xl mt-2 leading-tight">{p.title}</div>
        <div className="flex items-center justify-between mt-3">
          <span className="font-display text-2xl text-[#ff4500]">${p.price.toFixed(0)}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            {p.in_stock} in stock
          </span>
        </div>

        {archived ? (
          <button
            onClick={onRestore}
            disabled={removing}
            className="mt-3 w-full font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400 hover:text-emerald-300 border-t border-[#262626] pt-3 text-left disabled:opacity-50"
            data-testid={`product-restore-${p.slug}`}
          >
            {removing ? "Restoring…" : "↩ Restore listing"}
          </button>
        ) : (
          <>
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-3 w-full font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] border-t border-[#262626] pt-3 text-left"
              data-testid={`product-toggle-edit-${p.slug}`}
            >
              {open ? "− Close 3D editor" : "+ Add / edit 3D model URL"}
            </button>
            {open && (
              <form onSubmit={save} className="mt-3 space-y-2" data-testid={`product-edit-form-${p.slug}`}>
                <input
                  type="url"
                  value={modelUrl}
                  onChange={(e) => setModelUrl(e.target.value)}
                  placeholder="https://…/model.glb"
                  className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-[11px] text-[#e5e5e5]"
                  data-testid={`product-model-url-${p.slug}`}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-industrial btn-primary disabled:opacity-50 text-xs"
                    data-testid={`product-save-${p.slug}`}
                  >
                    {busy ? "Saving…" : "Save"}
                  </button>
                  {saved && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]" data-testid={`product-saved-${p.slug}`}>
                      ✓ Saved
                    </span>
                  )}
                  {p.model_url && (
                    <a
                      href={`/shop/${p.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] ml-auto"
                    >
                      Preview ↗
                    </a>
                  )}
                </div>
                <p className="font-mono text-[10px] text-[#525252] leading-relaxed">
                  Paste a public .glb / .gltf URL. Buyers see a 3D viewer button on this product.
                </p>
              </form>
            )}
            <button
              onClick={onDelete}
              disabled={removing}
              className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-red-400 transition disabled:opacity-50"
              data-testid={`product-delete-${p.slug}`}
            >
              {removing ? "Deleting…" : "⊗ Delete listing"}
            </button>
          </>
        )}
      </div>
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


function PayoutsTab() {
  const [status, setStatus] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const loadAll = async () => {
    try {
      const [s, p] = await Promise.all([stripeConnectStatus(), fetchMakerPayouts()]);
      setStatus(s);
      setPayouts(p);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load payouts info.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const onConnect = async () => {
    setBusy("connect"); setErr("");
    try {
      const r = await stripeConnectOnboard(window.location.origin);
      window.location.href = r.url;
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not start onboarding.");
      setBusy("");
    }
  };

  const onDashboard = async () => {
    setBusy("dashboard"); setErr("");
    try {
      const r = await stripeConnectDashboardLink();
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not open Stripe dashboard.");
    } finally { setBusy(""); }
  };

  if (loading) {
    return (
      <div className="font-mono text-xs text-[#a3a3a3]" data-testid="payouts-loading">
        Loading payouts…
      </div>
    );
  }

  const ready = status?.connected && status?.charges_enabled && status?.payouts_enabled;
  const incomplete = status?.connected && !ready;

  return (
    <div className="space-y-8" data-testid="payouts-tab">
      {/* Connect status card */}
      <div className="border border-[#262626] p-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
          ◆ Stripe Connect
        </div>
        {!status?.connected && (
          <>
            <h3 className="font-display text-2xl mb-2 uppercase">Get paid directly.</h3>
            <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mb-5 max-w-xl">
              Connect a Stripe account so each sale routes straight to your bank.
              Crafters Market keeps a 10% platform fee; you keep the rest.
              Onboarding takes about 5 minutes — Stripe handles ID verification and bank setup.
            </p>
            <button
              onClick={onConnect}
              disabled={busy === "connect"}
              className="btn-industrial btn-primary inline-flex disabled:opacity-50"
              data-testid="payouts-connect-btn"
            >
              {busy === "connect" ? "Redirecting…" : "Connect Stripe →"}
            </button>
          </>
        )}
        {ready && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-400">
                Connected · payouts active
              </span>
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] mb-5">
              Stripe account: <span className="text-[#e5e5e5]">{status.stripe_account_id}</span>
            </p>
            <button
              onClick={onDashboard}
              disabled={busy === "dashboard"}
              className="btn-industrial inline-flex border border-[#262626] hover:border-[#ff4500] disabled:opacity-50"
              data-testid="payouts-dashboard-btn"
            >
              {busy === "dashboard" ? "Opening…" : "Open Stripe dashboard ↗"}
            </button>
          </>
        )}
        {incomplete && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-yellow-400">
                Onboarding incomplete
              </span>
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] mb-5 max-w-xl">
              Stripe needs a few more details before payouts can be enabled.
              Charges enabled: {String(status.charges_enabled)} · Payouts enabled:{" "}
              {String(status.payouts_enabled)} · Details submitted:{" "}
              {String(status.details_submitted)}.
            </p>
            <button
              onClick={onConnect}
              disabled={busy === "connect"}
              className="btn-industrial btn-primary inline-flex disabled:opacity-50"
              data-testid="payouts-resume-btn"
            >
              {busy === "connect" ? "Redirecting…" : "Continue onboarding →"}
            </button>
          </>
        )}
        {err && <p className="mt-4 font-mono text-[11px] text-red-400">{err}</p>}
      </div>

      {/* Payout history */}
      <div className="border border-[#262626] p-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-4">
          ◆ Payout history
        </div>
        {payouts.length === 0 ? (
          <p className="font-mono text-xs text-[#525252]">
            No payouts yet. Each paid order will transfer your share automatically once your
            account is fully onboarded.
          </p>
        ) : (
          <ul className="divide-y divide-[#262626]" data-testid="payouts-history">
            {payouts.map((p) => (
              <li
                key={`${p.session_id}-${p.maker_slug}`}
                className="py-3 flex items-center justify-between gap-4"
                data-testid="payout-row"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs text-[#e5e5e5] truncate">
                    {p.session_id}
                  </div>
                  <div className="font-mono text-[10px] text-[#a3a3a3] mt-1 uppercase tracking-[0.18em]">
                    {p.status}
                    {p.reason ? ` · ${p.reason}` : ""}
                    {p.transfer_id ? ` · ${p.transfer_id}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl text-[#e5e5e5]">
                    ${(Number(p.amount_cents || 0) / 100).toFixed(2)}
                  </div>
                  <div className="font-mono text-[10px] text-[#525252]">
                    of ${Number(p.amount || 0).toFixed(2)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}


// ===================== NEW LISTING MODAL =====================
const CATEGORIES = ["Wall Art", "Custom Signs", "Outdoor Art", "Home Decor", "Other"];
const TECHNIQUES = ["PLASMA", "LASER", "ROUTER", "CUSTOM"];
const MAX_IMG_W = 1600;
const MAX_IMG_KB = 130;       // target after compression
const MAX_IMAGES = 5;

/**
 * Compress an image File → data URL. Tries WebP first (much smaller for
 * photos), falls back to JPEG when the browser can't encode WebP.
 * Iteratively lowers quality until the result is below MAX_IMG_KB.
 */
function compressImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMG_W / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        const tryEncode = (mime, q) => canvas.toDataURL(mime, q);
        let mime = "image/webp";
        let dataUrl = tryEncode(mime, 0.86);
        // toDataURL falls back to PNG silently when the mime is unsupported.
        if (!dataUrl.startsWith(`data:${mime}`)) {
          mime = "image/jpeg";
          dataUrl = tryEncode(mime, 0.86);
        }
        // Step quality down if still too large
        let q = 0.86;
        while (dataUrl.length / 1024 > MAX_IMG_KB && q > 0.4) {
          q -= 0.12;
          dataUrl = tryEncode(mime, q);
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function NewListingModal({ onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [technique, setTechnique] = useState(TECHNIQUES[0]);
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState(4);
  const [description, setDescription] = useState("");
  const [materials, setMaterials] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [images, setImages] = useState([]);     // array of data URLs
  const [modelUrl, setModelUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFiles = async (files) => {
    setErr("");
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) {
      setErr("Only image files are accepted (PNG / JPG / WebP).");
      return;
    }
    if (images.length + incoming.length > MAX_IMAGES) {
      setErr(`Maximum ${MAX_IMAGES} images per listing.`);
      return;
    }
    try {
      const compressed = await Promise.all(incoming.map(compressImageToDataUrl));
      setImages((prev) => [...prev, ...compressed].slice(0, MAX_IMAGES));
    } catch (e) {
      setErr(e.message || "Could not process one of the images.");
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const removeImage = (i) =>
    setImages((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!title.trim()) { setErr("Title is required."); return; }
    const priceNum = parseFloat(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setErr("Price must be a non-negative number.");
      return;
    }
    if (!description.trim()) { setErr("Tell buyers a little about this piece."); return; }
    setBusy(true);
    try {
      await createMakerProduct({
        title: title.trim(),
        category, technique,
        price: priceNum,
        in_stock: parseInt(stock, 10) || 0,
        description: description.trim(),
        materials: materials.split(",").map((s) => s.trim()).filter(Boolean),
        dimensions: dimensions.trim() || null,
        images,
        model_url: modelUrl.trim() || null,
      });
      onCreated && onCreated();
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Could not create listing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[100] flex items-start justify-center overflow-y-auto p-4 md:p-12"
      data-testid="new-listing-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={submit}
        className="bg-[#0a0a0a] border border-[#262626] w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#262626] px-6 py-4">
          <h3 className="font-display text-2xl uppercase">New Listing.</h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-[#a3a3a3] hover:text-[#ff4500]"
            data-testid="new-listing-close"
          >
            ✕ Close
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Drag-drop image dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed p-8 text-center cursor-pointer transition ${
              dragOver ? "border-[#ff4500] bg-[#ff4500]/5" : "border-[#262626] hover:border-[#ff4500]"
            }`}
            data-testid="new-listing-dropzone"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              data-testid="new-listing-file-input"
            />
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              ◆ Drop up to {MAX_IMAGES} images, or click to browse
            </div>
            <div className="font-mono text-[10px] text-[#525252] mt-2">
              Auto-compressed to ~120KB each · WebP when supported
            </div>
          </div>

          {images.length > 0 && (
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2" data-testid="new-listing-image-grid">
              {images.map((src, i) => (
                <div key={i} className="relative aspect-square border border-[#262626]">
                  <img src={src} alt={`upload-${i}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 bg-black/80 px-1.5 py-0.5 font-mono text-[9px] uppercase text-red-400 hover:text-red-300 border border-red-400/40"
                    data-testid={`new-listing-remove-${i}`}
                  >
                    ✕
                  </button>
                  {i === 0 && (
                    <div className="absolute bottom-1 left-1 bg-[#ff4500] px-1.5 py-0.5 font-mono text-[9px] uppercase text-black">
                      Primary
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Title + slug auto */}
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={100}
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
                data-testid="new-listing-title"
              />
            </Field>
            <Field label="Price (USD)">
              <input
                type="number"
                step="1"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
                data-testid="new-listing-price"
              />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
                data-testid="new-listing-category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} className="bg-[#0a0a0a]">{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Technique">
              <select
                value={technique}
                onChange={(e) => setTechnique(e.target.value)}
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
                data-testid="new-listing-technique"
              >
                {TECHNIQUES.map((t) => (
                  <option key={t} className="bg-[#0a0a0a]">{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Stock">
              <input
                type="number"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
                data-testid="new-listing-stock"
              />
            </Field>
            <Field label="Dimensions (optional)">
              <input
                value={dimensions}
                onChange={(e) => setDimensions(e.target.value)}
                placeholder='24" × 36" × 0.25"'
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
                data-testid="new-listing-dimensions"
              />
            </Field>
          </div>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5] resize-y"
              data-testid="new-listing-description"
            />
          </Field>

          <Field label="Materials (comma separated)">
            <input
              value={materials}
              onChange={(e) => setMaterials(e.target.value)}
              placeholder="Mild steel, Powder coat, Walnut"
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
              data-testid="new-listing-materials"
            />
          </Field>

          <Field label="3D model URL (optional)">
            <input
              type="url"
              value={modelUrl}
              onChange={(e) => setModelUrl(e.target.value)}
              placeholder="https://…/model.glb"
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
              data-testid="new-listing-model-url"
            />
          </Field>

          {err && (
            <p className="font-mono text-xs text-red-400" data-testid="new-listing-error">{err}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#262626] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
            data-testid="new-listing-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-industrial btn-primary disabled:opacity-50"
            data-testid="new-listing-submit"
          >
            {busy ? "Creating…" : "Publish Listing →"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}
