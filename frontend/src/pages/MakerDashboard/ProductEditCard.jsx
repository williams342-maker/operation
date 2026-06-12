import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  updateMakerProduct, deleteMakerProduct, restoreMakerProduct,
  publishMakerProduct, unpublishMakerProduct, uploadMakerModel,
  promoteMakerProduct, renewMakerProduct,
  downloadProductStoryCard,
  upsertListingBudget, deleteListingBudget,
  aiTitleRefresh,
} from "../../lib/api";
import { listingPriceRange } from "../../lib/variantPricing";
import { useConfirm } from "./useConfirm";
import { toast } from "sonner";

export default function ProductEditCard({ product, archived = false, draft = false, onChanged, onBudgetChanged, stats = null, optionStats = null, indexing = null, comparison = null }) {
  const [confirm, confirmModal] = useConfirm();
  const [p, setP] = useState(product);
  const [open, setOpen] = useState(false);
  const [modelUrl, setModelUrl] = useState(product.model_url || "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [uploadingModel, setUploadingModel] = useState(false);
  const [modelErr, setModelErr] = useState("");
  const [modelDrag, setModelDrag] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [statusErr, setStatusErr] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [renewing, setRenewing] = useState(false);
  // iter315b — inline marketing-budget popover state. The button
  // surfaces the budget feature on the page makers actually visit
  // (Listings tab) instead of buried in the Marketing tab.
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetCap, setBudgetCap] = useState(
    product.marketing_budget_cents != null
      ? String(product.marketing_budget_cents / 100)
      : ""
  );
  const [budgetAutoRenew, setBudgetAutoRenew] = useState(
    product.marketing_budget_auto_renew !== false
  );
  const [budgetBusy, setBudgetBusy] = useState(false);
  const hasBudget = (product.marketing_budget_cents ?? 0) > 0;
  // Re-sync the popover inputs with the parent-decorated product
  // whenever the budget map upstream changes (e.g. another card just
  // saved or the listings list refreshed). Keeps the "$ X/mo" pill
  // label and the popover's pre-fill in lockstep.
  useEffect(() => {
    setBudgetCap(
      product.marketing_budget_cents != null
        ? String(product.marketing_budget_cents / 100)
        : ""
    );
    setBudgetAutoRenew(product.marketing_budget_auto_renew !== false);
  }, [product.marketing_budget_cents, product.marketing_budget_auto_renew]);
  const modelInputRef = useRef(null);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await updateMakerProduct(p.slug, { model_url: modelUrl.trim() || null });
      setP(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  };

  const onModelFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(glb|gltf)$/i.test(f.name)) {
      setModelErr("Only .glb / .gltf files are supported.");
      return;
    }
    setModelErr("");
    setUploadingModel(true);
    try {
      const { url } = await uploadMakerModel(f);
      setModelUrl(url);
      const updated = await updateMakerProduct(p.slug, { model_url: url });
      setP(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e2) {
      setModelErr(e2?.response?.data?.detail || "Upload failed.");
    } finally {
      setUploadingModel(false);
      if (modelInputRef.current) modelInputRef.current.value = "";
    }
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete "${p.title}"?`,
      body: "It hides from the shop instantly. Order history stays intact and you can restore the listing anytime from the Archived section.",
      confirmLabel: "Delete listing",
      cancelLabel: "Keep it",
      tone: "danger",
      testId: `confirm-delete-${p.slug}`,
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await deleteMakerProduct(p.slug);
      onChanged && onChanged();
    } finally {
      setRemoving(false);
    }
  };

  const onRestore = async () => {
    setRemoving(true);
    try {
      await restoreMakerProduct(p.slug);
      onChanged && onChanged();
    } finally {
      setRemoving(false);
    }
  };

  const onTogglePublish = async () => {
    setStatusErr("");
    setTogglingStatus(true);
    try {
      const fn = draft ? publishMakerProduct : unpublishMakerProduct;
      const updated = await fn(p.slug);
      setP(updated);
      onChanged && onChanged();
    } catch (e) {
      setStatusErr(e?.response?.data?.detail || "Could not change status.");
    } finally {
      setTogglingStatus(false);
    }
  };

  const onPromote = async (weeks = 1) => {
    const ok = await confirm({
      title: `Promote "${p.title}"?`,
      body: `${weeks} week${weeks > 1 ? "s" : ""} of front-of-search placement. $${(weeks * 5).toFixed(2)} will be added to your next payout deduction (no card charge — settled from earnings).`,
      confirmLabel: `Promote · $${(weeks * 5).toFixed(2)}`,
      cancelLabel: "Not yet",
      tone: "primary",
      testId: `confirm-promote-${p.slug}`,
    });
    if (!ok) return;
    setStatusErr("");
    setPromoting(true);
    try {
      const updated = await promoteMakerProduct(p.slug, weeks);
      setP(updated);
    } catch (e) {
      setStatusErr(e?.response?.data?.detail || "Promote failed.");
    } finally {
      setPromoting(false);
    }
  };

  const onRenew = async () => {
    setStatusErr("");
    setRenewing(true);
    try {
      const updated = await renewMakerProduct(p.slug);
      setP(updated);
      onChanged && onChanged();
    } catch (e) {
      setStatusErr(e?.response?.data?.detail || "Renew failed.");
    } finally {
      setRenewing(false);
    }
  };

  return (
    <>
    <div
      className={`border transition group ${
        archived ? "border-line opacity-60" :
        draft ? "border-amber-400/40 hover:border-amber-400" :
        "border-line hover:border-brand"
      }`}
      data-testid={`product-edit-${p.slug}`}
    >
      <div className="aspect-square overflow-hidden bg-surface relative">
        {p.images?.[0] && (
          <img
            src={p.images[0]}
            alt={p.title}
            className={`w-full h-full object-cover ${archived ? "" : "group-hover:scale-[1.03]"} transition duration-700`}
          />
        )}
        {archived && (
          <div className="absolute top-3 left-3 bg-paper/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 border border-red-400/40">
            ◇ Archived
          </div>
        )}
        {draft && (
          <div className="absolute top-3 left-3 bg-paper/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400 border border-amber-400/40">
            ✎ Draft
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted truncate">
          {p.category} · {p.technique}
          {p.model_url && <span className="text-brand ml-1.5">· 3D</span>}
          {p.variants?.length > 0 && <span className="text-brand ml-1.5">· {p.variants.length} var</span>}
          {p.promoted_until && new Date(p.promoted_until) > new Date() && (
            <span className="text-emerald-400 ml-1.5" data-testid={`product-promoted-${p.slug}`}>· Promoted</span>
          )}
        </div>
        {indexing && <IndexingBadge indexing={indexing} slug={p.slug} />}
        <div className="font-display text-base mt-1.5 leading-tight line-clamp-2 min-h-[2.4em]">{p.title}</div>
        <div className="flex items-center justify-between mt-2">
          <span className="font-display text-lg text-brand" data-testid={`product-price-${p.slug}`}>
            {(() => {
              // iter334r+ — When base price is 0 but variants carry
              // absolute prices, surface the variant range so makers
              // (and the buyer-facing card) don't see a misleading "$0".
              const base = Number(p.price || 0);
              const [min, max] = listingPriceRange(p);
              if (base > 0) return `$${base.toFixed(0)}`;
              if (max <= 0) return "$0";
              if (min === max) return `$${Math.round(min)}`;
              return `$${Math.round(min)} – $${Math.round(max)}`;
            })()}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted">
            {p.in_stock} in stock
          </span>
        </div>
        {/* iter334i — Inline pricing-verdict badge. Pulled from the
            latest AI Price Check cached in `price_comparisons`. Only
            renders when delta is meaningful (>=10% off median in either
            direction); on-target listings stay quiet to avoid badge
            noise on every card. */}
        {comparison && <PricingVerdictBadge comparison={comparison} slug={p.slug} />}
        {p.expires_at && !archived && (
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted mt-1" data-testid={`product-expires-${p.slug}`}>
            {p.renewal_option === "automatic" ? "Auto-renews" : "Expires"} {new Date(p.expires_at).toLocaleDateString()}
          </div>
        )}

        {stats && !archived && (
          <div
            className="mt-2 border-t border-line pt-2 space-y-1.5"
            data-testid={`product-stats-${p.slug}`}
          >
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              ◆ Last 30 days
            </div>
            <div className="font-mono text-[11px] text-ink">
              {stats.visits_30d} {stats.visits_30d === 1 ? "visit" : "visits"}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted pt-1">
              ◆ All time
            </div>
            <div className="font-mono text-[11px] text-ink">
              {stats.sales_all} {stats.sales_all === 1 ? "sale" : "sales"} · ${stats.revenue_all.toFixed(0)} revenue
            </div>
            <div className="font-mono text-[10px] text-ink-muted">
              {stats.renewals} {stats.renewals === 1 ? "renewal" : "renewals"}
            </div>
            {/* iter381 — most-picked variation options (paid orders). Helps
                sellers see which fonts/colors/finishes actually sell so they
                can prune dead options. */}
            {(optionStats?.options || []).length > 0 && (
              <>
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted pt-1">
                  ◆ Most picked
                </div>
                <div className="flex flex-wrap gap-1" data-testid={`product-option-stats-${p.slug}`}>
                  {optionStats.options.slice(0, 4).map((o) => (
                    <span
                      key={o.label}
                      className="font-mono text-[9px] px-1.5 py-0.5 border border-line text-ink"
                      title={`${o.count} unit${o.count === 1 ? "" : "s"} sold with ${o.label}`}
                    >
                      {o.label} <span className="text-brand">×{o.count}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {archived ? (
          <button
            onClick={onRestore}
            disabled={removing}
            className="mt-3 w-full font-mono text-[10px] uppercase tracking-[0.22em] border border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/15 hover:border-emerald-400 text-emerald-400 hover:text-emerald-300 py-2 transition disabled:opacity-50"
            data-testid={`product-restore-${p.slug}`}
          >
            {removing ? "Restoring…" : "↩ Restore listing"}
          </button>
        ) : (
          <>
            <Link
              to={`/maker/listings/${p.slug}/edit`}
              className="mt-3 w-full block text-center bg-brand hover:bg-brand-hover text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] py-2 transition"
              data-testid={`product-edit-link-${p.slug}`}
            >
              ✎ Edit listing
            </Link>

            {/* Secondary actions — primary 3 inline + overflow menu for
                3D model + Delete (the destructive / advanced ones). The
                kebab pattern keeps the visible card compact and pushes
                Delete one click away from the happy path of edit / promote /
                share. */}
            <div className="mt-2 grid grid-cols-2 gap-1.5" data-testid={`product-actions-${p.slug}`}>
              <ActionPill
                onClick={onTogglePublish}
                disabled={togglingStatus}
                tone={draft ? "emerald" : "amber"}
                testid={`product-toggle-publish-${p.slug}`}
                label={
                  togglingStatus ? "…" : draft ? "↑ Publish" : "↓ To draft"
                }
              />
              {!draft && (
                <ActionPill
                  onClick={() => onPromote(1)}
                  disabled={promoting || (p.promoted_until && new Date(p.promoted_until) > new Date())}
                  tone="emerald"
                  testid={`product-promote-${p.slug}`}
                  label={
                    promoting
                      ? "…"
                      : p.promoted_until && new Date(p.promoted_until) > new Date()
                        ? `✓ Promoted`
                        : "★ Promote $5/wk"
                  }
                />
              )}
              {!draft && (
                <ActionPill
                  onClick={() => setBudgetOpen((v) => !v)}
                  tone="cyan"
                  testid={`product-budget-${p.slug}`}
                  label={
                    hasBudget
                      ? `$ Budget · $${((product.marketing_budget_cents ?? 0) / 100).toFixed(0)}/mo`
                      : "$ Set marketing budget"
                  }
                />
              )}
              {!draft && (
                // Copy a share-friendly URL that points at the server-side
                // OG prerender endpoint. When pasted into Slack/Discord/
                // iMessage/Facebook DM, the link unfurls with a real card
                // (image + title + price) regardless of whether the
                // Cloudflare social-crawler Worker is active. Humans who
                // click the link get 302-redirected to the real product
                // page, so it's transparent to buyers.
                //
                // Also fires `/api/share/track` so the maker's own social
                // promo bumps the public "SHARE · N" badge on the listing.
                <ActionPill
                  onClick={async () => {
                    const origin = window.location.origin;
                    const url = `${origin}/api/og/product/${p.slug}`;
                    try {
                      await navigator.clipboard.writeText(url);
                      toast.success("Share link copied — paste into Slack/iMessage/Facebook for a rich preview.");
                    } catch {
                      // Older browsers / locked-down devices: fall back to a prompt.
                      window.prompt("Copy this share-friendly URL:", url);
                    }
                    // Fire-and-forget tracking — server enforces dedup + cap.
                    try {
                      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/share/track`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ kind: "product", slug: p.slug }),
                      });
                    } catch {/* silent */}
                  }}
                  tone="neutral"
                  testid={`product-copy-share-url-${p.slug}`}
                  label="⎘ Share link"
                />
              )}
              {!draft && (
                // One-click 9:16 Instagram/TikTok Story export. Free,
                // server-rendered, hero + QR + price baked in so the
                // maker can just save → post.
                <ActionPill
                  onClick={() => {
                    downloadProductStoryCard(p.slug);
                    toast.success("Story template downloading — drop it in Instagram or TikTok.");
                  }}
                  tone="neutral"
                  testid={`product-story-card-${p.slug}`}
                  label="↓ Story"
                />
              )}
              {draft && (
                <ActionPill
                  onClick={onRenew}
                  disabled={renewing}
                  tone="amber"
                  testid={`product-renew-${p.slug}`}
                  label={renewing ? "…" : "↻ Renew $0.20"}
                />
              )}
              <OverflowMenu
                onModel={() => setOpen((o) => !o)}
                modelLabel={open ? "− Close 3D" : "+ 3D model"}
                onDelete={onDelete}
                deleteLabel={removing ? "Deleting…" : "⊗ Delete"}
                deleteDisabled={removing}
                testid={`product-overflow-${p.slug}`}
              />
            </div>

            {/* iter315b — Inline marketing-budget popover. Saves to
                /api/maker/listing-budgets/{slug}. Optimistically
                updates the local product row so the pill label
                changes immediately. */}
            {budgetOpen && (
              <div
                className="mt-3 border-t border-cyan-900/40 pt-3 space-y-2"
                data-testid={`product-budget-form-${p.slug}`}
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400">
                  ◆ Marketing budget · /{p.slug}
                </div>
                <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
                  Crafters Market auto-renews the $5/week boost until your
                  monthly cap is hit. Resets on the 1st. Set to $0 to pause.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[10px] text-ink-muted">$</span>
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      step="1"
                      value={budgetCap}
                      onChange={(e) => setBudgetCap(e.target.value)}
                      disabled={budgetBusy}
                      className="w-20 bg-paper border border-line focus:border-cyan-500 font-mono text-[12px] text-ink px-2 py-1.5"
                      data-testid={`product-budget-cap-${p.slug}`}
                    />
                    <span className="font-mono text-[10px] text-ink-muted">/ mo</span>
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={budgetAutoRenew}
                      onChange={(e) => setBudgetAutoRenew(e.target.checked)}
                      disabled={budgetBusy || Number(budgetCap) <= 0}
                      className="accent-cyan-500"
                      data-testid={`product-budget-autorenew-${p.slug}`}
                    />
                    <span className="font-mono text-[10px] text-ink-muted">Auto-renew</span>
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      const cents = Math.round(Number(budgetCap) * 100);
                      if (!Number.isFinite(cents) || cents < 0 || cents > 100_000) {
                        toast.error("Cap must be $0 – $1000.");
                        return;
                      }
                      setBudgetBusy(true);
                      try {
                        if (cents === 0) {
                          await deleteListingBudget(p.slug);
                          toast.success("Budget removed.");
                        } else {
                          await upsertListingBudget(p.slug, {
                            monthly_cap_cents: cents,
                            auto_renew: budgetAutoRenew,
                          });
                          toast.success(`Budget set to $${(cents / 100).toFixed(0)}/mo.`);
                        }
                        // Refresh parent listing list so the pill picks
                        // up the new budget state via the next render.
                        onBudgetChanged?.();
                        onChanged?.();
                        setBudgetOpen(false);
                      } catch (e) {
                        toast.error(e?.response?.data?.detail || "Save failed.");
                      } finally {
                        setBudgetBusy(false);
                      }
                    }}
                    disabled={budgetBusy}
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300 hover:bg-cyan-500 hover:text-[#0a0a0a] border border-cyan-500/50 hover:border-cyan-500 px-3 py-1.5 transition disabled:opacity-50"
                    data-testid={`product-budget-save-${p.slug}`}
                  >
                    {budgetBusy ? "Saving…" : "Save budget"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBudgetOpen(false)}
                    disabled={budgetBusy}
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-ink-muted transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {statusErr && (
              <p
                className="font-mono text-[10px] text-red-400 mt-2"
                data-testid={`product-status-err-${p.slug}`}
              >
                {statusErr}
              </p>
            )}
            {open && (
              <form onSubmit={save} className="mt-3 space-y-2 border-t border-line pt-3" data-testid={`product-edit-form-${p.slug}`}>
                <input
                  ref={modelInputRef}
                  type="file"
                  accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                  onChange={onModelFile}
                  disabled={uploadingModel}
                  className="hidden"
                  data-testid={`product-model-file-${p.slug}`}
                />
                {/* iter313d Tier-2 — drag-drop wrapper around the model
                    upload button. The maker can drag a .glb straight
                    from the GLTF exporter onto the row instead of
                    click-pick-navigate-confirm. */}
                <div
                  onDragOver={(e) => { if (!uploadingModel) { e.preventDefault(); setModelDrag(true); } }}
                  onDragLeave={() => setModelDrag(false)}
                  onDrop={(e) => {
                    if (uploadingModel) return;
                    e.preventDefault();
                    setModelDrag(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) onModelFile({ target: { files: [f], value: "" } });
                  }}
                >
                  <button
                    type="button"
                    onClick={() => modelInputRef.current?.click()}
                    disabled={uploadingModel}
                    className={`w-full border border-dashed px-3 py-2 text-left font-mono text-[10px] transition disabled:opacity-50 ${
                      modelDrag
                        ? "border-brand text-brand bg-brand/5"
                        : "border-line hover:border-brand/60 text-ink-muted hover:text-brand"
                    }`}
                    data-testid={`product-model-upload-${p.slug}`}
                  >
                    {uploadingModel
                      ? "Uploading model…"
                      : modelDrag
                        ? "↓ Release to upload .glb / .gltf"
                        : p.model_url
                          ? "↻ Drop or click to replace .glb / .gltf"
                          : "+ Drop or click to upload .glb / .gltf"}
                  </button>
                </div>
                <input
                  type="url"
                  value={modelUrl}
                  onChange={(e) => setModelUrl(e.target.value)}
                  placeholder="…or paste a public model URL"
                  className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-[10px] text-ink"
                  data-testid={`product-model-url-${p.slug}`}
                />
                {modelErr && (
                  <p className="font-mono text-[10px] text-red-400" data-testid={`product-model-err-${p.slug}`}>{modelErr}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-industrial btn-primary disabled:opacity-50 text-[10px]"
                    data-testid={`product-save-${p.slug}`}
                  >
                    {busy ? "Saving…" : "Save URL"}
                  </button>
                  {saved && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand" data-testid={`product-saved-${p.slug}`}>
                      ✓ Saved
                    </span>
                  )}
                  {p.model_url && (
                    <a
                      href={`/shop/${p.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand ml-auto"
                    >
                      Preview ↗
                    </a>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
    {confirmModal}
    </>
  );
}

// Compact, bordered pill button used for every secondary action on a
// product card (publish/draft toggle, promote, share, renew, 3D edit,
// delete). Keeps the card tight while giving each action a real hover
// state — the previous bare-text-link styling looked unfinished.
//
// `tone` switches the accent color while keeping border/background /
// hover behavior consistent.
const TONES = {
  emerald: {
    border: "border-emerald-500/30 hover:border-emerald-400",
    text: "text-emerald-400 hover:text-emerald-300",
    hoverBg: "hover:bg-emerald-500/10",
  },
  amber: {
    border: "border-amber-500/30 hover:border-amber-400",
    text: "text-amber-400 hover:text-amber-300",
    hoverBg: "hover:bg-amber-500/10",
  },
  sky: {
    border: "border-sky-500/30 hover:border-sky-400",
    text: "text-sky-400 hover:text-sky-300",
    hoverBg: "hover:bg-sky-500/10",
  },
  cyan: {
    border: "border-cyan-500/30 hover:border-cyan-400",
    text: "text-cyan-400 hover:text-cyan-300",
    hoverBg: "hover:bg-cyan-500/10",
  },
  neutral: {
    border: "border-line hover:border-brand",
    text: "text-ink-muted hover:text-brand",
    hoverBg: "hover:bg-brand/5",
  },
  danger: {
    border: "border-line hover:border-red-400",
    text: "text-ink-muted hover:text-red-400",
    hoverBg: "hover:bg-red-500/5",
  },
};

function ActionPill({ onClick, disabled, tone = "neutral", testid, label }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1.5 border font-mono text-[9px] uppercase tracking-[0.18em] text-center transition disabled:opacity-50 disabled:cursor-not-allowed truncate ${t.border} ${t.text} ${t.hoverBg}`}
      data-testid={testid}
      title={label}
    >
      {label}
    </button>
  );
}

// Overflow menu for the destructive / advanced actions on each product
// card. Etsy "kebab" pattern — single ⋯ button reveals a tiny anchored
// popover with 3D-model + Delete. Click-outside-to-close handled via a
// document-level mousedown listener mounted only while the menu is open.
function OverflowMenu({ onModel, modelLabel, onDelete, deleteLabel, deleteDisabled, testid }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const t = TONES.neutral;
  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full px-2 py-1.5 border font-mono text-[9px] uppercase tracking-[0.18em] text-center transition ${t.border} ${t.text} ${t.hoverBg}`}
        data-testid={testid}
        aria-expanded={open}
        aria-haspopup="menu"
        title="More actions"
      >
        ⋯ More
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 w-44 bg-paper border border-line shadow-xl"
          role="menu"
          data-testid={`${testid}-menu`}
        >
          <button
            type="button"
            onClick={() => { setOpen(false); onModel(); }}
            className="w-full text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-brand hover:bg-brand/5 transition"
            role="menuitem"
            data-testid={`${testid}-3d`}
          >
            {modelLabel}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onDelete(); }}
            disabled={deleteDisabled}
            className="w-full text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-red-400 hover:text-red-300 hover:bg-red-500/10 transition disabled:opacity-50 border-t border-line"
            role="menuitem"
            data-testid={`${testid}-delete`}
          >
            {deleteLabel}
          </button>
        </div>
      )}
    </div>
  );
}



/**
 * IndexingBadge — small sitemap-status pill rendered under the category
 * line on each listing card. Hides the absence-of-data case (renders nothing
 * when `indexing` is null so cards stay tidy while the bulk fetch is in
 * flight).
 *
 * Three tiers (see `/api/maker/products/indexing-status`):
 *   • established    — in sitemap, >7 days old. Green dot.
 *   • submitted      — in sitemap, <=7 days old. Amber dot.
 *   • not_in_sitemap — draft / deleted / test slug. Gray dot.
 *
 * Tooltip explains what the tier means + what sitemap inclusion implies
 * for Google/Bing discoverability (no API-call to confirm actual indexing
 * since GSC OAuth isn't wired — see iter164 changelog).
 */
function IndexingBadge({ indexing, slug }) {
  const tier = indexing.tier;
  const days = indexing.days_in_sitemap;
  const source = indexing.source || "sitemap";

  const tiers = {
    established: {
      dot: "bg-emerald-400",
      label: "Indexed",
      text: "text-emerald-400",
      title: `In sitemap for ${days ?? 0}d — Google has had time to crawl and index.`,
    },
    submitted: {
      dot: "bg-amber-400",
      label: "Submitted",
      text: "text-amber-400",
      title: `Recently added to the sitemap (${days ?? 0}d). Search engines may not have crawled it yet — usually within 7 days.`,
    },
    not_in_sitemap: {
      dot: "bg-ink-muted",
      label: "Not in sitemap",
      text: "text-ink-muted",
      title: "Draft / archived / test listing — won't surface in search until published.",
    },
  };
  const cfg = tiers[tier] || tiers.not_in_sitemap;
  // Override the tooltip + label with the real GSC coverage state when
  // the row is sourced from the Search Console API.
  const gscVerified = source === "gsc";
  const tooltip = gscVerified
    ? `Verified by Google Search Console${indexing.gsc_coverage ? ` · ${indexing.gsc_coverage}` : ""}`
    : cfg.title;

  return (
    <div
      className="flex items-center gap-1.5 mt-1.5 font-mono text-[9px] uppercase tracking-[0.2em]"
      title={tooltip}
      data-testid={`indexing-badge-${slug}`}
      data-tier={tier}
      data-source={source}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      <span className={cfg.text}>{cfg.label}</span>
      {gscVerified && (
        <span
          className="inline-flex items-center gap-1 border border-emerald-500/40 bg-emerald-500/5 px-1.5 py-0.5 text-emerald-400 text-[8px] tracking-[0.18em]"
          data-testid={`gsc-verified-${slug}`}
          title="Index status returned directly from Google Search Console."
        >
          <svg viewBox="0 0 24 24" width="8" height="8" fill="currentColor" aria-hidden>
            <path d="M12 0L8.4 8.4 0 12l8.4 3.6L12 24l3.6-8.4L24 12l-8.4-3.6L12 0z" />
          </svg>
          Google
        </span>
      )}
    </div>
  );
}

// iter334i — Inline pricing-verdict badge. Decisive labels at-a-glance:
//   delta > +20%  → orange  "↑ N% above market"
//   delta > +10%  → amber   "↑ N% above market"
//   delta in ±10% → emerald "On target"
//   delta < -10%  → cyan    "↓ N% below — opportunity"
//   delta < -20%  → cyan + stronger weight (same color, bold)
// 10% buffer around median avoids badge noise — most listings within
// 10% are perfectly fine; we only flag the truly drifty ones.
// iter334k — Badge is now a click target: opens an inline popover
// with the AI-suggested price + a 1-click Apply button. After apply,
// the toast offers a 6s undo window so an accidental click is easily
// reversed without re-running the AI Price Check.
function PricingVerdictBadge({ comparison, slug }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const delta = comparison?.delta_pct;
  if (delta == null || Number.isNaN(delta)) return null;
  const abs = Math.abs(delta);

  // On-target: just a quiet emerald dot. No popover — there's nothing
  // to apply since the maker is already inside the ±10% buffer.
  if (abs < 10) {
    return (
      <div
        className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-emerald-400/80"
        title={`Your price is within ±10% of the AI-derived market median ($${comparison.price_median.toFixed(0)}).`}
        data-testid={`pricing-verdict-${slug}`}
      >
        <span className="w-1 h-1 bg-emerald-400 rounded-full" />
        On target
      </div>
    );
  }
  const isAbove = delta > 0;
  const intensity = abs >= 20 ? "strong" : "soft";
  const tone = isAbove
    ? (intensity === "strong"
        ? { color: "text-brand", dot: "bg-brand", weight: "font-bold" }
        : { color: "text-amber-400", dot: "bg-amber-400", weight: "" })
    : { color: "text-cyan-400", dot: "bg-cyan-400", weight: intensity === "strong" ? "font-bold" : "" };
  const arrow = isAbove ? "\u2191" : "\u2193";
  const pct = Math.round(abs);
  const verb = isAbove ? "above market" : "below — opportunity";
  const suggestedPrice = Number(comparison.price_median.toFixed(2));

  const onApply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Snapshot the current price so the undo toast can restore it.
      const prevPrice = Number(comparison.listed_price_at_check || 0);
      const productSlug = slug;
      await updateMakerProduct(productSlug, { price: suggestedPrice });
      setOpen(false);

      // iter334l — When the price drop is meaningful (>=10%), kick off
      // a background title-refresh suggestion. The title can lag the
      // price (e.g. "Heirloom Walnut…" doesn't fit a $50 sale price),
      // so we proactively pitch a fresh framing. Stay off the critical
      // path — show in a follow-up toast so the Apply success isn't
      // blocked on a 5-10s AI call.
      const dropPct = prevPrice > 0 ? ((prevPrice - suggestedPrice) / prevPrice) * 100 : 0;
      if (Math.abs(dropPct) >= 10) {
        // Fire-and-forget; on success, raise a second toast with the
        // suggestion + a one-click apply.
        aiTitleRefresh(productSlug, prevPrice, suggestedPrice)
          .then((titleResult) => {
            const newTitle = titleResult?.suggested_title?.trim();
            const oldTitle = (titleResult?.current_title || "").trim();
            if (!newTitle || newTitle === oldTitle) return;
            toast(`◆ Suggested title: "${newTitle}"`, {
              description: titleResult.rationale || "Tap Apply to update.",
              duration: 10000,
              action: {
                label: "Apply title",
                onClick: async () => {
                  try {
                    await updateMakerProduct(productSlug, { title: newTitle });
                    toast.success("Title updated.");
                    setTimeout(() => window.location.reload(), 600);
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || "Couldn't update title.");
                  }
                },
              },
            });
          })
          .catch(() => { /* AI busy — silently skip */ });
      }

      toast.success(`Price set to $${suggestedPrice.toFixed(2)}`, {
        description: prevPrice > 0 ? `Was $${prevPrice.toFixed(2)} — auto-saved.` : "Auto-saved.",
        duration: 6000,
        action: prevPrice > 0 ? {
          label: "Undo",
          onClick: async () => {
            try {
              await updateMakerProduct(productSlug, { price: prevPrice });
              toast.success(`Reverted to $${prevPrice.toFixed(2)}`);
              if (typeof window !== "undefined") {
                window.location.reload();
              }
            } catch (e) {
              toast.error(e?.response?.data?.detail || "Couldn't undo. Edit the listing manually to revert.");
            }
          },
        } : undefined,
      });
      // Refresh so badge + price tile reflect the new value.
      setTimeout(() => { if (typeof window !== "undefined") window.location.reload(); }, 800);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update price — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={`inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] ${tone.color} ${tone.weight} hover:underline cursor-pointer transition`}
        title={isAbove
          ? `Click to see the AI-suggested median ($${suggestedPrice.toFixed(2)}) and one-click apply.`
          : `Click to apply the AI median ($${suggestedPrice.toFixed(2)}) — your current price may be leaving money on the table.`}
        data-testid={`pricing-verdict-${slug}`}
        aria-expanded={open}
      >
        <span className={`w-1.5 h-1.5 ${tone.dot} rounded-full`} />
        {arrow} {pct}% {verb}
      </button>
      {open && (
        <div
          className="absolute z-20 left-0 top-full mt-2 w-64 bg-paper border border-line shadow-2xl p-3 space-y-2"
          data-testid={`pricing-verdict-popover-${slug}`}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
            AI-suggested median
          </p>
          <p className="font-mono text-xl text-ink font-bold">
            ${suggestedPrice.toFixed(2)}
          </p>
          <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
            {isAbove
              ? `Your current price is ${pct}% above. Lower to the median to test elasticity.`
              : `Your current price is ${pct}% below. Raise to the median to capture upside.`}
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onApply}
              disabled={busy}
              className="flex-1 px-2 py-2 bg-brand hover:bg-brand-hover text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.2em] font-bold disabled:opacity-60 disabled:cursor-wait transition"
              data-testid={`pricing-verdict-apply-${slug}`}
            >
              {busy ? "Saving…" : "Apply"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-2 border border-line hover:border-ink-muted text-ink-muted hover:text-ink font-mono text-[10px] uppercase tracking-[0.2em] transition"
              data-testid={`pricing-verdict-cancel-${slug}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

