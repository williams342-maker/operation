/**
 * iter346 — Admin: On-site promo banner CMS.
 *
 * Mounted in AdsTab.jsx. Lets admin create scheduled banners that render
 * on the public site (home_hero, shop_top, cart_top, product_top, global_top).
 *
 * Visually distinct from PromoteThemesCard (amber accents vs cyan) so admin
 * can tell at a glance which surface they're managing.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Megaphone, Plus, Loader2, X, Play, Pause, Square, Trash2, ExternalLink } from "lucide-react";
import {
  adminFetchSitePromos,
  adminCreateSitePromo,
  adminUpdateSitePromo,
  adminDeleteSitePromo,
} from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";

const PLACEMENT_LABELS = {
  home_hero:    "Homepage hero (above Hero)",
  shop_top:     "Shop page (top)",
  cart_top:     "Cart page (top)",
  product_top:  "Product page (top)",
  global_top:   "Site-wide (every page, above nav)",
};
const PLACEMENTS = Object.keys(PLACEMENT_LABELS);

const STATUS_TONE = {
  active:    "border-emerald-700/50 text-emerald-300",
  scheduled: "border-amber-700/50 text-amber-300",
  paused:    "border-orange-700/50 text-orange-300",
  ended:     "border-line text-ink-muted",
};

const TONES = [
  { id: "default",     label: "Default (orange)" },
  { id: "celebration", label: "Celebration (amber)" },
  { id: "warning",     label: "Warning (red)" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function plusDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function SitePromosCard() {
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [confirm, confirmModal] = useConfirm();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await adminFetchSitePromos();
        if (!cancelled) setPromos(r.promos || []);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Failed to load promos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const onStatus = async (promoId, status) => {
    setBusy(`${promoId}:${status}`);
    try {
      await adminUpdateSitePromo(promoId, { status });
      toast.success(`Promo → ${status}.`);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Status change failed.");
    } finally { setBusy(""); }
  };

  const onDelete = async (promo) => {
    const ok = await confirm({
      title: `Delete "${promo.title}"?`,
      body: "This permanently removes the promo. The buyer-side localStorage dismissal flag is left behind but harmless.",
      confirmLabel: "Delete promo",
      tone: "warn",
      testId: `confirm-delete-promo-${promo.promo_id}`,
    });
    if (!ok) return;
    setBusy(`${promo.promo_id}:delete`);
    try {
      await adminDeleteSitePromo(promo.promo_id);
      toast.success("Promo deleted.");
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed.");
    } finally { setBusy(""); }
  };

  return (
    <div className="border border-line p-4 md:p-5" data-testid="site-promos-card">
      {confirmModal}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-amber-300 mb-2 flex items-center gap-1.5">
            <Megaphone size={12} /> ◆ On-site Promos
          </div>
          <h3 className="font-display text-2xl uppercase mb-1">Site Banner CMS</h3>
          <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
            Schedule banners that render directly on the public site (homepage hero, /shop top, etc.). Use this for sales, announcements, or seasonal pushes. Visitors can dismiss banners if you mark them dismissible.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-2 border border-amber-700/50 hover:border-amber-400 text-amber-300 font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-1.5"
          data-testid="site-promos-new"
        >
          {showForm ? <X size={11} /> : <Plus size={11} />}
          {showForm ? "Cancel" : "New promo"}
        </button>
      </div>

      {showForm && (
        <NewPromoForm
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); reload(); }}
        />
      )}

      <div className="mt-4">
        {loading && <p className="font-mono text-xs text-ink-muted">Loading promos…</p>}
        {!loading && promos.length === 0 && (
          <p className="font-mono text-xs text-ink-muted" data-testid="site-promos-empty">
            No promos yet. Click &ldquo;New promo&rdquo; to schedule the first one.
          </p>
        )}
        {!loading && promos.length > 0 && (
          <div className="border border-line divide-y divide-line" data-testid="site-promos-list">
            {promos.map((p) => (
              <div
                key={p.promo_id}
                className="p-3 flex items-start justify-between gap-3 flex-wrap"
                data-testid={`site-promo-row-${p.promo_id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display text-lg text-ink">{p.title}</span>
                    <span className={`font-mono text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 border ${STATUS_TONE[p.status] || ""}`}>
                      {p.status}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-amber-300 border border-amber-700/30 px-1.5 py-0.5">
                      {p.placement}
                    </span>
                    {p.tone && p.tone !== "default" && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted border border-line px-1.5 py-0.5">
                        {p.tone}
                      </span>
                    )}
                    {!p.dismissible && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-red-300 border border-red-700/30 px-1.5 py-0.5">
                        non-dismissible
                      </span>
                    )}
                  </div>
                  {p.body && (
                    <div className="font-mono text-xs text-ink mt-1 line-clamp-2">{p.body}</div>
                  )}
                  <div className="font-mono text-[10px] text-ink-muted mt-1 flex flex-wrap gap-3">
                    <span>{p.start_date} → {p.end_date}</span>
                    {p.cta_label && p.cta_url && (
                      <span className="flex items-center gap-1">
                        CTA: &ldquo;{p.cta_label}&rdquo;
                        <a href={p.cta_url} target="_blank" rel="noreferrer" className="text-amber-300 hover:underline inline-flex items-center gap-0.5">
                          {p.cta_url}<ExternalLink size={9} />
                        </a>
                      </span>
                    )}
                    <span>priority {p.priority}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {p.status !== "active" && (
                    <button
                      onClick={() => onStatus(p.promo_id, "active")}
                      disabled={busy === `${p.promo_id}:active`}
                      className="px-2 py-1 border border-emerald-700/50 hover:border-emerald-400 text-emerald-300 font-mono text-[9px] uppercase tracking-[0.22em] flex items-center gap-1 disabled:opacity-50"
                      data-testid={`site-promo-activate-${p.promo_id}`}
                    >
                      <Play size={10} /> Activate
                    </button>
                  )}
                  {p.status === "active" && (
                    <button
                      onClick={() => onStatus(p.promo_id, "paused")}
                      disabled={busy === `${p.promo_id}:paused`}
                      className="px-2 py-1 border border-orange-700/50 hover:border-orange-400 text-orange-300 font-mono text-[9px] uppercase tracking-[0.22em] flex items-center gap-1 disabled:opacity-50"
                      data-testid={`site-promo-pause-${p.promo_id}`}
                    >
                      <Pause size={10} /> Pause
                    </button>
                  )}
                  {p.status !== "ended" && (
                    <button
                      onClick={() => onStatus(p.promo_id, "ended")}
                      disabled={busy === `${p.promo_id}:ended`}
                      className="px-2 py-1 border border-line hover:border-red-500 hover:text-red-300 text-ink-muted font-mono text-[9px] uppercase tracking-[0.22em] flex items-center gap-1 disabled:opacity-50"
                      data-testid={`site-promo-end-${p.promo_id}`}
                    >
                      <Square size={10} /> End
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(p)}
                    disabled={busy === `${p.promo_id}:delete`}
                    className="px-2 py-1 border border-line hover:border-red-500 hover:text-red-300 text-ink-muted font-mono text-[9px] uppercase tracking-[0.22em] flex items-center gap-1 disabled:opacity-50"
                    data-testid={`site-promo-delete-${p.promo_id}`}
                    title="Delete promo"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewPromoForm({ onCancel, onCreated }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [placement, setPlacement] = useState("home_hero");
  const [tone, setTone] = useState("default");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(plusDays(todayIso(), 7));
  const [priority, setPriority] = useState(0);
  const [dismissible, setDismissible] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminCreateSitePromo({
        title: title.trim(),
        body: body.trim(),
        cta_label: ctaLabel.trim(),
        cta_url: ctaUrl.trim(),
        image_url: imageUrl.trim(),
        placement,
        tone,
        start_date: startDate,
        end_date: endDate,
        priority: Number(priority) || 0,
        dismissible,
      });
      toast.success(`Promo "${title}" created (scheduled). Activate it to go live.`);
      onCreated?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create promo.");
    } finally { setBusy(false); }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-4 border border-amber-900/40 bg-amber-950/10 p-4 grid sm:grid-cols-2 gap-3"
      data-testid="site-promos-form"
    >
      <label className="block sm:col-span-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Headline</span>
        <input
          type="text" required minLength={2} maxLength={120}
          value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Mother's Day Sale — 20% off"
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none"
          data-testid="site-promos-form-title"
        />
      </label>

      <label className="block sm:col-span-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          Body (optional · max 400 chars)
        </span>
        <textarea
          rows={2} maxLength={400}
          value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Shop wall art and custom signs through Sunday."
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none resize-y"
          data-testid="site-promos-form-body"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">CTA label (optional)</span>
        <input
          type="text" maxLength={40}
          value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)}
          placeholder="Shop the sale"
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none"
          data-testid="site-promos-form-cta-label"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">CTA URL (optional, relative or full)</span>
        <input
          type="text" maxLength={400}
          value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)}
          placeholder="/shop?category=Wall+Art"
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none"
          data-testid="site-promos-form-cta-url"
        />
      </label>

      <label className="block sm:col-span-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Image URL (optional)</span>
        <input
          type="text" maxLength={500}
          value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://images.unsplash.com/..."
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none"
          data-testid="site-promos-form-image"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Placement</span>
        <select
          value={placement} onChange={(e) => setPlacement(e.target.value)}
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none"
          data-testid="site-promos-form-placement"
        >
          {PLACEMENTS.map((p) => (
            <option key={p} value={p}>{PLACEMENT_LABELS[p]}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Tone</span>
        <select
          value={tone} onChange={(e) => setTone(e.target.value)}
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none"
          data-testid="site-promos-form-tone"
        >
          {TONES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Start date</span>
        <input
          type="date" required
          value={startDate} onChange={(e) => setStartDate(e.target.value)}
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none"
          data-testid="site-promos-form-start"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">End date</span>
        <input
          type="date" required
          value={endDate} onChange={(e) => setEndDate(e.target.value)}
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none"
          data-testid="site-promos-form-end"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Priority (higher wins when multiple share a slot)</span>
        <input
          type="number" min={0} max={100}
          value={priority} onChange={(e) => setPriority(e.target.value)}
          className="mt-1 w-full bg-paper border border-line focus:border-amber-400 px-3 py-2 font-mono text-sm text-ink outline-none"
          data-testid="site-promos-form-priority"
        />
      </label>

      <label className="flex items-center gap-2 mt-6 cursor-pointer">
        <input
          type="checkbox" checked={dismissible}
          onChange={(e) => setDismissible(e.target.checked)}
          className="accent-amber-400"
          data-testid="site-promos-form-dismissible"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          Visitors can dismiss this banner
        </span>
      </label>

      <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
        <button
          type="button" onClick={onCancel}
          className="px-3 py-2 border border-line hover:border-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
          data-testid="site-promos-form-cancel"
        >
          Cancel
        </button>
        <button
          type="submit" disabled={busy}
          className="px-4 py-2 bg-amber-400 text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
          data-testid="site-promos-form-submit"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Megaphone size={11} />}
          Create promo
        </button>
      </div>
    </form>
  );
}
