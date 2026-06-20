import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { http } from "../../lib/api";

// iter413be — Nurture Queue (drafts only).
//
// Lists outreach drafts auto-generated for lead-magnet subscribers who
// crossed the 7-day staleness threshold without submitting a maker
// application. Per the ops doc:
//   • No auto-send.
//   • No sequences.
//   • Manual approval ONLY.
//   • Cap 2 drafts per lead, lifetime.
//   • Application submitted → drafts auto-stop.
//
// "Approve" marks a draft ready for the operator to copy-paste into
// their email client. "Dismiss" drops the draft. There is no send
// button — that's intentional until we have nurture-result data.

const TYPE_LABEL = {
  nudge:      "Still thinking?",
  spotlight:  "Maker spotlight",
  invitation: "Founder invitation",
};

const TYPE_COLOR = {
  nudge:      "#8B6F47",
  spotlight:  "#5B7C8B",
  invitation: "#8B5B5B",
};

export default function NurtureQueueTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [view, setView] = useState("pending"); // pending | recent | uncovered

  const load = async () => {
    setBusy(true); setErr("");
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      const r = await http.get("/admin/nurture-queue", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Load failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      const r = await http.post("/admin/nurture-queue/generate", null, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      toast.success(
        r.data.generated === 0
          ? `Checked ${r.data.leads_checked} lead(s) — none needed new drafts.`
          : `Generated ${r.data.generated} draft(s) for ${r.data.leads_checked} lead(s).`,
      );
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Generate failed");
    } finally {
      setGenerating(false);
    }
  };

  const decide = async (draft, decision) => {
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      await http.post(`/admin/nurture-queue/${draft.id}/decision`,
        { decision }, { headers: { Authorization: `Bearer ${tok}` } });
      toast.success(decision === "approve"
        ? `Approved — copy the body below and send manually.`
        : `Dismissed.`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || `${decision} failed`);
    }
  };

  const copyBody = async (draft) => {
    try {
      await navigator.clipboard.writeText(
        `Subject: ${draft.title}\n\n${draft.body_md}`,
      );
      toast.success("Subject + body copied to clipboard.");
    } catch {
      toast.error("Couldn't copy — select + copy from the preview manually.");
    }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    if (view === "pending")   return data.pending || [];
    if (view === "recent")    return data.recent  || [];
    if (view === "uncovered") return data.uncovered_leads || [];
    return [];
  }, [data, view]);

  return (
    <div className="space-y-5" data-testid="nurture-queue-tab">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Lead → Apply · Drafts only</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Nurture Queue</h2>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl">
            Auto-generated draft outreach for leads aged <b className="text-ink">7+ days</b> with no application.
            <b className="text-ink"> Manual approval only.</b> No auto-send. Cap{" "}
            <b className="text-ink">2 drafts</b> per lead. Drafts auto-stop on application submission.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generate}
            disabled={generating || busy}
            data-testid="nurture-generate"
            className="px-3 py-2 border border-brand text-brand hover:bg-brand/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            {generating ? "Generating…" : "+ Generate drafts"}
          </button>
          <button
            onClick={load}
            disabled={busy}
            data-testid="nurture-reload"
            className="px-3 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            {busy ? "Loading…" : "↻"}
          </button>
        </div>
      </div>

      {err && <div className="font-mono text-xs text-red-400 py-4">{err}</div>}

      {data && (
        <>
          <div className="flex flex-wrap gap-2" data-testid="nurture-summary">
            <button
              onClick={() => setView("pending")}
              data-testid="nurture-view-pending"
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                view === "pending" ? "border-brand text-brand bg-brand/5" : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              Pending <b className="ml-1">{data.counts.pending}</b>
            </button>
            <button
              onClick={() => setView("recent")}
              data-testid="nurture-view-recent"
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                view === "recent" ? "border-brand text-brand bg-brand/5" : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              Recent decisions <b className="ml-1">{data.counts.approved + data.counts.dismissed + data.counts.stopped}</b>
            </button>
            <button
              onClick={() => setView("uncovered")}
              data-testid="nurture-view-uncovered"
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                view === "uncovered" ? "border-brand text-brand bg-brand/5" : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              Uncovered leads <b className="ml-1">{data.counts.uncovered_leads}</b>
            </button>
            <span className="px-3 py-1.5 border border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              approved <b className="text-ink ml-1">{data.counts.approved}</b>
            </span>
            <span className="px-3 py-1.5 border border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              auto-stopped <b className="text-ink ml-1">{data.counts.stopped}</b>
            </span>
          </div>

          {/* Empty states */}
          {view === "uncovered" && rows.length === 0 && (
            <div className="font-mono text-xs text-emerald-700 py-6">
              ✓ No uncovered leads — every aged-7d lead has its 2 drafts.
            </div>
          )}
          {view === "pending" && rows.length === 0 && (
            <div className="font-mono text-xs text-ink-muted py-6">
              No pending drafts. Click <b>+ Generate drafts</b> to scan eligible leads.
            </div>
          )}
          {view === "recent" && rows.length === 0 && (
            <div className="font-mono text-xs text-ink-muted py-6">
              No decisions yet.
            </div>
          )}

          {/* Uncovered leads list */}
          {view === "uncovered" && rows.length > 0 && (
            <ul className="space-y-1 font-mono text-xs" data-testid="nurture-uncovered-list">
              {rows.map((lead, i) => (
                <li key={`${lead.email}-${i}`} className="flex items-center justify-between border-l-2 border-line pl-3 py-2">
                  <div>
                    <span className="text-ink">{lead.email}</span>
                    <span className="text-ink-muted ml-2">· first seen {lead.first_seen_at?.slice(0, 10) || "—"}</span>
                    {lead.source && <span className="text-ink-muted ml-2">· {lead.source}/{lead.campaign || "—"}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Pending + recent draft cards */}
          {(view === "pending" || view === "recent") && rows.length > 0 && (
            <ul className="space-y-3" data-testid="nurture-drafts-list">
              {rows.map((d) => {
                const isOpen = expandedId === d.id;
                const tcolor = TYPE_COLOR[d.draft_type] || "#888";
                return (
                  <li
                    key={d.id}
                    className="border border-line p-3 md:p-4 bg-paper"
                    data-testid={`nurture-draft-${d.id}`}
                  >
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-0.5 border"
                            style={{ borderColor: tcolor, color: tcolor }}
                          >
                            {TYPE_LABEL[d.draft_type] || d.draft_type}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                            {d.status}
                          </span>
                          {d.status === "stopped" && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700">
                              ✓ lead applied
                            </span>
                          )}
                        </div>
                        <div className="font-display text-lg text-ink mt-1">{d.title}</div>
                        <div className="font-mono text-[11px] text-ink-muted mt-1">
                          to <b className="text-ink">{d.lead_email}</b>
                          {d.lead_first_seen_at && (
                            <> · lead since {d.lead_first_seen_at.slice(0, 10)}</>
                          )}
                          {d.recommended_send_at && (
                            <> · recommended send {d.recommended_send_at.slice(0, 10)}</>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-ink-muted mt-2 italic">
                          {d.reason}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 self-start">
                        {d.status === "pending" && (
                          <>
                            <button
                              onClick={() => decide(d, "approve")}
                              data-testid={`nurture-approve-${d.id}`}
                              className="px-2 py-1 border border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => decide(d, "dismiss")}
                              data-testid={`nurture-dismiss-${d.id}`}
                              className="px-2 py-1 border border-line text-ink-muted hover:border-ink-muted hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] transition"
                            >
                              Dismiss
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setExpandedId(isOpen ? "" : d.id)}
                          data-testid={`nurture-toggle-${d.id}`}
                          className="px-2 py-1 border border-line text-ink-muted hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
                        >
                          {isOpen ? "Hide" : "Preview"}
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="mt-3 pt-3 border-t border-line space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                            ◆ Draft body (markdown)
                          </div>
                          <button
                            onClick={() => copyBody(d)}
                            data-testid={`nurture-copy-${d.id}`}
                            className="px-2 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
                          >
                            Copy subject + body
                          </button>
                        </div>
                        <pre className="font-mono text-[11px] text-ink whitespace-pre-wrap leading-relaxed bg-surface p-3 border border-line">
{d.body_md}
                        </pre>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
