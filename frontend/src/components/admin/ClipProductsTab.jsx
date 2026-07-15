import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { adminFetchClipProductLinks, adminRemoveClipProductLink } from "../../lib/api";

function money(v) {
  const n = Number(v || 0);
  return `$${n.toFixed(n % 1 ? 2 : 0)}`;
}

export default function ClipProductsTab() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  const refresh = useCallback(async () => {
    setRows(null);
    try {
      const r = await adminFetchClipProductLinks();
      setRows(r.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load clip product links.");
      setRows([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const remove = async (clipId, productSlug) => {
    if (!window.confirm("Remove this product from the clip?")) return;
    setBusy(`${clipId}:${productSlug}`);
    try {
      await adminRemoveClipProductLink(clipId, productSlug);
      toast.success("Product link removed.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't remove product link.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-clip-products-tab">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2">Clip moderation</div>
          <h1 className="font-display text-3xl md:text-5xl uppercase leading-none">Clip Products</h1>
          <p className="font-mono text-sm text-ink-muted mt-2 max-w-3xl">
            Review shoppable product links attached to clips, remove invalid links, and inspect recent edit history.
          </p>
        </div>
        <button onClick={refresh} className="btn-industrial btn-secondary text-xs inline-flex items-center gap-2">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {rows === null ? (
        <p className="font-mono text-sm text-ink-muted">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="font-mono text-sm text-ink-muted" data-testid="admin-clip-products-empty">No clips found.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((clip) => (
            <section key={clip.id} className="border border-line p-4" data-testid={`admin-clip-products-${clip.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3 mb-3">
                <div className="min-w-0">
                  <div className="font-display text-2xl leading-tight truncate">{clip.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted mt-1">
                    @{clip.maker_slug || "workshop"} ? {clip.visibility || "public"} ? Last edited {clip.last_edited_at ? new Date(clip.last_edited_at).toLocaleString() : "never"}
                  </div>
                </div>
                <Link to={`/clips/${clip.slug}`} target="_blank" className="px-2.5 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1">
                  <ExternalLink size={12} /> Open
                </Link>
              </div>

              {clip.linked_products?.length ? (
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {clip.linked_products.map((p) => (
                    <div key={p.slug} className="border border-line p-2 grid grid-cols-[56px_1fr_auto] gap-3 items-center" data-testid={`admin-clip-product-${clip.id}-${p.slug}`}>
                      {p.image ? <img src={p.image} alt="" className="w-14 h-14 object-cover" /> : <div className="w-14 h-14 bg-surface" />}
                      <div className="min-w-0">
                        <div className="font-mono text-xs truncate">{p.title}</div>
                        <div className="font-mono text-[10px] text-ink-muted">{money(p.price)} ? {p.stock_status}</div>
                        {p.is_featured && <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-brand">Featured</div>}
                      </div>
                      <button
                        onClick={() => remove(clip.id, p.slug)}
                        disabled={busy === `${clip.id}:${p.slug}`}
                        className="w-8 h-8 border border-line hover:border-red-500 hover:text-red-400 grid place-items-center disabled:opacity-50"
                        aria-label="Remove product link"
                        data-testid={`admin-remove-clip-product-${clip.id}-${p.slug}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="font-mono text-xs text-ink-muted">No linked products.</p>
              )}

              {clip.edit_history?.length > 0 && (
                <details className="mt-3 border-t border-line pt-3">
                  <summary className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted cursor-pointer">Recent edit history</summary>
                  <div className="mt-2 space-y-1">
                    {clip.edit_history.map((h) => (
                      <div key={h.id} className="font-mono text-[10px] text-ink-muted">
                        {new Date(h.created_at).toLocaleString()} ? {h.actor} ? {h.action}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
