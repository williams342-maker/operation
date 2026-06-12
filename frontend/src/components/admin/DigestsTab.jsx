import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminRunPlusRoiDigest } from "../../lib/api";
import { Stat } from "./_shared";
import useModalA11y from "../../hooks/useModalA11y";
import PricingDigestHealthCard from "./PricingDigestHealthCard";

export default function DigestsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const dialogRef = useModalA11y(() => setConfirmSend(false));

  const dryRun = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await adminRunPlusRoiDigest(false);
      setData(res);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Failed to compute digest preview.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setSending(true);
    setErr("");
    setConfirmSend(false);
    try {
      const res = await adminRunPlusRoiDigest(true);
      setData(res);
      toast.success(`Digest sent to ${res.sent} maker${res.sent === 1 ? "" : "s"}.`);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Failed to send digests.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { dryRun(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div data-testid="digests-tab" className="space-y-6">
      {/* iter334h — AI pricing digest health card. Sits at the top of
          the Digests tab because it's the higher-frequency cron
          (weekly vs the Plus ROI cron's monthly cadence). */}
      <PricingDigestHealthCard />

      <div className="border border-line p-5 md:p-6 space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
          ◆ Crafters Plus ROI Digest
        </div>
        <h3 className="font-display text-2xl uppercase">Monthly upsell email</h3>
        <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
          Finds free-tier makers grossing more than the threshold over the last 30 days,
          calculates how much Crafters Plus would have saved them in commission, and emails
          a personalised upgrade pitch via MailerSend. Cooldown prevents re-sending within
          the configured window. The cron runs automatically on the 1st of each month — use
          this panel to preview or trigger a send manually.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={dryRun}
            disabled={loading || sending}
            className="px-4 py-2 border border-line hover:border-brand font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="digest-preview-btn"
          >
            {loading ? "Computing…" : "Refresh Preview"}
          </button>
          <button
            onClick={() => setConfirmSend(true)}
            disabled={!data || !data.candidate_count || sending || loading}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-[#0a0a0a] border border-brand font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid="digest-send-btn"
          >
            {sending ? "Sending…" : `Send digest${data?.candidate_count ? ` (${data.candidate_count})` : ""}`}
          </button>
        </div>
      </div>

      {err && (
        <p className="font-mono text-xs text-red-400" data-testid="digests-error">{err}</p>
      )}

      {data && (
        <div className="space-y-4" data-testid="digest-result">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label={data.mode === "applied" ? "Sent" : "Candidates"}
              value={data.mode === "applied" ? data.sent : data.candidate_count}
              testId="digest-stat-primary"
            />
            <Stat label="Skipped (cooldown)" value={data.skipped || 0} testId="digest-stat-skipped" />
            <Stat
              label="Threshold"
              value={`$${data.threshold_usd}`}
              testId="digest-stat-threshold"
            />
            <Stat
              label="Cooldown"
              value={`${data.cooldown_days}d`}
              testId="digest-stat-cooldown"
            />
          </div>

          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-muted">
            ◆ {data.mode === "applied" ? "Just-sent recipients" : "Preview · who would receive this digest"}
          </div>
          {!data.candidates?.length ? (
            <p className="font-mono text-sm text-ink-muted" data-testid="digest-empty">
              No free-tier makers crossed the ${data.threshold_usd}/30d threshold this run.
            </p>
          ) : (
            <div className="border border-line" data-testid="digest-candidate-list">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted bg-paper">
                <div className="col-span-4">Maker</div>
                <div className="col-span-3 text-right">30d gross</div>
                <div className="col-span-2 text-right">Saved</div>
                <div className="col-span-3 text-right">Net w/ Plus</div>
              </div>
              {data.candidates.map((c) => (
                <div
                  key={c.slug}
                  className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-line last:border-b-0 font-mono text-xs hover:bg-paper"
                  data-testid={`digest-candidate-${c.slug}`}
                >
                  <div className="col-span-4 min-w-0">
                    <div className="text-ink truncate">{c.name}</div>
                    <div className="text-ink-muted text-[10px] truncate">{c.email}</div>
                  </div>
                  <div className="col-span-3 text-right text-ink">${c.gross_30d.toFixed(2)}</div>
                  <div className="col-span-2 text-right text-emerald-700">+${c.commission_savings.toFixed(2)}</div>
                  <div className={`col-span-3 text-right ${c.net_benefit > 0 ? "text-emerald-700" : "text-brand"}`}>
                    {c.net_benefit > 0 ? "+" : ""}${c.net_benefit.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmSend && (
        <div
          className="fixed inset-0 z-50 bg-paper/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmSend(false)}
          data-testid="digest-confirm-modal"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            className="bg-paper border border-line max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
              ◆ Send digest
            </div>
            <h3 className="font-display text-2xl uppercase">Send to {data?.candidate_count} maker{data?.candidate_count === 1 ? "" : "s"}?</h3>
            <p className="font-mono text-xs text-ink-muted leading-relaxed">
              This will fire {data?.candidate_count} real MailerSend emails and stamp each recipient
              so they aren't re-emailed for {data?.cooldown_days} days. Cannot be undone.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setConfirmSend(false)}
                className="px-4 py-2 border border-line hover:border-brand font-mono text-[11px] uppercase tracking-[0.22em]"
                data-testid="digest-confirm-cancel"
              >
                Cancel
              </button>
              <button
                onClick={apply}
                className="px-4 py-2 bg-brand hover:bg-brand-hover text-[#0a0a0a] border border-brand font-mono text-[11px] uppercase tracking-[0.22em]"
                data-testid="digest-confirm-send"
              >
                Confirm send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
