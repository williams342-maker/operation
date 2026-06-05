import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { startBatchPriceCompare, fetchBatchPriceCompareJob } from "../../lib/api";

/**
 * iter334j — Batch AI Price Check companion button.
 *
 * Sits in the Listings header next to "+ New Listing". On click,
 * starts a backend background job that runs an AI Price Check on each
 * of the maker's published listings (cache-aware, max 10 per batch),
 * then polls every 4 seconds until done. Refreshes the verdict badges
 * via the `onCompleted` callback.
 *
 * UX shape:
 *   - Idle:     "◆ AI Price Check · all"
 *   - Running:  "Checking 3/10…"  (spinner)
 *   - Done:     toast "Refreshed 8 of 10 listings (2 cached)"
 */
export default function BatchPriceCheckButton({ onCompleted }) {
  const [job, setJob] = useState(null);          // { job_id, status, total, completed }
  const [busy, setBusy] = useState(false);
  const completionFired = useRef(false);

  // Poll loop — runs only while a job is in-flight. Polling is gated
  // by `setInterval` (not a setTimeout chain) so it's easy to clean
  // up on unmount.
  useEffect(() => {
    if (!job?.job_id || job.status === "done") return undefined;
    const tick = async () => {
      try {
        const j = await fetchBatchPriceCompareJob(job.job_id);
        setJob(j);
        if (j.status === "done" && !completionFired.current) {
          completionFired.current = true;
          const total = j.total || 0;
          const cached = (j.results || []).filter((r) => r.status === "cached").length;
          const generated = (j.results || []).filter((r) => r.status === "generated").length;
          toast.success(
            `Price Check complete · ${generated} refreshed · ${cached} cached`,
            { description: total > generated + cached ? `${total - generated - cached} skipped (rate limit / error)` : undefined },
          );
          setBusy(false);
          if (typeof onCompleted === "function") onCompleted();
        }
      } catch {
        // Transient errors → keep polling. The job state is server-authoritative.
      }
    };
    const id = setInterval(tick, 4000);
    // Run once immediately so the UI updates fast after start.
    tick();
    return () => clearInterval(id);
  }, [job?.job_id, job?.status, onCompleted]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    completionFired.current = false;
    try {
      const j = await startBatchPriceCompare();
      setJob(j);
      if (j.status === "already_running") {
        toast.info("A batch is already running — picking up progress…");
      } else if (j.status === "queued") {
        toast.success("Batch started — we'll refresh badges as we go.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't start batch — try again in a moment.");
      setBusy(false);
    }
  };

  const isRunning = busy && job?.status !== "done";
  const label = isRunning
    ? (job?.total ? `Checking ${job.completed}/${job.total}…` : "Starting…")
    : "AI Price Check · all";

  return (
    <button
      type="button"
      onClick={start}
      disabled={isRunning}
      className="inline-flex items-center gap-1.5 px-3 py-2 border border-cyan-400/40 hover:border-cyan-300 hover:bg-cyan-400/5 disabled:opacity-60 disabled:cursor-wait font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300 transition"
      title="Run an AI Price Check on every published listing. Cache-aware — listings checked within the last 24h are returned instantly."
      data-testid="products-batch-price-check"
    >
      {isRunning ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <Sparkles size={11} />
      )}
      {label}
    </button>
  );
}
