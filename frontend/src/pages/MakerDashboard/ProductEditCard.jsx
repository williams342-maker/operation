import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  updateMakerProduct, deleteMakerProduct, restoreMakerProduct,
  publishMakerProduct, unpublishMakerProduct, uploadMakerModel,
  promoteMakerProduct, renewMakerProduct, makerShareListingToBuffer,
} from "../../lib/api";
import { useConfirm } from "./useConfirm";
import { toast } from "sonner";

export default function ProductEditCard({ product, archived = false, draft = false, onChanged }) {
  const [confirm, confirmModal] = useConfirm();
  const [p, setP] = useState(product);
  const [open, setOpen] = useState(false);
  const [modelUrl, setModelUrl] = useState(product.model_url || "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [uploadingModel, setUploadingModel] = useState(false);
  const [modelErr, setModelErr] = useState("");
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [statusErr, setStatusErr] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [sharing, setSharing] = useState(false);
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

  const onShare = async () => {
    setSharing(true);
    try {
      const row = await makerShareListingToBuffer(p.slug);
      const ok = row.success_count || 0;
      const bad = row.failed_count || 0;
      if (ok > 0 && bad === 0) {
        toast.success(`Queued on ${ok} channel${ok === 1 ? "" : "s"} via Buffer.`);
      } else if (ok > 0) {
        toast.warning(`Queued on ${ok}/${ok + bad} channels — ${bad} failed.`);
      } else {
        const firstErr = row.results?.[0]?.error || "All channels failed.";
        toast.error(`Buffer rejected: ${firstErr}`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Share to Buffer failed.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
    <div
      className={`border transition group ${
        archived ? "border-[#262626] opacity-60" :
        draft ? "border-amber-400/40 hover:border-amber-400" :
        "border-[#262626] hover:border-[#ff4500]"
      }`}
      data-testid={`product-edit-${p.slug}`}
    >
      <div className="aspect-square overflow-hidden bg-[#121212] relative">
        {p.images?.[0] && (
          <img
            src={p.images[0]}
            alt={p.title}
            className={`w-full h-full object-cover ${archived ? "" : "group-hover:scale-[1.03]"} transition duration-700`}
          />
        )}
        {archived && (
          <div className="absolute top-3 left-3 bg-black/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 border border-red-400/40">
            ◇ Archived
          </div>
        )}
        {draft && (
          <div className="absolute top-3 left-3 bg-black/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400 border border-amber-400/40">
            ✎ Draft
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#a3a3a3] truncate">
          {p.category} · {p.technique}
          {p.model_url && <span className="text-[#ff4500] ml-1.5">· 3D</span>}
          {p.variants?.length > 0 && <span className="text-[#ff4500] ml-1.5">· {p.variants.length} var</span>}
          {p.promoted_until && new Date(p.promoted_until) > new Date() && (
            <span className="text-emerald-400 ml-1.5" data-testid={`product-promoted-${p.slug}`}>· Promoted</span>
          )}
        </div>
        <div className="font-display text-base mt-1.5 leading-tight line-clamp-2 min-h-[2.4em]">{p.title}</div>
        <div className="flex items-center justify-between mt-2">
          <span className="font-display text-lg text-[#ff4500]">${p.price.toFixed(0)}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#a3a3a3]">
            {p.in_stock} in stock
          </span>
        </div>
        {p.expires_at && !archived && (
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#525252] mt-1" data-testid={`product-expires-${p.slug}`}>
            Expires {new Date(p.expires_at).toLocaleDateString()}
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
              className="mt-3 w-full block text-center bg-[#ff4500] hover:bg-[#ff5f1f] text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] py-2 transition"
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
                  onClick={onShare}
                  disabled={sharing}
                  tone="sky"
                  testid={`product-share-buffer-${p.slug}`}
                  label={sharing ? "Queueing…" : "↗ Share social"}
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
            {statusErr && (
              <p
                className="font-mono text-[10px] text-red-400 mt-2"
                data-testid={`product-status-err-${p.slug}`}
              >
                {statusErr}
              </p>
            )}
            {open && (
              <form onSubmit={save} className="mt-3 space-y-2 border-t border-[#262626] pt-3" data-testid={`product-edit-form-${p.slug}`}>
                <input
                  ref={modelInputRef}
                  type="file"
                  accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                  onChange={onModelFile}
                  disabled={uploadingModel}
                  className="hidden"
                  data-testid={`product-model-file-${p.slug}`}
                />
                <button
                  type="button"
                  onClick={() => modelInputRef.current?.click()}
                  disabled={uploadingModel}
                  className="w-full border border-dashed border-[#262626] hover:border-[#ff4500]/60 px-3 py-2 text-left font-mono text-[10px] text-[#a3a3a3] hover:text-[#ff4500] transition disabled:opacity-50"
                  data-testid={`product-model-upload-${p.slug}`}
                >
                  {uploadingModel
                    ? "Uploading model…"
                    : p.model_url
                      ? "↻ Replace .glb / .gltf"
                      : "+ Upload .glb / .gltf"}
                </button>
                <input
                  type="url"
                  value={modelUrl}
                  onChange={(e) => setModelUrl(e.target.value)}
                  placeholder="…or paste a public model URL"
                  className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-[10px] text-[#e5e5e5]"
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
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]" data-testid={`product-saved-${p.slug}`}>
                      ✓ Saved
                    </span>
                  )}
                  {p.model_url && (
                    <a
                      href={`/shop/${p.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] ml-auto"
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
  neutral: {
    border: "border-[#262626] hover:border-[#ff4500]",
    text: "text-[#a3a3a3] hover:text-[#ff4500]",
    hoverBg: "hover:bg-[#ff4500]/5",
  },
  danger: {
    border: "border-[#262626] hover:border-red-400",
    text: "text-[#525252] hover:text-red-400",
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
          className="absolute right-0 top-full mt-1 z-20 w-44 bg-[#0d0d0d] border border-[#262626] shadow-xl"
          role="menu"
          data-testid={`${testid}-menu`}
        >
          <button
            type="button"
            onClick={() => { setOpen(false); onModel(); }}
            className="w-full text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#a3a3a3] hover:text-[#ff4500] hover:bg-[#ff4500]/5 transition"
            role="menuitem"
            data-testid={`${testid}-3d`}
          >
            {modelLabel}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onDelete(); }}
            disabled={deleteDisabled}
            className="w-full text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-red-400 hover:text-red-300 hover:bg-red-500/10 transition disabled:opacity-50 border-t border-[#1f1f1f]"
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
