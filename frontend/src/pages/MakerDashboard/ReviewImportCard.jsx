/**
 * Maker → Import reviews from Etsy / Shopify CSV (iter183).
 *
 * Renders inside ReviewsTab as a collapsible card at the top. Lets the
 * maker upload a CSV they exported from Etsy (Shop Manager → Stats →
 * Reviews → Download) or Shopify (Judge.me / Yotpo / Stamped export),
 * pick the source platform, and choose whether the imported reviews
 * should appear publicly (default ON, with an "Imported from Etsy" badge).
 *
 * Past imports are listed below the uploader with toggle + undo buttons,
 * so the maker can revert a bad upload without contacting support.
 */
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, FileText, Trash2, EyeOff, Eye, RefreshCw, AlertCircle } from "lucide-react";
import {
  importMakerReviewsCsv,
  listMakerReviewImports,
  patchMakerReviewImport,
  deleteMakerReviewImport,
} from "../../lib/api";

const SOURCE_LABELS = { etsy: "Etsy", shopify: "Shopify", csv: "Other / CSV" };

export default function ReviewImportCard({ onImported }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("etsy");
  const [publishedPublicly, setPublishedPublicly] = useState(true);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [imports, setImports] = useState([]);
  const [importsLoading, setImportsLoading] = useState(false);
  const fileRef = useRef(null);

  const refreshImports = async () => {
    setImportsLoading(true);
    try {
      const data = await listMakerReviewImports();
      setImports(data.items || []);
    } catch (e) {
      // Silent — the table just stays empty.
    } finally {
      setImportsLoading(false);
    }
  };

  useEffect(() => {
    if (open) refreshImports();
  }, [open]);

  const handleFile = (f) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      setErr("Please upload a .csv file.");
      return;
    }
    setFile(f);
    setErr("");
    setResult(null);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!file) {
      setErr("Choose a CSV file first.");
      return;
    }
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const r = await importMakerReviewsCsv(file, { source, publishedPublicly });
      setResult(r);
      toast.success(
        `Imported ${r.inserted} review${r.inserted === 1 ? "" : "s"}` +
        (r.skipped_duplicates ? ` · skipped ${r.skipped_duplicates} duplicate${r.skipped_duplicates === 1 ? "" : "s"}` : ""),
      );
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await refreshImports();
      if (onImported) onImported();
    } catch (ex) {
      const detail = ex?.response?.data?.detail || ex.message || "Import failed.";
      setErr(typeof detail === "string" ? detail : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const togglePublic = async (batchId, next) => {
    try {
      await patchMakerReviewImport(batchId, next);
      toast.success(next ? "Batch now public" : "Batch hidden from buyers");
      await refreshImports();
      if (onImported) onImported();
    } catch (ex) {
      toast.error(ex?.response?.data?.detail || "Couldn't update batch.");
    }
  };

  const undoBatch = async (batchId, count) => {
    if (!window.confirm(`Delete all ${count} reviews from this import? This can't be undone.`)) return;
    try {
      const r = await deleteMakerReviewImport(batchId);
      toast.success(`Removed ${r.deleted} review${r.deleted === 1 ? "" : "s"}`);
      await refreshImports();
      if (onImported) onImported();
    } catch (ex) {
      toast.error(ex?.response?.data?.detail || "Couldn't delete batch.");
    }
  };

  return (
    <section
      className="border border-[#262626] mb-6"
      data-testid="review-import-card"
    >
      {/* Header — always visible, click to expand */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 md:px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-[#0d0d0d] transition"
        data-testid="review-import-toggle"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Upload size={16} className="text-[#ff4500] shrink-0" />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
              ◆ Import reviews from another platform
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] mt-1 truncate">
              Bring over your Etsy or Shopify reviews so buyers see your full track record.
            </p>
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] shrink-0">
          {open ? "Close ▴" : "Open ▾"}
        </span>
      </button>

      {open && (
        <div className="border-t border-[#262626] p-4 md:p-5 space-y-6" data-testid="review-import-body">
          {/* Step-by-step help */}
          <div className="bg-[#0d0d0d] border border-[#1a1a1a] p-4 font-mono text-xs text-[#a3a3a3] space-y-2">
            <p className="text-[#e5e5e5] uppercase tracking-[0.22em] text-[10px] mb-1">How to export</p>
            <p>
              <b className="text-[#e5e5e5]">Etsy</b> — Shop Manager → Stats → Reviews →
              <i> Download CSV</i> (top-right).
            </p>
            <p>
              <b className="text-[#e5e5e5]">Shopify</b> — open your reviews app (Judge.me, Yotpo, Stamped, Loox…) → Settings → Export → CSV.
            </p>
            <p className="text-[#525252]">
              Required columns: <code>date</code>, <code>name</code>, <code>rating</code>, <code>text</code>. Optional: <code>product</code>. Header names are case-insensitive — synonyms like <code>buyer_username</code>, <code>review_body</code>, <code>stars</code> are auto-mapped.
            </p>
          </div>

          {/* Upload form */}
          <form onSubmit={submit} className="space-y-4" data-testid="review-import-form">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-2">
                  Source platform
                </label>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSource(key)}
                      className={`px-3 py-2 border font-mono text-xs uppercase tracking-[0.18em] transition ${
                        source === key
                          ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/5"
                          : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
                      }`}
                      data-testid={`review-import-source-${key}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-2">
                  Visibility
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishedPublicly}
                    onChange={(e) => setPublishedPublicly(e.target.checked)}
                    className="accent-[#ff4500] w-4 h-4"
                    data-testid="review-import-public-toggle"
                  />
                  <span className="font-mono text-xs text-[#e5e5e5]">
                    Show imported reviews publicly with an "Imported from {SOURCE_LABELS[source]}" badge
                  </span>
                </label>
                <p className="font-mono text-[10px] text-[#525252] mt-2 leading-relaxed">
                  Off = only you see them in this dashboard. You can flip this later per batch.
                </p>
              </div>
            </div>

            {/* File picker */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFile(e.dataTransfer.files?.[0]);
              }}
              className="border-2 border-dashed border-[#262626] hover:border-[#ff4500]/50 p-6 text-center transition"
              data-testid="review-import-dropzone"
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleFile(e.target.files?.[0])}
                className="hidden"
                data-testid="review-import-file-input"
              />
              {file ? (
                <div className="space-y-2">
                  <FileText size={32} className="mx-auto text-[#ff4500]" />
                  <p className="font-mono text-sm text-[#e5e5e5]">{file.name}</p>
                  <p className="font-mono text-[10px] text-[#525252]">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
                  >
                    × Choose a different file
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={32} className="mx-auto text-[#525252] mb-2" />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="font-mono text-xs uppercase tracking-[0.18em] text-[#ff4500] hover:underline"
                    data-testid="review-import-browse-btn"
                  >
                    Browse for CSV
                  </button>
                  <p className="font-mono text-[10px] text-[#525252] mt-2">
                    or drop the file here · max 5 MB / 5000 rows
                  </p>
                </>
              )}
            </div>

            {err && (
              <div
                className="flex items-start gap-2 p-3 border border-red-500/40 bg-red-500/5 text-red-400 font-mono text-xs"
                data-testid="review-import-error"
              >
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">{err}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!file || busy}
              className="btn-industrial btn-primary disabled:opacity-50"
              data-testid="review-import-submit"
            >
              {busy ? "Importing…" : "Import reviews →"}
            </button>
          </form>

          {/* Result panel */}
          {result && (
            <div
              className="border border-emerald-500/40 bg-emerald-500/5 p-4 font-mono text-xs space-y-1"
              data-testid="review-import-result"
            >
              <p className="text-emerald-400 uppercase tracking-[0.22em] text-[10px]">
                ◆ Import complete
              </p>
              <p className="text-[#e5e5e5]">
                Imported <b>{result.inserted}</b> review{result.inserted === 1 ? "" : "s"}
                {result.skipped_duplicates > 0 && (
                  <> · skipped <b>{result.skipped_duplicates}</b> duplicate{result.skipped_duplicates === 1 ? "" : "s"}</>
                )}
                {result.error_count > 0 && (
                  <> · <span className="text-amber-400">{result.error_count} row{result.error_count === 1 ? "" : "s"} couldn't be parsed</span></>
                )}
              </p>
              {result.errors && result.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[#a3a3a3] hover:text-[#ff4500]">
                    ↓ Show row errors ({result.errors.length})
                  </summary>
                  <ul className="mt-2 space-y-1 text-[10px] text-[#a3a3a3]">
                    {result.errors.map((e, i) => (
                      <li key={i}>
                        Line {e.line}: {e.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Past imports */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Past imports
              </p>
              <button
                type="button"
                onClick={refreshImports}
                disabled={importsLoading}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-[#ff4500] disabled:opacity-50"
                data-testid="review-import-refresh"
              >
                <RefreshCw size={10} className="inline mr-1" /> Refresh
              </button>
            </div>
            {imports.length === 0 ? (
              <p
                className="font-mono text-xs text-[#525252] italic"
                data-testid="review-import-empty"
              >
                No imports yet. Upload your first CSV above.
              </p>
            ) : (
              <div className="border border-[#262626] divide-y divide-[#262626]" data-testid="review-import-history">
                {imports.map((b) => (
                  <div
                    key={b.batch_id}
                    className="p-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4"
                    data-testid={`review-import-batch-${b.batch_id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-[#e5e5e5] uppercase tracking-[0.04em]">
                          {SOURCE_LABELS[b.source] || b.source}
                        </span>
                        <span className="font-mono text-[10px] text-[#525252]">·</span>
                        <span className="font-mono text-[11px] text-[#a3a3a3] truncate">
                          {b.filename}
                        </span>
                        {b.published_publicly ? (
                          <span className="px-1.5 py-0.5 border border-emerald-500/40 text-emerald-400 bg-emerald-500/5 font-mono text-[9px] uppercase tracking-[0.22em]">
                            public
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 border border-[#262626] text-[#737373] font-mono text-[9px] uppercase tracking-[0.22em]">
                            hidden
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-[10px] text-[#525252] mt-1">
                        {b.inserted} imported
                        {b.skipped_duplicates > 0 && <> · {b.skipped_duplicates} skipped</>}
                        {b.error_count > 0 && <> · {b.error_count} errors</>}
                        {" · "}
                        {(b.imported_at || "").slice(0, 16).replace("T", " ")}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => togglePublic(b.batch_id, !b.published_publicly)}
                        className="px-2.5 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition flex items-center gap-1.5"
                        data-testid={`review-import-toggle-public-${b.batch_id}`}
                      >
                        {b.published_publicly ? <EyeOff size={11} /> : <Eye size={11} />}
                        {b.published_publicly ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        onClick={() => undoBatch(b.batch_id, b.inserted)}
                        className="px-2.5 py-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/5 font-mono text-[10px] uppercase tracking-[0.22em] transition flex items-center gap-1.5"
                        data-testid={`review-import-delete-${b.batch_id}`}
                      >
                        <Trash2 size={11} /> Undo
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
