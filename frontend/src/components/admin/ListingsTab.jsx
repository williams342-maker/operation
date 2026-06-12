import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchProducts, adminPatchProduct, adminDeleteProduct, adminGscRecheck } from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";

// iter108 — One-click OG preview affordance per listing. Operators
// hover/click "↗ Preview" → native <details> drops down 4 deep-links
// straight into the maker's product OG card and the 3 major social
// debuggers. Saves 30s of copy-pasting URLs into validators every
// time we want to spot-check a listing's social preview.
function ogTargets(slug) {
  // Resolve the canonical apex once — every debugger needs a publicly
  // reachable URL, NOT the preview pod, or the validator just times out.
  const SITE = "https://craftersmarket.org";
  const og = `${SITE}/api/og/product/${slug}`;
  const enc = encodeURIComponent(og);
  return {
    og,
    facebook: `https://developers.facebook.com/tools/debug/?q=${enc}`,
    linkedin: `https://www.linkedin.com/post-inspector/inspect/${enc}`,
    twitter:  `https://cards-dev.twitter.com/validator?url=${enc}`,
  };
}

function CrawlerPreviewMenu({ slug }) {
  const t = ogTargets(slug);
  const linkCls =
    "block px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand hover:bg-surface transition";
  return (
    <details className="relative" data-testid={`listing-preview-${slug}`}>
      <summary
        className="list-none cursor-pointer px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border border-line text-ink-muted hover:border-brand hover:text-brand transition"
        data-testid={`listing-preview-toggle-${slug}`}
      >
        ↗ Preview
      </summary>
      <div
        className="absolute right-0 mt-1 z-20 min-w-[220px] border border-line bg-paper shadow-xl"
        data-testid={`listing-preview-menu-${slug}`}
      >
        <a href={t.og} target="_blank" rel="noopener noreferrer" className={linkCls}
           data-testid={`listing-preview-og-${slug}`}>
          ◆ View OG card →
        </a>
        <a href={t.facebook} target="_blank" rel="noopener noreferrer" className={linkCls}
           data-testid={`listing-preview-fb-${slug}`}>
          ◆ Facebook debugger →
        </a>
        <a href={t.linkedin} target="_blank" rel="noopener noreferrer" className={linkCls}
           data-testid={`listing-preview-li-${slug}`}>
          ◆ LinkedIn inspector →
        </a>
        <a href={t.twitter} target="_blank" rel="noopener noreferrer" className={linkCls}
           data-testid={`listing-preview-tw-${slug}`}>
          ◆ Twitter / X validator →
        </a>
      </div>
    </details>
  );
}

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
  const [confirm, confirmModal] = useConfirm();
  // iter276 — Result of the latest "Re-check GSC" click. Kept local so
  // the operator sees the verdict inline without a full list refresh.
  const [gscResult, setGscResult] = useState(null);
  const toggleFeatured = async () => {
    setBusy(true);
    try { await adminPatchProduct(p.slug, { featured: !p.featured }); onChange(); }
    finally { setBusy(false); }
  };
  const recheckGsc = async () => {
    setBusy(true);
    setGscResult(null);
    try {
      const r = await adminGscRecheck(p.slug);
      setGscResult(r);
      if (r.ok) {
        toast.success(`GSC: ${r.tier}${r.coverage ? ` · ${r.coverage}` : ""}`);
      } else {
        toast.error(r.reason || "Re-check failed");
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };
  const saveStock = async () => {
    setBusy(true);
    try { await adminPatchProduct(p.slug, { in_stock: parseInt(stock || 0, 10) }); onChange(); }
    finally { setBusy(false); }
  };
  const del = async () => {
    const ok = await confirm({
      title: "Delete this listing?",
      body: `"${p.title}" will be removed from the shop immediately. This can't be undone — you'll need the maker to relist it.`,
      confirmLabel: "Delete listing",
      tone: "danger",
      testId: `confirm-delete-listing-${p.slug}`,
    });
    if (!ok) return;
    setBusy(true);
    try { await adminDeleteProduct(p.slug); onChange(); }
    finally { setBusy(false); }
  };
  return (
    <>
      {confirmModal}
    <div
      className={`border ${p.featured ? "border-brand/40" : "border-line"} hover:border-brand transition p-4 flex flex-col md:flex-row md:items-center gap-4`}
      data-testid={`listing-${p.slug}`}
    >
      <img src={p.images?.[0]} alt="" className="w-full md:w-24 h-24 object-cover" />
      <div className="flex-1 min-w-0">
        <div className="font-display text-xl truncate">{p.title}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-1">
          {p.category} · {p.technique} · by {p.maker_slug}
          {p.model_url && <span className="text-brand ml-2">· 3D</span>}
        </div>
        <div className="font-display text-2xl text-brand mt-2">${p.price.toFixed(0)}</div>
      </div>
      <div className="flex flex-col gap-2 md:items-end">
        <button
          onClick={toggleFeatured}
          disabled={busy}
          className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border transition disabled:opacity-50 ${
            p.featured ? "border-brand text-brand" : "border-line text-ink-muted hover:border-brand"
          }`}
          data-testid={`listing-featured-${p.slug}`}
        >
          {p.featured ? "★ Featured" : "☆ Feature"}
        </button>
        <CrawlerPreviewMenu slug={p.slug} />
        <button
          onClick={recheckGsc}
          disabled={busy}
          title="Force-refresh Google indexation status for this listing — bypasses the daily cron"
          className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border border-line text-ink-muted hover:border-cyan-500 hover:text-brand transition disabled:opacity-50"
          data-testid={`listing-gsc-recheck-${p.slug}`}
        >
          {busy ? "…" : "↺ GSC re-check"}
        </button>
        {gscResult && (
          <div
            className="text-[9px] font-mono uppercase tracking-[0.18em] text-right"
            style={{
              color: gscResult.tier === "established" ? "#22c55e"
                   : gscResult.tier === "submitted" ? "#f59e0b"
                   : gscResult.tier === "not_in_sitemap" ? "#ef4444"
                   : "#737373",
            }}
            data-testid={`listing-gsc-result-${p.slug}`}
          >
            {gscResult.ok
              ? `${gscResult.tier}${gscResult.coverage ? ` · ${gscResult.coverage}` : ""}`
              : "no result"}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            min="0"
            className="w-16 bg-transparent border border-line focus:border-brand outline-none px-2 py-1 font-mono text-[11px]"
            data-testid={`listing-stock-${p.slug}`}
          />
          <button
            onClick={saveStock}
            disabled={busy || stock === p.in_stock}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand disabled:opacity-50"
            data-testid={`listing-stock-save-${p.slug}`}
          >
            save
          </button>
        </div>
        <button
          onClick={del}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-600 disabled:opacity-50"
          data-testid={`listing-delete-${p.slug}`}
        >
          ⊗ delete
        </button>
      </div>
    </div>
    </>
  );
}

