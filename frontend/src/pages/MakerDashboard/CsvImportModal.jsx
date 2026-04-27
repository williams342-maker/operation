import React, { useRef, useState } from "react";
import { Upload, FileText, CheckCircle2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";
import { csvImportPreview, csvImportCommit } from "../../lib/api";
import useModalA11y from "../../hooks/useModalA11y";

/** CSV Import — Etsy first.
 *  Two-step flow: upload + parse → preview → commit.
 *  Default publish status is 'draft' so makers review each row before going live. */
export default function CsvImportModal({ onClose, onImported }) {
  const ref = useModalA11y(onClose);
  const fileRef = useRef(null);
  const [stage, setStage] = useState("pick");        // pick | preview | committing | done
  const [source, setSource] = useState("etsy");      // etsy | shopify
  const [preview, setPreview] = useState(null);
  const [publishStatus, setPublishStatus] = useState("draft");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setErr("File too large (max 5MB)."); return; }
    setErr(""); setBusy(true);
    try {
      const r = await csvImportPreview(file, source);
      setPreview(r);
      setStage("preview");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not parse CSV.");
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!preview?.preview_rows?.length) return;
    setStage("committing"); setErr("");
    try {
      const r = await csvImportCommit(preview.preview_rows, publishStatus, source);
      toast.success(`Imported ${r.inserted} listings as ${r.status}.`);
      setStage("done");
      setTimeout(() => { onImported?.(); }, 800);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Import failed.");
      setStage("preview");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} className="relative bg-[#0a0a0a] border border-[#262626] w-full max-w-3xl max-h-[90vh] overflow-y-auto"
           data-testid="csv-import-modal">
        <div className="sticky top-0 bg-[#0a0a0a] border-b border-[#262626] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
              ◆ Migrate from {source === "shopify" ? "Shopify" : "Etsy"}
            </div>
            <h2 className="font-display text-2xl uppercase">CSV Import</h2>
          </div>
          <button onClick={onClose} aria-label="Close" data-testid="csv-modal-close"
            className="p-2 border border-[#262626] hover:border-[#ff4500]">
            <X size={14} />
          </button>
        </div>

        <div className="p-6">
          {stage === "pick" && (
            <div className="space-y-5" data-testid="csv-stage-pick">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                  Source platform
                </div>
                <div className="flex gap-2">
                  <button
                    type="button" onClick={() => setSource("etsy")}
                    className={`px-4 py-2 border font-mono text-[11px] uppercase tracking-[0.22em] ${source === "etsy" ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]" : "border-[#262626] text-[#a3a3a3]"}`}
                    data-testid="csv-source-etsy"
                  >
                    Etsy
                  </button>
                  <button
                    type="button" onClick={() => setSource("shopify")}
                    className={`px-4 py-2 border font-mono text-[11px] uppercase tracking-[0.22em] ${source === "shopify" ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]" : "border-[#262626] text-[#a3a3a3]"}`}
                    data-testid="csv-source-shopify"
                  >
                    Shopify
                  </button>
                </div>
              </div>
              {source === "etsy" ? (
                <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
                  Export from Etsy: <b>Shop Manager → Settings → Options → Download Data → Currently for sale listings (CSV)</b>.
                  Upload that file. We'll parse it, show you a preview, then commit as drafts (recommended) or publish all at once.
                </p>
              ) : (
                <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
                  Export from Shopify: <b>Admin → Products → Export → All products → CSV for Excel, Numbers, or other spreadsheet programs</b>.
                  We aggregate variant rows by Handle (combining stock + images), and skip rows without a positive price.
                </p>
              )}
              <div className="border border-[#262626] bg-[#0d0d0d] p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">What we map</div>
                {source === "etsy" ? (
                  <ul className="font-mono text-[11px] text-[#e5e5e5] space-y-1">
                    <li>• <span className="text-[#ff4500]">TITLE</span> · <span className="text-[#ff4500]">DESCRIPTION</span> · <span className="text-[#ff4500]">PRICE</span> · <span className="text-[#ff4500]">QUANTITY</span></li>
                    <li>• <span className="text-[#ff4500]">TAGS</span> (up to 13) · <span className="text-[#ff4500]">MATERIALS</span> (up to 8)</li>
                    <li>• <span className="text-[#ff4500]">IMAGE1–IMAGE10</span> URLs (kept as-is — host migration is Phase 2.5)</li>
                  </ul>
                ) : (
                  <ul className="font-mono text-[11px] text-[#e5e5e5] space-y-1">
                    <li>• <span className="text-[#ff4500]">Title</span> · <span className="text-[#ff4500]">Body (HTML)</span> stripped to plain text · <span className="text-[#ff4500]">Variant Price</span></li>
                    <li>• <span className="text-[#ff4500]">Variant Inventory Qty</span> summed across all variants of the Handle</li>
                    <li>• <span className="text-[#ff4500]">Tags</span> (up to 13) · <span className="text-[#ff4500]">Type</span> → category fallback</li>
                    <li>• <span className="text-[#ff4500]">Image Src</span> across the Handle's variant rows (up to 10 unique)</li>
                  </ul>
                )}
                <div className="font-mono text-[10px] text-[#737373] mt-2 italic">
                  Variations, SKUs, custom processing fields are skipped — re-add them inside Crafters Market after import.
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".csv" onChange={onPick}
                className="hidden" data-testid="csv-file-input" />
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="btn-industrial btn-primary w-full inline-flex items-center justify-center gap-2 disabled:opacity-50"
                data-testid="csv-pick-btn">
                <Upload size={14} /> {busy ? "Parsing…" : "Choose CSV file"}
              </button>
              {err && <p className="font-mono text-xs text-red-400" data-testid="csv-pick-err">{err}</p>}
            </div>
          )}

          {stage === "preview" && preview && (
            <div className="space-y-5" data-testid="csv-stage-preview">
              <div className="border border-[#ff4500] bg-[#ff4500]/5 p-4 flex items-start gap-3">
                <FileText size={18} className="text-[#ff4500] mt-0.5 shrink-0" />
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
                    Ready to import
                  </div>
                  <div className="font-mono text-xs text-[#e5e5e5]">
                    {preview.total_parsed} valid rows · {preview.total_skipped} skipped (missing title or price)
                  </div>
                  {preview.total_parsed > 50 && (
                    <div className="font-mono text-[10px] text-[#a3a3a3] mt-1.5 italic">
                      Note: This pass commits the first 50. Re-upload to import the rest.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                  Publish status for imported listings
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setPublishStatus("draft")}
                    className={`px-3 py-2 border font-mono text-[11px] uppercase tracking-[0.22em] ${publishStatus === "draft" ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]" : "border-[#262626] text-[#a3a3a3]"}`}
                    data-testid="csv-publish-draft">
                    Drafts (recommended)
                  </button>
                  <button onClick={() => setPublishStatus("active")}
                    className={`px-3 py-2 border font-mono text-[11px] uppercase tracking-[0.22em] ${publishStatus === "active" ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]" : "border-[#262626] text-[#a3a3a3]"}`}
                    data-testid="csv-publish-active">
                    Publish immediately
                  </button>
                </div>
                <div className="font-mono text-[10px] text-[#737373] mt-2">
                  Drafts let you review each listing before going live. You can bulk-publish later from the Listings tab.
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                  Preview · {preview.preview_rows.length} of {preview.total_parsed}
                </div>
                <div className="border border-[#262626] max-h-72 overflow-y-auto" data-testid="csv-preview-list">
                  {preview.preview_rows.map((r, i) => (
                    <div key={i} className="border-b border-[#1f1f1f] px-3 py-2.5 grid grid-cols-[1fr_auto] gap-3 items-center">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-[#e5e5e5] truncate">{r.title}</div>
                        <div className="font-mono text-[10px] text-[#737373] mt-0.5">
                          stock: {r.stock} · {r.tags.length} tags · {r.image_urls.length} images
                        </div>
                      </div>
                      <div className="font-display text-base text-[#ff4500] shrink-0">${r.price.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => { setStage("pick"); setPreview(null); }}
                  className="btn-industrial flex-1" data-testid="csv-back-btn">
                  ← Different file
                </button>
                <button onClick={commit}
                  className="btn-industrial btn-primary flex-1 inline-flex items-center justify-center gap-2"
                  data-testid="csv-commit-btn">
                  <CheckCircle2 size={14} /> Commit {Math.min(50, preview.total_parsed)} listings
                </button>
              </div>
              {err && <p className="font-mono text-xs text-red-400 flex items-center gap-2"><AlertCircle size={12} /> {err}</p>}
            </div>
          )}

          {stage === "committing" && (
            <div className="text-center py-12" data-testid="csv-stage-committing">
              <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
                ◆ Importing…
              </div>
            </div>
          )}

          {stage === "done" && (
            <div className="text-center py-12" data-testid="csv-stage-done">
              <CheckCircle2 size={36} className="text-emerald-400 mx-auto mb-3" />
              <h3 className="font-display text-2xl uppercase mb-2">Imported.</h3>
              <p className="font-mono text-xs text-[#a3a3a3]">
                Refreshing your listings…
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
