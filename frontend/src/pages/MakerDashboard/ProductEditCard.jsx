import React, { useRef, useState } from "react";
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
      <div className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          {p.category} · {p.technique}
          {p.model_url && <span className="text-[#ff4500] ml-2">· 3D</span>}
          {p.variants?.length > 0 && <span className="text-[#ff4500] ml-2">· {p.variants.length} variants</span>}
          {p.promoted_until && new Date(p.promoted_until) > new Date() && (
            <span className="text-emerald-400 ml-2" data-testid={`product-promoted-${p.slug}`}>· Promoted</span>
          )}
        </div>
        <div className="font-display text-xl mt-2 leading-tight">{p.title}</div>
        <div className="flex items-center justify-between mt-3">
          <span className="font-display text-2xl text-[#ff4500]">${p.price.toFixed(0)}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            {p.in_stock} in stock
          </span>
        </div>
        {p.expires_at && !archived && (
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mt-2" data-testid={`product-expires-${p.slug}`}>
            Expires {new Date(p.expires_at).toLocaleDateString()}
          </div>
        )}

        {archived ? (
          <button
            onClick={onRestore}
            disabled={removing}
            className="mt-3 w-full font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400 hover:text-emerald-300 border-t border-[#262626] pt-3 text-left disabled:opacity-50"
            data-testid={`product-restore-${p.slug}`}
          >
            {removing ? "Restoring…" : "↩ Restore listing"}
          </button>
        ) : (
          <>
            <button
              onClick={onTogglePublish}
              disabled={togglingStatus}
              className={`mt-3 w-full font-mono text-[10px] uppercase tracking-[0.22em] border-t border-[#262626] pt-3 text-left disabled:opacity-50 ${
                draft ? "text-emerald-400 hover:text-emerald-300" : "text-[#a3a3a3] hover:text-amber-400"
              }`}
              data-testid={`product-toggle-publish-${p.slug}`}
            >
              {togglingStatus
                ? "…"
                : draft
                ? "↑ Publish listing"
                : "↓ Move to draft"}
            </button>
            {statusErr && (
              <p
                className="font-mono text-[10px] text-red-400 mt-1"
                data-testid={`product-status-err-${p.slug}`}
              >
                {statusErr}
              </p>
            )}
            {!draft && (
              <button
                onClick={() => onPromote(1)}
                disabled={promoting || (p.promoted_until && new Date(p.promoted_until) > new Date())}
                className="mt-2 w-full font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400 hover:text-emerald-300 text-left disabled:opacity-50"
                data-testid={`product-promote-${p.slug}`}
              >
                {promoting
                  ? "…"
                  : p.promoted_until && new Date(p.promoted_until) > new Date()
                  ? `✓ Promoted until ${new Date(p.promoted_until).toLocaleDateString()}`
                  : "★ Promote · $5/week"}
              </button>
            )}
            {!draft && (
              <button
                onClick={onShare}
                disabled={sharing}
                className="mt-2 w-full font-mono text-[10px] uppercase tracking-[0.22em] text-sky-400 hover:text-sky-300 text-left disabled:opacity-50"
                data-testid={`product-share-buffer-${p.slug}`}
              >
                {sharing ? "Queueing…" : "↗ Share to Buffer (social)"}
              </button>
            )}
            {draft && (
              <button
                onClick={onRenew}
                disabled={renewing}
                className="mt-2 w-full font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400 hover:text-amber-300 text-left disabled:opacity-50"
                data-testid={`product-renew-${p.slug}`}
              >
                {renewing ? "…" : "↻ Renew listing · $0.20"}
              </button>
            )}
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-2 w-full font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] text-left"
              data-testid={`product-toggle-edit-${p.slug}`}
            >
              {open ? "− Close 3D editor" : "+ Add / edit 3D model"}
            </button>
            {open && (
              <form onSubmit={save} className="mt-3 space-y-2" data-testid={`product-edit-form-${p.slug}`}>
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
                  className="w-full border border-dashed border-[#262626] hover:border-[#ff4500]/60 px-3 py-3 text-left font-mono text-[11px] text-[#a3a3a3] hover:text-[#ff4500] transition disabled:opacity-50"
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
                  className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-[11px] text-[#e5e5e5]"
                  data-testid={`product-model-url-${p.slug}`}
                />
                {modelErr && (
                  <p className="font-mono text-[10px] text-red-400" data-testid={`product-model-err-${p.slug}`}>{modelErr}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-industrial btn-primary disabled:opacity-50 text-xs"
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
            <button
              onClick={onDelete}
              disabled={removing}
              className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-red-400 transition disabled:opacity-50"
              data-testid={`product-delete-${p.slug}`}
            >
              {removing ? "Deleting…" : "⊗ Delete listing"}
            </button>
          </>
        )}
      </div>
    </div>
    {confirmModal}
    </>
  );
}
