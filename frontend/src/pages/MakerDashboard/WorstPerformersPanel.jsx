import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingDown, Sparkles, ExternalLink, RefreshCw, Rocket, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchMakerProductsStats, fetchMakerProducts,
  aiSeoTags, aiListingCopy, updateMakerProduct, publishMakerProduct,
} from "../../lib/api";
import { useConfirm } from "./useConfirm";

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
  const [confirm, confirmModal] = useConfirm();

  const load = async () => {
    setErr("");
    try {
      const [stats, products] = await Promise.all([
        fetchMakerProductsStats(),
        fetchMakerProducts(),
      ]);
      // Two recovery cohorts merged into a single ranked list:
      //   • Published listings sorted by lowest 30-day visits, then sales (asc)
      //   • Drafts (skip soft-deleted) — every draft is a recovery candidate;
      //     surface them because they're effectively invisible to buyers and a
      //     one-click publish converts them from "wasted work" to "indexable".
      // Drafts are placed AFTER underperforming published listings since fixing
      // an active stale listing is usually higher leverage than waking a draft.
      const published = products
        .filter((p) => p.status === "published" && !p.deleted_at)
        .map((p) => ({
          ...p,
          v30: stats[p.slug]?.visits_30d ?? 0,
          sales: stats[p.slug]?.sales_all ?? 0,
          cohort: "published",
        }))
        .sort((a, b) => {
          if (a.v30 !== b.v30) return a.v30 - b.v30;
          return a.sales - b.sales;
        });
      const drafts = products
        .filter((p) => p.status === "draft" && !p.deleted_at)
        .map((p) => ({
          ...p, v30: 0, sales: 0, cohort: "draft",
        }))
        .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
      const merged = [...published, ...drafts].slice(0, 6);
      setRows(merged);
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

  const publishNow = async (p) => {
    setBusy((b) => ({ ...b, [p.slug]: true }));
    try {
      await publishMakerProduct(p.slug);
      toast.success(`"${p.title}" is now live and in the sitemap.`);
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Couldn't publish — open the editor to fix any missing fields.";
      toast.error(msg);
    } finally {
      setBusy((b) => ({ ...b, [p.slug]: false }));
    }
  };

  /**
   * Full AI refresh — regenerates title + description + tags via Claude
   * and shows a side-by-side preview before committing. The maker can
   * apply all changes or cancel; partial application isn't offered to
   * keep the action atomic (the AI generates a coherent set, not three
   * independent suggestions).
   */
  const fullRefresh = async (p) => {
    setBusy((b) => ({ ...b, [p.slug]: true }));
    try {
      // Use the existing description as the "bullets" prompt so the AI
      // has the maker's voice + materials/process context to riff from.
      const bulletInput = (
        p.description?.trim() ||
        `${p.title} — ${p.category} listing made with ${p.technique}.`
      ).slice(0, 1800);
      const out = await aiListingCopy({
        bullets: bulletInput,
        target_price: p.price,
        category: p.category,
      });
      if (!out?.title) {
        toast.error("AI couldn't generate a refresh — try again in a few seconds.");
        return;
      }
      const newTitle = out.title;
      const newDesc = out.description || p.description;
      const newTags = (out.tags || []).slice(0, 13);

      const ok = await confirm({
        title: "Apply AI refresh?",
        confirmLabel: "Apply all",
        cancelLabel: "Discard",
        tone: "primary",
        size: "lg",
        testId: `confirm-full-refresh-${p.slug}`,
        body: (
          <div className="space-y-4">
            <DiffBlock label="Title"
              before={p.title}
              after={newTitle}
              testid={`refresh-diff-title-${p.slug}`} />
            <DiffBlock label="Description"
              before={(p.description || "").slice(0, 240) + ((p.description || "").length > 240 ? "…" : "")}
              after={newDesc.slice(0, 240) + (newDesc.length > 240 ? "…" : "")}
              testid={`refresh-diff-desc-${p.slug}`} />
            <DiffBlock label={`Tags (${newTags.length}/13)`}
              before={(p.seo_tags || []).join(", ") || "—"}
              after={newTags.join(", ")}
              testid={`refresh-diff-tags-${p.slug}`} />
            <p className="text-ink-muted">
              Applying replaces title, description, and tags atomically. Open the
              editor afterward to fine-tune anything you want to keep human.
            </p>
          </div>
        ),
      });
      if (!ok) return;
      await updateMakerProduct(p.slug, {
        title: newTitle,
        description: newDesc,
        seo_tags: newTags,
      });
      toast.success(`Full AI refresh applied to "${newTitle}".`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Full refresh failed — try again.");
    } finally {
      setBusy((b) => ({ ...b, [p.slug]: false }));
    }
  };

  if (rows === null) {
    return <SkeletonCard testId="worst-performers-skeleton" rows={3} />;
  }
  // Hide if total recovery candidates < 3 — too small a shop for a meaningful
  // ranking. Counts both underperforming published + drafts.
  if (rows.length < 3) return null;

  return (
    <div className="border border-line bg-paper p-5" data-testid="worst-performers">
      {confirmModal}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand flex items-center gap-2">
            <TrendingDown size={12} /> ◆ Recovery queue
          </div>
          <h3 className="font-display text-xl uppercase mt-1">Low traffic + forgotten drafts</h3>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-xl leading-relaxed">
            These listings are dragging the shop's discoverability. Underperforming live listings can be refreshed with AI; forgotten drafts can be published in one click.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-line hover:border-brand text-ink-muted hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em]"
          data-testid="worst-performers-refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {err && (
        <div className="font-mono text-xs text-ink mb-3">{err}</div>
      )}

      <ul className="divide-y divide-line">
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
                className="w-12 h-12 object-cover border border-line shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  to={`/maker/listings/${p.slug}/edit`}
                  className="font-display text-base truncate hover:text-brand"
                >
                  {p.title}
                </Link>
                {p.cohort === "draft" && (
                  <span
                    className="font-mono text-[9px] uppercase tracking-[0.22em] border border-amber-500/40 text-brand px-1.5 py-0.5 shrink-0"
                    data-testid={`worst-draft-tag-${p.slug}`}
                  >
                    Draft
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-0.5">
                {p.cohort === "draft" ? (
                  <>Not in sitemap · {(p.seo_tags || []).length}/13 tags{p.created_at ? ` · saved ${new Date(p.created_at).toLocaleDateString()}` : ""}</>
                ) : (
                  <>{p.v30} visits · {p.sales} sales · {(p.seo_tags || []).length}/13 tags</>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {p.cohort === "draft" ? (
                <button
                  onClick={() => publishNow(p)}
                  disabled={busy[p.slug]}
                  className="inline-flex items-center gap-1.5 border border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-1.5 disabled:opacity-50 transition"
                  data-testid={`worst-publish-${p.slug}`}
                  title="Flip this draft to published — instantly enters the sitemap so Google can find it"
                >
                  <Rocket size={12} />
                  {busy[p.slug] ? "Publishing…" : "Publish now"}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => refreshWithAI(p)}
                    disabled={busy[p.slug]}
                    className="inline-flex items-center gap-1.5 border border-brand/40 bg-brand/5 hover:bg-brand/20 text-brand font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-1.5 disabled:opacity-50 transition"
                    data-testid={`worst-ai-refresh-${p.slug}`}
                    title="Regenerate SEO tags only — fastest fix, merged into existing tags."
                  >
                    <Sparkles size={12} />
                    {busy[p.slug] ? "…" : "Tags"}
                  </button>
                  <button
                    onClick={() => fullRefresh(p)}
                    disabled={busy[p.slug]}
                    className="inline-flex items-center gap-1.5 border border-brand bg-brand/10 hover:bg-brand/30 text-brand font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-1.5 disabled:opacity-50 transition"
                    data-testid={`worst-full-refresh-${p.slug}`}
                    title="Regenerate title, description, AND tags. Side-by-side preview before applying."
                  >
                    <Wand2 size={12} />
                    {busy[p.slug] ? "Refreshing…" : "Full refresh"}
                  </button>
                </>
              )}
              {p.cohort !== "draft" && (
                <Link
                  to={`/shop/${p.slug}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 px-2 py-1.5 border border-line hover:border-brand text-ink-muted hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em]"
                  data-testid={`worst-view-${p.slug}`}
                  title="Preview the public listing"
                >
                  <ExternalLink size={12} />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="font-mono text-[10px] text-ink-muted mt-4 leading-relaxed">
        <span className="text-brand">✨</span> "Refresh with AI" uses Claude to generate up to 13 new high-intent search tags from your title, category, and description — merged with your existing tags (never overwrites). For drafts, "Publish now" flips them live and adds them to the sitemap immediately.
      </p>
    </div>
  );
}


export function SkeletonCard({ rows = 3, testId = "skeleton-card" }) {
  return (
    <div className="border border-line bg-paper p-5 animate-pulse" data-testid={testId}>
      <div className="h-4 w-32 bg-surface mb-2" />
      <div className="h-6 w-48 bg-surface mb-4" />
      <ul className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-3">
            <div className="w-12 h-12 bg-surface shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-3/5 bg-surface" />
              <div className="h-2 w-2/5 bg-surface" />
            </div>
            <div className="h-8 w-24 bg-surface" />
          </li>
        ))}
      </ul>
    </div>
  );
}



/**
 * DiffBlock — stacked Before/After display for the Full AI Refresh
 * confirm modal. Kept small + presentation-only so the parent owns
 * all data and the modal can render JSX bodies via useConfirm.
 */
function DiffBlock({ label, before, after, testid }) {
  return (
    <div data-testid={testid}>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-brand mb-1.5">
        ◆ {label}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="border border-line bg-paper p-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mb-1">Before</div>
          <div className="font-mono text-[11px] text-ink-muted leading-relaxed break-words">
            {before || <em className="text-ink-muted">— empty —</em>}
          </div>
        </div>
        <div className="border border-brand/40 bg-brand/5 p-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-brand mb-1">After</div>
          <div className="font-mono text-[11px] text-ink leading-relaxed break-words">
            {after}
          </div>
        </div>
      </div>
    </div>
  );
}
