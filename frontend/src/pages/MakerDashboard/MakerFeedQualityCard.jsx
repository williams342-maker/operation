import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { fetchMakerFeedQuality } from "../../lib/api";

/**
 * iter366c — Maker-facing Google feed quality banner (Listings tab).
 *
 * Mirrors the admin Feed Health "Attribute quality" block but scoped to
 * the maker's own published listings. Renders NOTHING when every row is
 * fully attributed — only nudges when there's something actionable
 * (e.g. "material not derivable"). Clicking a listing jumps straight
 * into its editor where the materials field fixes the warning.
 */
export default function MakerFeedQualityCard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchMakerFeedQuality()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { /* banner just doesn't render — fine */ });
    return () => { cancelled = true; };
  }, []);

  if (!data || !data.rows_with_warnings) return null;

  return (
    <div
      className="border border-amber-500/40 bg-surface p-4"
      data-testid="maker-feed-quality-card"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5 mb-1.5">
        <ShieldAlert size={12} /> Google feed quality
      </div>
      <p className="font-mono text-[11px] text-ink-muted leading-relaxed mb-2">
        {data.rows_with_warnings} of your {data.rows_total} live listing{data.rows_total === 1 ? "" : "s"} sync
        to Google Shopping with fallback attributes. Add a materials list (or
        mention the wood/metal in the title) and the feed fills in color &amp;
        material automatically — better feed quality, better placement.
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
