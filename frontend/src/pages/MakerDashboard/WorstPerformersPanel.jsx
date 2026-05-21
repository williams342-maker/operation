import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingDown, Sparkles, Check, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  fetchMakerProductsStats, fetchMakerProducts,
  aiSeoTags, updateMakerProduct,
} from "../../lib/api";

/**
 * Worst Performers panel — surfaces the 5 published listings with the
 * lowest 30-day pageview count and offers a one-click "✨ Refresh with AI"
 * action that regenerates SEO tags via Claude and applies them in-place.
 *
 * Closes the Smart Pause loop: Smart Pause kicks stale listings to draft,
 * Worst Performers helps the maker FIX listings before they go stale.
 *
 * Hidden when the maker has <3 published listings (not enough data for a
 * meaningful "worst" ranking yet).
 */
export default function WorstPerformersPanel() {
  const [rows, setRows] = useState(null);   // null = loading, [] = no data
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState({});     // {slug: bool}

  const load = async () => {
    setErr("");
    try {
      const [stats, products] = await Promise.all([
        fetchMakerProductsStats(),
        fetchMakerProducts(),
      ]);
      const byId = Object.fromEntries(products.map((p) => [p.slug, p]));
      // Only consider published, non-deleted listings.
      const eligible = products
        .filter((p) => p.status === "published" && !p.deleted_at)
        .map((p) => ({
          ...p,
          v30: stats[p.slug]?.visits_30d ?? 0,
          sales: stats[p.slug]?.sales_all ?? 0,
        }))
        .sort((a, b) => {
          // Sort by visits asc, then by sales asc — break ties with stale items
          if (a.v30 !== b.v30) return a.v30 - b.v30;
          return a.sales - b.sales;
        })
        .slice(0, 5);
      setRows(eligible);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't load worst performers.");
      setRows([]);
    }
  };

  useEffect(() => { load(); }, []);

  const refreshWithAI = async (p) => {
    setBusy((b) => ({ ...b, [p.slug]: true }));
    try {
      const out = await aiSeoTags({
        title: p.title,
        description: p.description || "",
        category: p.category,
        existing_tags: p.seo_tags || [],
      });
      const merged = Array.from(new Set([...(p.seo_tags || []), ...(out.tags || [])])).slice(0, 13);
      if (merged.length === (p.seo_tags || []).length) {
        toast.info("AI didn't find any new high-intent tags to add.");
        return;
      }
      await updateMakerProduct(p.slug, { seo_tags: merged });
      toast.success(`Added ${merged.length - (p.seo_tags || []).length} fresh tags to "${p.title}".`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "AI refresh failed — try again.");
    } finally {
      setBusy((b) => ({ ...b, [p.slug]: false }));
    }
  };

  if (rows === null) {
    return <SkeletonCard testId="worst-performers-skeleton" rows={3} />;
  }
  if (rows.length < 3) return null;  // hide when shop is too small to be meaningful

  return (
    <div className="border border-[#262626] bg-[#0d0d0d] p-5" data-testid="worst-performers">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] flex items-center gap-2">
            <TrendingDown size={12} /> ◆ Low traffic · last 30 days
          </div>
          <h3 className="font-display text-xl uppercase mt-1">Worst performers</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl leading-relaxed">
            These published listings got the fewest visits in the last month. Refresh their SEO tags with AI in one click, or open the editor to rephotograph + rewrite copy.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-[#262626] hover:border-[#ff4500] text-[#a3a3a3] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]"
          data-testid="worst-performers-refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {err && (
        <div className="font-mono text-xs text-amber-200 mb-3">{err}</div>
      )}

      <ul className="divide-y divide-[#1a1a1a]">
        {rows.map((p) => (
          <li
            key={p.slug}
            className="py-3 flex items-center gap-3"
            data-testid={`worst-row-${p.slug}`}
          >
            {p.images?.[0] && (
              <img
                src={p.images[0]}
                alt=""
                className="w-12 h-12 object-cover border border-[#262626] shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <Link
                to={`/maker/listings/${p.slug}/edit`}
                className="font-display text-base block truncate hover:text-[#ff4500]"
              >
                {p.title}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-0.5">
                {p.v30} visits · {p.sales} sales · {(p.seo_tags || []).length}/13 tags
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => refreshWithAI(p)}
                disabled={busy[p.slug]}
                className="inline-flex items-center gap-1.5 border border-[#ff4500] bg-[#ff4500]/10 hover:bg-[#ff4500]/20 text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-1.5 disabled:opacity-50 transition"
                data-testid={`worst-ai-refresh-${p.slug}`}
                title="Generate fresh SEO tags via Claude and merge them in"
              >
                <Sparkles size={12} />
                {busy[p.slug] ? "Refreshing…" : "Refresh with AI"}
              </button>
              <Link
                to={`/shop/${p.slug}`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 px-2 py-1.5 border border-[#262626] hover:border-[#ff4500] text-[#a3a3a3] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]"
                data-testid={`worst-view-${p.slug}`}
                title="Preview the public listing"
              >
                <ExternalLink size={12} />
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <p className="font-mono text-[10px] text-[#525252] mt-4 leading-relaxed">
        <span className="text-[#ff4500]">✨</span> "Refresh with AI" uses Claude to generate up to 13 new high-intent search tags from your title, category, and description — merged with your existing tags (never overwrites). Fast, free, and one-click reversible from the editor's SEO section.
      </p>
    </div>
  );
}


export function SkeletonCard({ rows = 3, testId = "skeleton-card" }) {
  return (
    <div className="border border-[#262626] bg-[#0d0d0d] p-5 animate-pulse" data-testid={testId}>
      <div className="h-4 w-32 bg-[#1a1a1a] mb-2" />
      <div className="h-6 w-48 bg-[#1a1a1a] mb-4" />
      <ul className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[#1a1a1a] shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-3/5 bg-[#1a1a1a]" />
              <div className="h-2 w-2/5 bg-[#1a1a1a]" />
            </div>
            <div className="h-8 w-24 bg-[#1a1a1a]" />
          </li>
        ))}
      </ul>
    </div>
  );
}
