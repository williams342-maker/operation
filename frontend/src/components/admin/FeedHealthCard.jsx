/**
 * iter316c — Admin "Feed health" widget.
 *
 * Per-channel snapshot of how each external catalog feed will publish
 * once the next downstream sync pulls it. Surfaces:
 *   • # ready listings
 *   • # blocked listings
 *   • top blocker reasons (missing image, shallow GPC, etc.)
 *   • up-to-5 example blocked listings per channel (click to copy
 *     the slug)
 *
 * Designed to live as a card inside SettingsTab (or any tab — it's
 * self-contained). Reads from `/api/admin/feeds/health` which mirrors
 * the exact eligibility logic used by the live feeds.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchAdminFeedHealth } from "../../lib/api";

const CHANNEL_LABELS = {
  google_merchant: "Google Merchant",
  pinterest: "Pinterest",
  meta: "Meta Commerce",
  enrichlabs: "EnrichLabs API",
  showcase: "Community Showcase",
  design_files: "Free Design Files",
};

const BLOCKER_LABELS = {
  missing_image: "No image",
  missing_price: "Price = $0",
  out_of_stock: "Out of stock",
  shallow_gpc: "GPC < 3 levels",
  short_description: "Description < 50 chars",
  missing_preview: "Missing preview img",
};

export default function FeedHealthCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState({});

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetchAdminFeedHealth();
      setData(r);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load feed health.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const toggle = (channel) => setExpanded((p) => ({ ...p, [channel]: !p[channel] }));

  if (loading) {
    return (
      <div data-testid="feed-health-card-loading" className="font-mono text-xs text-[#a3a3a3] py-3">
        Loading feed health…
      </div>
    );
  }
  if (err) {
    return (
      <div data-testid="feed-health-card-err" className="font-mono text-xs text-red-400 py-3">
        {err}
      </div>
    );
  }
  if (!data) return null;

  return (
    <section
      className="border border-[#262626] p-5 md:p-6 space-y-4"
      data-testid="feed-health-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
            ◆ Feed health · {data.products_fully_ready}/{data.products_total} fully ready
          </div>
          <h3 className="font-display text-xl uppercase mt-1">Catalog distribution status</h3>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
          data-testid="feed-health-refresh"
        >
          ↻ Refresh
        </button>
      </div>
      <p className="font-mono text-xs text-[#a3a3a3] max-w-3xl leading-relaxed">
        Counts per-channel match the exact eligibility rules used by the live feed routes (`shop_feeds.py`,
        `pinterest_feed.py`, `enrichlabs.py`). A listing showing as <span className="text-emerald-400">ready</span>{" "}
        for one channel may still be <span className="text-amber-400">blocked</span> elsewhere because of stricter
        per-channel rules (Pinterest needs ≥50-char descriptions; Meta drops out-of-stock; etc.).
      </p>

      <div className="space-y-2">
        {data.channels.map((c) => {
          const pct = c.total ? Math.round((c.ready / c.total) * 100) : 0;
          const isOpen = expanded[c.channel];
          return (
            <div
              key={c.channel}
              className="border border-[#1f1f1f] hover:border-[#262626] transition"
              data-testid={`feed-health-${c.channel}`}
            >
              <button
                type="button"
                onClick={() => toggle(c.channel)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-block w-1.5 h-1.5 shrink-0 rounded-full ${
                      pct >= 95 ? "bg-emerald-400"
                      : pct >= 80 ? "bg-amber-400"
                      : "bg-red-400"
                    }`}
                  />
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#e5e5e5]">
                    {CHANNEL_LABELS[c.channel] || c.channel}
                  </span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-mono text-[11px] text-emerald-400" data-testid={`feed-health-${c.channel}-ready`}>
                    ✓ {c.ready}
                  </span>
                  {c.blocked > 0 && (
                    <span className="font-mono text-[11px] text-amber-400" data-testid={`feed-health-${c.channel}-blocked`}>
                      ✗ {c.blocked}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-[#525252] w-12 text-right">{pct}%</span>
                  <span className="font-mono text-[10px] text-[#525252]">{isOpen ? "▾" : "▸"}</span>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-[#1f1f1f] px-4 py-3 space-y-3 bg-[#080808]">
                  {c.top_blockers.length === 0 ? (
                    <p className="font-mono text-[10px] text-emerald-400" data-testid={`feed-health-${c.channel}-clean`}>
                      ✓ No blockers — every eligible listing is ready to publish.
                    </p>
                  ) : (
                    <>
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1.5">
                          Top blockers
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {c.top_blockers.map((b) => (
                            <span
                              key={b.reason}
                              className="px-2 py-1 border border-amber-500/30 text-amber-300 font-mono text-[10px]"
                              title={data.blocker_glossary?.[b.reason] || ""}
                              data-testid={`feed-health-${c.channel}-blocker-${b.reason}`}
                            >
                              {BLOCKER_LABELS[b.reason] || b.reason} · {b.count}
                            </span>
                          ))}
                        </div>
                      </div>
                      {c.blocked_examples?.length > 0 && (
                        <div>
                          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1.5">
                            Example blocked listings (click to copy slug)
                          </div>
                          <ul className="space-y-1">
                            {c.blocked_examples.map((ex) => (
                              <li key={ex.slug} className="font-mono text-[10px] flex items-center justify-between gap-3">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(ex.slug);
                                      toast.success(`Slug copied · ${ex.slug}`);
                                    } catch { /* noop */ }
                                  }}
                                  className="text-[#e5e5e5] hover:text-[#ff4500] transition text-left truncate"
                                >
                                  {ex.title || ex.slug}
                                </button>
                                <span className="text-[#525252] shrink-0">
                                  {ex.blockers.slice(0, 2).join(" · ")}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="font-mono text-[10px] text-[#525252] pt-2">
        Snapshot · {data.as_of ? new Date(data.as_of).toLocaleString() : "—"}
      </p>
    </section>
  );
}
