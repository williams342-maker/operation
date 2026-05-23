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
import { Upload, FileText, Trash2, EyeOff, Eye, RefreshCw, AlertCircle, ExternalLink, LifeBuoy } from "lucide-react";
import {
  importMakerReviewsCsv,
  listMakerReviewImports,
  patchMakerReviewImport,
  deleteMakerReviewImport,
  sendReviewCsvToSupport,
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
          {/* Walkthrough — tabbed Etsy/Shopify exports */}
          <ExportWalkthrough />

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

          {/* Support fallback — last resort when the auto-import won't budge */}
          <SupportFallback />
        </div>
      )}
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// ExportWalkthrough — interactive, tabbed step-by-step instructions for
// exporting reviews from Etsy or Shopify. Replaces the previous one-line
// hint block. Each step has a number, a clear instruction, optional "pro
// tip" note, and the platform tab links to the official help-doc article
// (open in new tab so the maker doesn't lose their import-in-progress).
// ─────────────────────────────────────────────────────────────────────────────

const WALKTHROUGHS = {
  etsy: {
    label: "Etsy",
    docLink: "https://help.etsy.com/hc/en-us/articles/360000343068",
    docLabel: "Etsy Help · Reviewing your shop stats",
    estimateMin: 2,
    steps: [
      {
        title: "Open Shop Manager → Stats",
        body: "From your Etsy dashboard, click your shop avatar (top-right) → Shop Manager. In the left navigation, click Stats.",
      },
      {
        title: "Click \"Reviews\" in the side panel",
        body: "Inside Stats, the left sidebar has a Reviews link. Click it to see the full list of reviews across all your listings.",
      },
      {
        title: "Pick the date range",
        body: "Top-right of the Reviews page, click the date selector → choose \"All time\" so you get every review since shop launch.",
        tip: "If you've been on Etsy for years, also export year-by-year in case the full export times out.",
      },
      {
        title: "Click \"Download CSV\"",
        body: "Top-right corner has a Download CSV button. Save the file to your computer — it's typically named \"reviews-<shop-name>.csv\".",
      },
      {
        title: "Upload it below",
        body: "Drag the .csv file into the dropzone on this page, leave the source set to Etsy, and click Import. Done.",
      },
    ],
  },
  shopify: {
    label: "Shopify",
    docLink: "https://judge.me/help/articles/import-export-reviews",
    docLabel: "Judge.me Help · Import/Export reviews",
    estimateMin: 3,
    steps: [
      {
        title: "Open your reviews app",
        body: "From Shopify admin → Apps. Click whichever reviews app you use: Judge.me, Yotpo, Stamped.io, Loox, Reviews.io, or Shopify's native Product Reviews.",
      },
      {
        title: "Navigate to Settings → Manage Reviews",
        body: "Most reviews apps put export under Settings → Reviews (or General → Import/Export). The exact path varies by app — search for \"export\" if you can't find it.",
        tip: "Judge.me: Settings → General → Export reviews. Yotpo: Moderate → Manage Reviews → Export.",
      },
      {
        title: "Choose CSV format",
        body: "When asked for a format, pick CSV (not XML, JSON, or PDF). Some apps default to their own format — make sure CSV is selected.",
      },
      {
        title: "Download the file",
        body: "Click Export → the file either downloads instantly or arrives by email in 5-10 minutes (large stores get the email version).",
      },
      {
        title: "Upload it below",
        body: "Drag the .csv into the dropzone, select Shopify as the source, and click Import. Header columns are auto-mapped — no manual cleanup needed.",
      },
    ],
  },
};


