/**
 * iter335.13 — Admin: Cross-maker theme campaigns.
 *
 * Lets ops create, activate/pause/end pooled marketplace promotion
 * campaigns (e.g. "Outdoor Decor Week", "Father's Day", "Veteran
 * Makers"). The allocator subsidizes maker boosts on matching
 * listings from these shared pools.
 *
 * Mounted in AdsTab.jsx so all promotion-related admin tooling lives
 * in one place.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Plus, Loader2, X, Play, Pause, Square } from "lucide-react";
import {
  adminFetchPromoteThemes,
  adminCreatePromoteTheme,
  adminSetPromoteThemeStatus,
} from "../../lib/api";

const STATUS_TONE = {
  active:    "border-emerald-700/50 text-emerald-300",
  scheduled: "border-cyan-700/50 text-cyan-300",
  paused:    "border-amber-700/50 text-amber-300",
  ended:     "border-[#404040] text-[#737373]",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function plusDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function PromoteThemesCard() {
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await adminFetchPromoteThemes();
        if (!cancelled) setThemes(r.themes || []);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Failed to load themes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const onStatus = async (themeId, status) => {
    setBusy(`${themeId}:${status}`);
    try {
      await adminSetPromoteThemeStatus(themeId, status);
      toast.success(`Theme → ${status}.`);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Status change failed.");
    } finally { setBusy(""); }
  };

  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="promote-themes-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-300 mb-2 flex items-center gap-1.5">
            <Sparkles size={12} /> ◆ Marketplace Themes
          </div>
          <h3 className="font-display text-2xl uppercase mb-1">Cross-maker Promote Campaigns</h3>
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed max-w-2xl">
            Shared budget pools that subsidize maker boosts on listings matching a category. Multiple makers benefit from one pool; per-maker + per-listing caps keep allocation fair.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-2 border border-cyan-700/50 hover:border-cyan-400 text-cyan-300 font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-1.5"
          data-testid="promote-themes-new"
        >
          {showForm ? <X size={11} /> : <Plus size={11} />}
          {showForm ? "Cancel" : "New theme"}
        </button>
      </div>

      {showForm && (
        <NewThemeForm
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); reload(); }}
        />
      )}

      <div className="mt-4">
        {loading && <p className="font-mono text-xs text-[#737373]">Loading themes…</p>}
        {!loading && themes.length === 0 && (
          <p className="font-mono text-xs text-[#737373]" data-testid="promote-themes-empty">
            No themes yet. Click &ldquo;New theme&rdquo; to create the first one.
          </p>
        )}
        {!loading && themes.length > 0 && (
          <div className="border border-[#262626] divide-y divide-[#1a1a1a]" data-testid="promote-themes-list">
            {themes.map((t) => {
              const used = (t.pool_total_cents - t.pool_remaining_cents);
              const usedPct = Math.min(100, Math.round((used / Math.max(1, t.pool_total_cents)) * 100));
              return (
                <div
                  key={t.theme_id || t.slug}
                  className="p-3 flex items-start justify-between gap-3 flex-wrap"
                  data-testid={`promote-theme-row-${t.slug}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-lg text-[#f5f5f5]">{t.name}</span>
                      <span className={`font-mono text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 border ${STATUS_TONE[t.status] || ""}`}>
                        {t.status}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-[#a3a3a3] mt-1 flex flex-wrap gap-3">
                      <span>{t.start_date} → {t.end_date}</span>
                      <span>${(t.pool_remaining_cents / 100).toFixed(0)} / ${(t.pool_total_cents / 100).toFixed(0)} left</span>
                      <span>per-maker cap ${(t.per_maker_cap_cents / 100).toFixed(0)}</span>
                      <span>per-listing cap ${(t.per_listing_cap_cents / 100).toFixed(0)}</span>
                    </div>
                    {(t.category_filter || []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.category_filter.map((c) => (
                          <span key={c} className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-300 border border-cyan-700/30 px-1.5 py-0.5">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 h-1 bg-[#1f1f1f] max-w-md">
                      <div className="h-1 bg-gradient-to-r from-cyan-600 to-cyan-300" style={{ width: `${usedPct}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {t.status !== "active" && (
                      <button
                        onClick={() => onStatus(t.theme_id, "active")}
                        disabled={busy === `${t.theme_id}:active`}
                        className="px-2 py-1 border border-emerald-700/50 hover:border-emerald-400 text-emerald-300 font-mono text-[9px] uppercase tracking-[0.22em] flex items-center gap-1 disabled:opacity-50"
                        data-testid={`promote-theme-activate-${t.slug}`}
                      >
                        <Play size={10} /> Activate
                      </button>
                    )}
                    {t.status === "active" && (
                      <button
                        onClick={() => onStatus(t.theme_id, "paused")}
                        disabled={busy === `${t.theme_id}:paused`}
                        className="px-2 py-1 border border-amber-700/50 hover:border-amber-400 text-amber-300 font-mono text-[9px] uppercase tracking-[0.22em] flex items-center gap-1 disabled:opacity-50"
                        data-testid={`promote-theme-pause-${t.slug}`}
                      >
                        <Pause size={10} /> Pause
                      </button>
                    )}
                    {t.status !== "ended" && (
                      <button
                        onClick={() => onStatus(t.theme_id, "ended")}
                        disabled={busy === `${t.theme_id}:ended`}
                        className="px-2 py-1 border border-[#404040] hover:border-red-500 hover:text-red-300 text-[#a3a3a3] font-mono text-[9px] uppercase tracking-[0.22em] flex items-center gap-1 disabled:opacity-50"
                        data-testid={`promote-theme-end-${t.slug}`}
                      >
                        <Square size={10} /> End
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function NewThemeForm({ onCancel, onCreated }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(plusDays(todayIso(), 7));
  const [poolDollars, setPoolDollars] = useState(500);
  const [perMakerCapDollars, setPerMakerCapDollars] = useState(50);
  const [perListingCapDollars, setPerListingCapDollars] = useState(20);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const onSlugSync = (v) => {
    setName(v);
    if (!slug) {
      setSlug(
        v.toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60),
      );
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name,
        slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, ""),
        start_date: startDate,
        end_date: endDate,
        pool_total_cents: Math.round(poolDollars * 100),
        per_maker_cap_cents: Math.round(perMakerCapDollars * 100),
        per_listing_cap_cents: Math.round(perListingCapDollars * 100),
        category_filter: categoryFilter
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      };
      await adminCreatePromoteTheme(payload);
      toast.success(`Theme "${name}" created (scheduled).`);
      onCreated?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create theme.");
    } finally { setBusy(false); }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-4 border border-cyan-900/40 bg-cyan-950/10 p-4 grid sm:grid-cols-2 gap-3"
      data-testid="promote-themes-form"
    >
      <label className="block sm:col-span-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Name</span>
        <input
          type="text"
          required
          minLength={3}
          maxLength={120}
          value={name}
          onChange={(e) => onSlugSync(e.target.value)}
          placeholder="Outdoor Decor Week"
          className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
          data-testid="promote-themes-form-name"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Slug</span>
        <input
          type="text"
          required
          pattern="^[a-z0-9-]+$"
          minLength={3}
          maxLength={80}
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="outdoor-decor-week"
          className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
          data-testid="promote-themes-form-slug"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Category filter (comma-sep, empty = all)</span>
        <input
          type="text"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          placeholder="outdoor, garden, patio"
          className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
          data-testid="promote-themes-form-categories"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Start date</span>
        <input
          type="date"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
          data-testid="promote-themes-form-start"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">End date</span>
        <input
          type="date"
          required
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
          data-testid="promote-themes-form-end"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Pool total ($)</span>
        <input
          type="number"
          required
          min={10}
          max={100000}
          value={poolDollars}
          onChange={(e) => setPoolDollars(Number(e.target.value))}
          className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
          data-testid="promote-themes-form-pool"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Per-maker cap ($)</span>
        <input
          type="number"
          required
          min={1}
          max={10000}
          value={perMakerCapDollars}
          onChange={(e) => setPerMakerCapDollars(Number(e.target.value))}
          className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
          data-testid="promote-themes-form-maker-cap"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Per-listing cap ($)</span>
        <input
          type="number"
          required
          min={1}
          max={10000}
          value={perListingCapDollars}
          onChange={(e) => setPerListingCapDollars(Number(e.target.value))}
          className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
          data-testid="promote-themes-form-listing-cap"
        />
      </label>

      <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 border border-[#262626] hover:border-[#525252] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]"
          data-testid="promote-themes-form-cancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 bg-cyan-400 text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
          data-testid="promote-themes-form-submit"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          Create theme
        </button>
      </div>
    </form>
  );
}
