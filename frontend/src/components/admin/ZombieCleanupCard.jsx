/**
 * iter317a — Admin "Zombie cleanup" card.
 *
 * Lists products that would fail external catalog-feed validation
 * (Pinterest / Google / Meta) — missing image, $0 price, no title,
 * etc. — so the operator can soft-delete them in one click.
 *
 * Backed by `/api/admin/products/incomplete` + the soft-delete /
 * restore endpoints introduced in iter295.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ISSUE_LABELS = {
  no_title: "No title",
  no_description: "No description",
  zero_price: "Price = $0",
  invalid_price: "Bad price",
  no_images: "No image",
};

export default function ZombieCleanupCard() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState({});

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const jwt = localStorage.getItem("cm_admin_jwt") || "";
      const r = await axios.get(`${API}/admin/products/incomplete`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      setItems(r.data?.items || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load zombie list.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const softDelete = async (slug, reason) => {
    if (!window.confirm(`Soft-delete "${slug}"? It will be hidden from all public surfaces but can be restored.`)) return;
    setBusy((p) => ({ ...p, [slug]: true }));
    try {
      const jwt = localStorage.getItem("cm_admin_jwt") || "";
      await axios.post(
        `${API}/admin/products/${encodeURIComponent(slug)}/soft-delete`,
        { reason },
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
      toast.success(`Soft-deleted ${slug}`);
      setItems((p) => p.filter((it) => it.slug !== slug));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Soft-delete failed.");
    } finally {
      setBusy((p) => ({ ...p, [slug]: false }));
    }
  };

  if (loading) {
    return (
      <div data-testid="zombie-card-loading" className="font-mono text-xs text-[#a3a3a3] py-3">
        Loading zombie list…
      </div>
    );
  }
  if (err) {
    return (
      <div data-testid="zombie-card-err" className="font-mono text-xs text-red-400 py-3">
        {err}
      </div>
    );
  }

  return (
    <section className="border border-[#262626] p-5 md:p-6 space-y-4" data-testid="zombie-cleanup-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-amber-400">
            ◆ Zombie cleanup · {items.length} listing{items.length === 1 ? "" : "s"} with issues
          </div>
          <h3 className="font-display text-xl uppercase mt-1">Catalog hygiene</h3>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 border border-[#262626] hover:border-amber-400 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-amber-300 transition"
          data-testid="zombie-refresh"
        >
          ↻ Refresh
        </button>
      </div>
      <p className="font-mono text-xs text-[#a3a3a3] max-w-3xl leading-relaxed">
        Live products that would fail external catalog-feed validation (missing image, $0 price, empty title or description).
        Soft-delete hides them from every public surface — catalog feeds, search, maker profile — but keeps the row for audit.
        Use <span className="text-emerald-400">Restore</span> from the maker dashboard if a soft-deleted listing comes back to life.
      </p>

      {items.length === 0 ? (
        <p className="font-mono text-xs text-emerald-400 py-2" data-testid="zombie-empty">
          ✓ All published listings have title, description, price &gt; 0, and at least one image. Nothing to clean up.
        </p>
      ) : (
        <div className="border border-[#1f1f1f] overflow-x-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="bg-[#0d0d0d] text-[#a3a3a3] uppercase tracking-[0.18em] text-[10px]">
              <tr>
                <th className="text-left px-3 py-2.5">Listing</th>
                <th className="text-left px-3 py-2.5">Maker</th>
                <th className="text-left px-3 py-2.5">Issues</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-right px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1a1a]">
              {items.slice(0, 200).map((it) => (
                <tr key={it.slug} className="hover:bg-[#0d0d0d] transition" data-testid={`zombie-row-${it.slug}`}>
                  <td className="px-3 py-2.5">
                    <div className="text-[#fafafa] truncate max-w-[280px]">{it.title}</div>
                    <a
                      href={`/shop/${it.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#525252] hover:text-[#ff4500] transition text-[10px]"
                    >
                      /{it.slug}
                    </a>
                  </td>
                  <td className="px-3 py-2.5 text-[#a3a3a3]">{it.maker_slug || "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {it.issues.map((iss) => (
                        <span
                          key={iss}
                          className="px-2 py-0.5 border border-amber-500/30 text-amber-300 text-[10px]"
                          data-testid={`zombie-issue-${iss}`}
                        >
                          {ISSUE_LABELS[iss] || iss}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[#a3a3a3]">{it.status || "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => softDelete(it.slug, it.issues.join(","))}
                      disabled={busy[it.slug]}
                      className="px-2.5 py-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 font-mono text-[10px] uppercase tracking-[0.18em] transition disabled:opacity-50"
                      data-testid={`zombie-delete-${it.slug}`}
                    >
                      {busy[it.slug] ? "…" : "Soft-delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 200 && (
            <p className="font-mono text-[10px] text-[#525252] px-3 py-2 border-t border-[#1f1f1f]">
              Showing first 200 of {items.length} — fix the top batch and refresh.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
