import React, { useState } from "react";
import { X, Sparkles, RefreshCw, ExternalLink, AlertTriangle, TrendingUp, TrendingDown, Target } from "lucide-react";
import { toast } from "sonner";
import { fetchListingPriceCompare } from "../../lib/api";

/**
 * iter334 — AI Price Comparison side panel for the Maker Listing Editor.
 *
 * Slides in from the right. Calls Jina Reader → Claude to get:
 *   - market price range (low / median / high)
 *   - 3–5 comparables with links
 *   - a sharp recommendation vs the maker's listed price
 *
 * The backend caches results for 24h per listing (5 fresh runs/day limit).
 * Force-refresh button counts toward the quota.
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   listingSlug: string         (required — the listing being analyzed)
 *   listedPrice: number|string  (used to color the verdict pill)
 */
export default function PriceComparePanel({ open, onClose, listingSlug, listedPrice }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [hasRun, setHasRun] = useState(false);

  const run = async (force = false) => {
    if (!listingSlug) {
      setError("Save the listing as a draft first so we have something to compare.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetchListingPriceCompare(listingSlug, force);
      setData(res);
      setHasRun(true);
      if (res.from_cache) {
        toast.info("Showing cached comparison (≤24h old)", {
          description: "Hit Refresh to run a fresh analysis.",
        });
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Couldn't complete the comparison. Try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Auto-trigger on first open (cache hit will return instantly).
  React.useEffect(() => {
    if (open && !hasRun && !loading) {
      run(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // Verdict: how does the listed price compare to the median?
  const verdict = (() => {
    const lp = parseFloat(listedPrice);
    if (!data || !lp || !data.price_median) return null;
    const median = data.price_median;
    const delta = ((lp - median) / median) * 100;
    if (Math.abs(delta) <= 10) return { label: "On target", icon: Target, color: "text-emerald-700", bg: "bg-emerald-400/10 border-emerald-400/40", delta };
    if (delta > 10) return { label: `${Math.round(delta)}% above market`, icon: TrendingUp, color: "text-brand", bg: "bg-amber-400/10 border-amber-400/40", delta };
    return { label: `${Math.round(Math.abs(delta))}% below market`, icon: TrendingDown, color: "text-brand", bg: "bg-cyan-400/10 border-cyan-400/40", delta };
  })();

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        data-testid="price-compare-backdrop"
      />
      {/* Panel */}
      <aside
        className="fixed top-0 right-0 z-50 h-full w-full sm:w-[480px] bg-paper border-l border-line shadow-2xl flex flex-col"
        data-testid="price-compare-panel"
        role="dialog"
        aria-label="AI price comparison"
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand" />
            <h3 className="font-mono text-[12px] uppercase tracking-[0.22em] text-ink">
              AI Price Check
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-brand transition"
            data-testid="price-compare-close"
            aria-label="Close panel"
          >
            <X size={18} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {loading && (
            <div className="space-y-3" data-testid="price-compare-loading">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin" /> Searching the web for comparable items…
              </div>
              <div className="font-mono text-[10px] text-ink-muted leading-relaxed">
                Pulling Etsy, Amazon, and handmade marketplace listings · ~10–20 seconds.
              </div>
              <div className="space-y-2 mt-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-surface animate-pulse" />
                ))}
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="border border-amber-500/40 bg-amber-500/[0.06] p-4 flex items-start gap-3" data-testid="price-compare-error">
              <AlertTriangle size={16} className="text-brand shrink-0 mt-0.5" />
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand">Couldn't analyze</p>
                <p className="font-mono text-[11px] text-ink-muted mt-1 leading-relaxed">{error}</p>
                <button
                  onClick={() => run(false)}
                  className="mt-3 px-3 py-1.5 border border-amber-400/40 hover:border-amber-300 text-brand font-mono text-[10px] uppercase tracking-[0.22em]"
                  data-testid="price-compare-retry"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {data && !loading && !error && (
            <>
              {/* Verdict pill */}
              {verdict && (
                <div className={`border ${verdict.bg} px-4 py-3 flex items-center gap-3`} data-testid="price-compare-verdict">
                  <verdict.icon size={18} className={verdict.color} />
                  <div className="flex-1">
                    <div className={`font-mono text-[11px] uppercase tracking-[0.22em] ${verdict.color}`}>
                      Your price: ${parseFloat(listedPrice).toFixed(2)} · {verdict.label}
                    </div>
                    <div className="font-mono text-[10px] text-ink-muted mt-0.5">
                      Market median: ${data.price_median.toFixed(2)}
                    </div>
                  </div>
                </div>
              )}

              {/* Price range */}
              <div data-testid="price-compare-range">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                  ◆ Comparable price range
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Low", value: data.price_low, color: "text-brand" },
                    { label: "Median", value: data.price_median, color: "text-ink" },
                    { label: "High", value: data.price_high, color: "text-brand" },
                  ].map((b) => (
                    <div key={b.label} className="border border-line bg-paper px-3 py-3 text-center">
                      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">{b.label}</div>
                      <div className={`font-mono text-[16px] font-bold ${b.color} mt-1`}>
                        ${b.value.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommendation */}
              {data.recommendation && (
                <div className="border border-brand/30 bg-brand/[0.04] px-4 py-3" data-testid="price-compare-recommendation">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-1.5">
                    ◆ Recommendation
                  </p>
                  <p className="font-mono text-[11px] text-ink leading-relaxed">{data.recommendation}</p>
                </div>
              )}

              {/* Comparables */}
              {data.comparables && data.comparables.length > 0 && (
                <div data-testid="price-compare-comparables">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                    ◆ Comparable listings ({data.comparables.length})
                  </p>
                  <ul className="space-y-2">
                    {data.comparables.map((c, i) => (
                      <li
                        key={i}
                        className="border border-line hover:border-brand/40 bg-paper px-3 py-2.5 transition"
                        data-testid={`price-compare-item-${i}`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="font-mono text-[11px] text-ink leading-relaxed flex-1 min-w-0">
                            {c.title || "Untitled listing"}
                          </div>
                          <div className="font-mono text-[12px] text-brand shrink-0 font-bold">
                            ${c.price.toFixed(2)}
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
                            {c.source}
                          </span>
                          {c.url && (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-[9px] uppercase tracking-[0.22em] text-brand hover:text-brand inline-flex items-center gap-1"
                            >
                              View <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.comparables && data.comparables.length === 0 && (
                <div className="border border-line bg-paper px-4 py-4" data-testid="price-compare-no-comparables">
                  <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
                    No solid comparables found — the AI couldn't anchor the price to specific
                    listings. The range above is an estimate; consider searching Etsy + Amazon
                    yourself to confirm.
                  </p>
                </div>
              )}

              {/* Footer meta */}
              <div className="border-t border-line pt-3 mt-2 flex items-center justify-between">
                <div className="font-mono text-[9px] text-ink-muted">
                  {data.from_cache ? "From cache · ≤24h old" : "Just generated"}
                  {typeof data.remaining_today === "number" && (
                    <> · {data.remaining_today} fresh runs left today</>
                  )}
                </div>
                <button
                  onClick={() => run(true)}
                  disabled={loading || (data.remaining_today === 0)}
                  className="px-3 py-1.5 border border-line hover:border-cyan-400 text-brand font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="price-compare-refresh"
                >
                  <RefreshCw size={11} /> Refresh
                </button>
              </div>
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-line font-mono text-[9px] text-ink-muted leading-relaxed">
          Powered by Jina Reader (live web search) + Claude Sonnet 4.5. Not financial advice — use as a starting point.
        </footer>
      </aside>
    </>
  );
}
