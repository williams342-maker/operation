/**
 * iter455 — Admin Marketing Center: Featured Maker Promotion Engine.
 * Auto-suggested candidates (Featured Score), one-click asset generation
 * (Nano Banana square + landscape + AI captions), API-agnostic promotion
 * queue (Draft → Ready → Posted → Archived) and activation (site-wide
 * spotlight + maker congrats email).
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Copy, Download, Trophy, RefreshCw } from "lucide-react";
import { http, adminAuthHeaders } from "../../lib/api";

const H = () => ({ headers: adminAuthHeaders() });
const copy = (t) => { navigator.clipboard?.writeText(t); toast.success("Copied"); };

export default function FeaturedMakerTab() {
  const [data, setData] = useState(null);
  const [promos, setPromos] = useState(null);
  const [busy, setBusy] = useState(null);
  const [theme, setTheme] = useState("spotlight");

  const load = () => {
    http.get("/admin/featured/candidates", H()).then((r) => setData(r.data)).catch(() => toast.error("Could not load candidates."));
    http.get("/admin/featured/promotions", H()).then((r) => setPromos(r.data.promotions)).catch(() => {});
  };
  useEffect(load, []);

  async function generate(c) {
    setBusy(c.maker_slug);
    toast.info("Generating promo assets — this takes ~30-60s…");
    try {
      const r = await http.post("/admin/featured/promotions",
        { maker_slug: c.maker_slug, theme, score: c.featured_score, reasons: c.reasons }, H());
      setPromos((p) => [r.data, ...(p || [])]);
      toast.success("Promotion ready — review it in the queue below.");
    } catch (e) { toast.error(e?.response?.data?.detail || "Generation failed."); }
    finally { setBusy(null); }
  }

  async function patch(id, body) {
    try {
      const r = await http.patch(`/admin/featured/promotions/${id}`, body, H());
      setPromos((p) => p.map((x) => (x.id === id ? { ...x, ...r.data.promotion } : x)));
    } catch { toast.error("Update failed."); }
  }

  async function activate(id) {
    try {
      const r = await http.post(`/admin/featured/promotions/${id}/activate`, {}, H());
      toast.success(`Featured live through ${r.data.ends_at.slice(0, 10)} — maker notified.`);
      load();
    } catch { toast.error("Activation failed."); }
  }

  const cur = data?.current;

  return (
    <div className="space-y-8" data-testid="featured-maker-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Featured Maker · Marketing Center</h2>
          <p className="font-mono text-[10px] text-ink-muted mt-1" data-testid="featured-current-label">
            {cur ? <>Currently featured: <span className="text-brand">{cur.maker_slug}</span> through {cur.ends_at?.slice(0, 10)}</>
                 : "No maker currently featured"}
          </p>
        </div>
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          Theme
          <select value={theme} onChange={(e) => setTheme(e.target.value)}
                  className="bg-paper border border-line text-ink font-mono text-[11px] px-2.5 py-1.5 focus:border-brand outline-none"
                  data-testid="featured-theme-select">
            {["spotlight", "christmas", "halloween", "spring", "patriotic", "fathers-day"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Candidates */}
      <div data-testid="featured-candidates">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">◆ Weekly recommendations</h3>
        {!data ? <p className="font-mono text-xs text-ink-muted">Scoring makers…</p> : (
          <div className="overflow-x-auto border border-line">
            <table className="w-full text-left">
              <thead><tr className="border-b border-line">
                {["#", "Maker", "Score", "Revenue 30d", "Views", "Conv.", "New", "Rating", "Last Featured", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-line/60">
                {data.candidates.map((c, i) => (
                  <tr key={c.maker_slug} className={i === 0 ? "bg-brand/[0.04]" : ""}
                      data-testid={`featured-candidate-${c.maker_slug}`}>
                    <td className="px-3 py-2 font-mono text-xs text-ink-muted">{i === 0 ? "★" : i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink whitespace-nowrap">
                      {c.name}
                      {i === 0 && <div className="text-[9px] text-brand mt-0.5">{c.reasons[0]}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-sm text-brand">{c.featured_score}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink">${c.revenue_30d.toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink">{c.store_views}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink">{c.conversion_rate}%</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink">{c.new_listings}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink">{c.avg_rating ? `${c.avg_rating}★` : "—"}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-ink-muted whitespace-nowrap">
                      {c.days_since_featured != null ? `${c.days_since_featured}d ago` : "Never"}
                      {c.featured_count > 0 && ` · ×${c.featured_count}`}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => generate(c)} disabled={!!busy}
                              className="border border-brand text-brand hover:bg-brand hover:text-paper px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] transition disabled:opacity-40 inline-flex items-center gap-1"
                              data-testid={`featured-generate-${c.maker_slug}`}>
                        <Sparkles size={10} />{busy === c.maker_slug ? "Generating…" : "Generate promo"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Promotion queue */}
      <div data-testid="featured-queue">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">◆ Promotion queue</h3>
        {!promos || promos.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted border border-dashed border-line p-6">
            No promotions yet — generate one from the recommendations above.
          </p>
        ) : promos.map((p) => (
          <div key={p.id} className="border border-line bg-paper p-4 mb-4" data-testid={`promo-card-${p.id}`}>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <Trophy size={14} className="text-brand" />
              <span className="font-mono text-sm text-ink">{p.maker_name}</span>
              <span className="font-mono text-[9px] text-ink-muted">· {p.product_title} · {p.theme}</span>
              <span className={`ml-auto border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${
                p.status === "posted" ? "border-green-500/50 text-green-500"
                : p.status === "ready" ? "border-brand/50 text-brand" : "border-line text-ink-muted"}`}
                data-testid={`promo-status-${p.id}`}>
                {p.status}{p.activated && " · live"}
              </span>
            </div>
            <div className="flex flex-wrap gap-4">
              {["square_url", "landscape_url"].map((k) => p.assets?.[k] && (
                <div key={k} className="w-44">
                  <img src={p.assets[k]} alt={p.assets.alt_text || p.maker_name}
                       className="border border-line w-full" />
                  <a href={p.assets[k]} download target="_blank" rel="noreferrer"
                     className="mt-1 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-brand hover:underline"
                     data-testid={`promo-download-${k}-${p.id}`}>
                    <Download size={10} /> {k === "square_url" ? "Square 1080" : "Landscape 1200"}
                  </a>
                </div>
              ))}
              <div className="flex-1 min-w-[260px] space-y-2">
                <div className="font-mono text-xs text-ink">{p.captions?.headline}</div>
                {["instagram", "facebook", "x"].map((plat) => p.captions?.captions?.[plat] && (
                  <div key={plat} className="flex items-start gap-2">
                    <span className="font-mono text-[9px] uppercase text-ink-muted w-16 shrink-0 mt-0.5">
                      {plat} <span className="text-ink-muted/60">({p.captions.captions[plat].length})</span>
                    </span>
                    <p className="font-mono text-[10px] text-ink-muted flex-1 line-clamp-2">{p.captions.captions[plat]}</p>
                    <button onClick={() => copy(`${p.captions.captions[plat]}\n\n${(p.captions.hashtags || []).join(" ")}`)}
                            className="text-ink-muted hover:text-brand" data-testid={`promo-copy-${plat}-${p.id}`}>
                      <Copy size={11} />
                    </button>
                  </div>
                ))}
                {(p.captions?.hashtags || []).length > 0 && (
                  <p className="font-mono text-[9px] text-brand/80">{p.captions.hashtags.join(" ")}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-line/60">
              {!p.activated && (
                <button onClick={() => activate(p.id)}
                        className="bg-brand hover:bg-brand-hover text-[#0a0a0a] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] font-bold transition"
                        data-testid={`promo-activate-${p.id}`}>
                  Activate · feature on site
                </button>
              )}
              {p.status !== "posted" && (
                <button onClick={() => patch(p.id, { status: "posted", platforms: ["manual"] })}
                        className="border border-green-600/50 text-green-500 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] transition"
                        data-testid={`promo-mark-posted-${p.id}`}>
                  Mark posted
                </button>
              )}
              <button onClick={() => patch(p.id, { status: "archived" }).then(() =>
                        setPromos((x) => x.filter((y) => y.id !== p.id)))}
                      className="border border-line text-ink-muted px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] transition"
                      data-testid={`promo-archive-${p.id}`}>
                Archive
              </button>
              <a href={`/makers/${p.maker_slug}`} target="_blank" rel="noreferrer"
                 className="border border-line text-ink-muted hover:text-ink px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] transition">
                Open storefront ↗
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
