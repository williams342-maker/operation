import React, { useEffect, useState } from "react";
import { fetchProducts, adminPatchProduct, adminDeleteProduct } from "../../lib/api";

// ===================== LISTINGS =====================
export default function ListingsTab() {
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

