import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { autofixMakerFeedQuality, fetchMakerFeedQuality } from "../../lib/api";

/**
 * iter366c — Maker-facing Google feed quality banner (Listings tab).
 *
 * Mirrors the admin Feed Health "Attribute quality" block but scoped to
 * the maker's own published listings. Renders NOTHING when every row is
 * fully attributed — only nudges when there's something actionable.
 * Clicking a listing jumps into its editor.
 *
 * iter369 — "AI auto-fix": Claude infers materials (only filled when the
 * listing has none) and a feed-only color per flagged listing, then the
 * banner re-checks itself. Listings' buyer-facing text never changes.
 */
export default function MakerFeedQualityCard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [fixing, setFixing] = useState(false);

  const load = () =>
    fetchMakerFeedQuality()
      .then(setData)
      .catch(() => { /* banner just doesn't render — fine */ });

  useEffect(() => {
    let cancelled = false;
    fetchMakerFeedQuality()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!data || !data.rows_with_warnings) return null;

  const runAutofix = async () => {
    setFixing(true);
    try {
      const r = await autofixMakerFeedQuality();
      if (r.fixed > 0) {
        toast.success(`AI filled in attributes for ${r.fixed} listing${r.fixed === 1 ? "" : "s"}.`);
      } else {
        toast.message("AI couldn't confidently resolve these — open the listing and add a materials list.");
      }
      await load();
    } catch {
      toast.error("Auto-fix failed. Please try again.");
    } finally {
      setFixing(false);
    }
  };

  return (
    <div
      className="border border-amber-500/40 bg-surface p-4"
      data-testid="maker-feed-quality-card"
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-600 dark:text-brand inline-flex items-center gap-1.5">
          <ShieldAlert size={12} /> Google feed quality
        </div>
        <button
          type="button"
          onClick={runAutofix}
          disabled={fixing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover text-white font-mono text-[10px] uppercase tracking-[0.2em] disabled:opacity-60 transition"
          data-testid="feed-quality-autofix"
        >
          {fixing
            ? <><Loader2 size={11} className="animate-spin" /> Analyzing…</>
            : <><Sparkles size={11} /> AI auto-fix</>}
        </button>
      </div>
      <p className="font-mono text-[11px] text-ink-muted leading-relaxed mb-2">
        {data.rows_with_warnings} of your {data.rows_total} live listing{data.rows_total === 1 ? "" : "s"} sync
        to Google Shopping with fallback attributes. Let the AI infer the material &amp; color
        from your listing text (your listing copy never changes), or add a materials
        list yourself in the editor.
      </p>
      <div className="flex flex-wrap gap-2">
        {(data.examples || []).map((ex) => (
          <button
            key={ex.slug}
            type="button"
            onClick={() => navigate(`/maker/listings/${ex.slug}/edit`)}
            className="px-2.5 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.16em] text-ink transition"
            title={ex.warnings.join("; ")}
            data-testid={`feed-quality-fix-${ex.slug}`}
          >
            {ex.title || ex.slug} ↗
          </button>
        ))}
      </div>
    </div>
  );
}