function ExportWalkthrough() {
  const [platform, setPlatform] = useState("etsy");
  const wt = WALKTHROUGHS[platform];

  return (
    <div
      className="border border-[#262626] bg-[#0a0a0a]"
      data-testid="export-walkthrough"
    >
      {/* Header + tabs */}
      <div className="px-4 md:px-5 pt-4 pb-3 border-b border-[#262626]">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Walkthrough · How to export reviews
          </div>
          <span className="font-mono text-[10px] text-[#525252]">
            ~{wt.estimateMin} min
          </span>
        </div>
        <div className="flex gap-2" role="tablist">
          {Object.entries(WALKTHROUGHS).map(([key, w]) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={platform === key}
              onClick={() => setPlatform(key)}
              className={`px-3 py-2 border font-mono text-xs uppercase tracking-[0.18em] transition ${
                platform === key
                  ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/5"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
              }`}
              data-testid={`walkthrough-tab-${key}`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Numbered steps */}
      <ol
        className="px-4 md:px-5 py-4 space-y-4"
        data-testid={`walkthrough-steps-${platform}`}
      >
        {wt.steps.map((step, i) => (
          <li
            key={i}
            className="flex gap-3 md:gap-4"
            data-testid={`walkthrough-step-${platform}-${i + 1}`}
          >
            <span
              className="shrink-0 w-7 h-7 border border-[#ff4500] text-[#ff4500] flex items-center justify-center font-mono text-sm font-bold"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-mono text-sm text-[#e5e5e5] leading-relaxed">
                {step.title}
              </p>
              <p className="font-mono text-xs text-[#a3a3a3] mt-1 leading-relaxed">
                {step.body}
              </p>
              {step.tip && (
                <p className="font-mono text-[11px] text-[#737373] mt-1.5 italic leading-relaxed">
                  Pro tip · {step.tip}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* Help-doc deep link */}
      <div className="px-4 md:px-5 pb-4 pt-1">
        <a
          href={wt.docLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#a3a3a3] hover:text-[#ff4500] transition"
          data-testid={`walkthrough-doclink-${platform}`}
        >
          <ExternalLink size={11} />
          <span className="underline-offset-2 hover:underline">{wt.docLabel}</span>
        </a>
      </div>

      {/* CSV format reminder — universal across both tabs */}
      <div className="px-4 md:px-5 py-3 border-t border-[#262626] bg-[#080808]">
        <p className="font-mono text-[10px] text-[#525252] leading-relaxed">
          <span className="text-[#737373] uppercase tracking-[0.22em]">Required columns</span>
          {" "}<code className="text-[#a3a3a3]">date</code>{", "}
          <code className="text-[#a3a3a3]">name</code>{", "}
          <code className="text-[#a3a3a3]">rating</code>{", "}
          <code className="text-[#a3a3a3]">text</code>
          {". Optional: "}<code className="text-[#a3a3a3]">product</code>
          {". Synonyms like "}<code className="text-[#a3a3a3]">buyer_username</code>{", "}
          <code className="text-[#a3a3a3]">review_body</code>{", "}
          <code className="text-[#a3a3a3]">stars</code>{" "}are auto-mapped.
        </p>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// SupportFallback — collapsible "Send my CSV to support" panel. Last
// resort for makers whose CSV won't parse (broken Etsy export, weird
// column layout, fragmented files, etc.). Uploads the raw file to the
// support inbox along with a freeform note; support handles the import
// manually. Turns "I give up" moments into a 5-min human touch.
// ─────────────────────────────────────────────────────────────────────────────
function SupportFallback() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setErr("");
    setSent(false);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!file) {
      setErr("Attach the CSV you've been trying to import.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await sendReviewCsvToSupport(file, note);
      setSent(true);
      setFile(null);
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Sent to support — we'll reply within one business day.");
    } catch (ex) {
      setErr(ex?.response?.data?.detail || "Couldn't reach support. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="border border-[#262626] bg-[#0a0a0a]"
      data-testid="review-import-support-fallback"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-[#0d0d0d] transition"
        data-testid="support-fallback-toggle"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <LifeBuoy size={14} className="text-[#a3a3a3] shrink-0" />
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#e5e5e5]">
              Stuck? Send your CSV to support
            </div>
            <p className="font-mono text-[10px] text-[#737373] mt-0.5 truncate">
              We'll import it manually and reply within one business day.
            </p>
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373] shrink-0">
          {open ? "Close ▴" : "Open ▾"}
        </span>
      </button>

      {open && (
        <form
          onSubmit={submit}
          className="border-t border-[#262626] p-4 space-y-4"
          data-testid="support-fallback-body"
        >
          {sent ? (
            <div
              className="border border-emerald-500/40 bg-emerald-500/5 p-4 font-mono text-xs"
              data-testid="support-fallback-sent"
            >
              <p className="text-emerald-400 uppercase tracking-[0.22em] text-[10px] mb-2">
                ◆ Sent to support
              </p>
              <p className="text-[#e5e5e5] leading-relaxed">
                Our team has your file. We'll reply to you by email within one
                business day with either your imported reviews or a request for
                more info. Thanks for the patience.
              </p>
              <button
                type="button"
                onClick={() => setSent(false)}
                className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
              >
                ← Send another file
              </button>
            </div>
          ) : (
            <>
              <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
                Attach the CSV (or anything close — XLS, partial export, even
                a screenshot) and write a quick note about what's going wrong.
                We'll do the conversion + import on our side.
              </p>

              {/* File picker */}
              <div className="border border-dashed border-[#262626] hover:border-[#a3a3a3]/50 p-4 transition">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xls,.xlsx,.txt,.tsv,text/csv,image/*"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                  className="hidden"
                  data-testid="support-fallback-file-input"
                />
                {file ? (
                  <div className="flex items-center gap-3">
                    <FileText size={18} className="text-[#a3a3a3] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs text-[#e5e5e5] truncate">{file.name}</p>
                      <p className="font-mono text-[10px] text-[#525252]">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                      className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
                    >
                      × Remove
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="font-mono text-xs uppercase tracking-[0.18em] text-[#a3a3a3] hover:text-[#ff4500] transition"
                    data-testid="support-fallback-browse-btn"
                  >
                    + Attach file
                  </button>
                )}
              </div>

              {/* Note */}
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-2">
                  What's not working? (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 2000))}
                  rows={3}
                  placeholder="e.g. Etsy gave me a weird format with merged columns, or Judge.me's export is missing dates…"
                  className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5] resize-y"
                  data-testid="support-fallback-note"
                />
                <p className="font-mono text-[10px] text-[#525252] mt-1 text-right">
                  {note.length} / 2000
                </p>
              </div>

              {err && (
                <div
                  className="flex items-start gap-2 p-3 border border-red-500/40 bg-red-500/5 text-red-400 font-mono text-xs"
                  data-testid="support-fallback-error"
                >
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{err}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!file || busy}
                className="btn-industrial inline-flex items-center gap-2 disabled:opacity-50"
                data-testid="support-fallback-submit"
              >
                <LifeBuoy size={13} />
                {busy ? "Sending…" : "Send to support →"}
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
