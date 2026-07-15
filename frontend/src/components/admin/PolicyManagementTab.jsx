import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  archivePolicyVersion,
  cancelPolicySchedule,
  createPolicyDraft,
  fetchAdminPolicies,
  fetchAdminPolicyDetail,
  fetchPolicyAcknowledgementStats,
  fetchPolicyDiff,
  generatePolicyAiSummary,
  previewPolicyNotification,
  publishPolicyVersion,
  schedulePolicyVersion,
  updatePolicyVersion,
} from "../../lib/api";

function fmt(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").slice(0, 16);
}

function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function VersionPill({ v }) {
  if (!v) return <span className="text-ink-muted">-</span>;
  const cls = v.status === "published" ? "text-green-500 border-green-500/30" : v.status === "scheduled" ? "text-amber-400 border-amber-400/40" : "text-ink-muted border-line";
  return <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${cls}`}>v{v.version_number} {v.status}</span>;
}

export default function PolicyManagementTab() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [activeVersionId, setActiveVersionId] = useState("");
  const [draft, setDraft] = useState(null);
  const [diff, setDiff] = useState(null);
  const [preview, setPreview] = useState(null);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState({ enabled: false, reason: "" });

  const load = () => fetchAdminPolicies().then((r) => {
    setData(r);
    if (!selected && r.policies?.[0]) setSelected(r.policies[0].slug);
  }).catch(() => toast.error("Could not load policies."));

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!selected) return;
    fetchAdminPolicyDetail(selected).then((r) => {
      setDetail(r);
      const editable = r.versions.find((v) => ["draft", "scheduled"].includes(v.status)) || r.versions[0];
      setActiveVersionId(editable?.id || "");
      setDraft(editable ? { ...editable } : null);
      setDiff(null); setPreview(null); setStats(null);
    }).catch(() => toast.error("Could not load policy detail."));
  }, [selected]);

  const active = useMemo(() => detail?.versions?.find((v) => v.id === activeVersionId) || null, [detail, activeVersionId]);
  const row = useMemo(() => data?.policies?.find((p) => p.slug === selected), [data, selected]);
  const noticeWarn = row?.slug === "fee-pricing" && draft?.published_at && draft?.effective_at && ((new Date(draft.effective_at) - new Date(draft.published_at)) / 86400000 < 30);

  async function refreshDetail() {
    if (!selected) return;
    const r = await fetchAdminPolicyDetail(selected);
    setDetail(r);
    if (activeVersionId) setDraft({ ...(r.versions.find((v) => v.id === activeVersionId) || draft) });
    await load();
  }

  async function makeDraft() {
    setBusy(true);
    try {
      const r = await createPolicyDraft(selected, { change_reason: "Policy update" });
      setActiveVersionId(r.version.id); setDraft(r.version); await refreshDetail();
      toast.success("Draft created.");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not create draft."); }
    finally { setBusy(false); }
  }

  async function saveDraft() {
    setBusy(true);
    try {
      const r = await updatePolicyVersion(draft.id, {
        title: draft.title,
        content: draft.content,
        approved_summary: draft.approved_summary,
        change_reason: draft.change_reason,
        publication_at: draft.published_at,
        effective_at: draft.effective_at,
        acknowledgement_required: !!draft.acknowledgement_required,
        acknowledgement_deadline: draft.acknowledgement_deadline,
        email_enabled: draft.email_enabled !== false,
      });
      setDraft(r.version); await refreshDetail(); toast.success("Draft saved.");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save draft."); }
    finally { setBusy(false); }
  }

  async function runDiff() {
    const r = await fetchPolicyDiff(activeVersionId); setDiff(r.diff);
  }
  async function runAi() {
    setBusy(true);
    try {
      const r = await generatePolicyAiSummary(activeVersionId);
      if (!r.ok) toast.error(r.error || "AI summary failed. Enter a manual summary.");
      else { setDraft((d) => ({ ...d, ai_summary: r.ai_summary, approved_summary: d.approved_summary || r.ai_summary })); toast.success("AI summary generated."); }
    } finally { setBusy(false); }
  }
  async function runPreview() { setPreview((await previewPolicyNotification(activeVersionId)).notification); }
  async function loadStats() { setStats(await fetchPolicyAcknowledgementStats(activeVersionId)); }

  async function schedule() {
    setBusy(true);
    try {
      await schedulePolicyVersion(activeVersionId, {
        publication_at: toIso(draft.published_at),
        effective_at: toIso(draft.effective_at),
        acknowledgement_required: !!draft.acknowledgement_required,
        acknowledgement_deadline: draft.acknowledgement_deadline ? toIso(draft.acknowledgement_deadline) : null,
        email_enabled: draft.email_enabled !== false,
        override_insufficient_notice: override.enabled,
        override_reason: override.reason,
      });
      await refreshDetail(); toast.success("Version scheduled and notices queued.");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not schedule version."); }
    finally { setBusy(false); }
  }

  async function publish() {
    setBusy(true);
    try {
      await publishPolicyVersion(activeVersionId, {
        effective_at: draft.effective_at ? toIso(draft.effective_at) : null,
        acknowledgement_required: !!draft.acknowledgement_required,
        acknowledgement_deadline: draft.acknowledgement_deadline ? toIso(draft.acknowledgement_deadline) : null,
        email_enabled: draft.email_enabled !== false,
        override_insufficient_notice: override.enabled,
        override_reason: override.reason,
      });
      await refreshDetail(); toast.success("Version published.");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not publish version."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5" data-testid="admin-policy-management">
      <div>
        <h2 className="font-display text-2xl text-ink">Policy Management</h2>
        <p className="font-mono text-[11px] text-ink-muted mt-1">Draft, compare, schedule, publish, notify, and track policy acknowledgements.</p>
      </div>
      {!data && <p className="font-mono text-xs text-ink-muted">Loading...</p>}
      {data && <div className="grid lg:grid-cols-[420px_1fr] gap-5">
        <div className="border border-line overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-line">{["Policy", "Current", "Scheduled", "Ack", "Notice"].map((h) => <th key={h} className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line/60">
              {data.policies.map((p) => <tr key={p.slug} onClick={() => setSelected(p.slug)} className={`cursor-pointer ${selected === p.slug ? "bg-brand/5" : ""}`} data-testid={`policy-row-${p.slug}`}>
                <td className="px-3 py-2 font-mono text-xs text-ink">{p.title}<div className="text-[10px] text-ink-muted">{fmt(p.last_updated)}</div></td>
                <td className="px-3 py-2"><VersionPill v={p.current_version} /></td>
                <td className="px-3 py-2"><VersionPill v={p.scheduled_version} /></td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">{p.acknowledgement?.required ? `${p.acknowledgement.acknowledged}/${p.acknowledgement.total}` : "No"}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">{p.notice?.required_days ? `${p.notice.days_remaining}d left` : "-"}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="space-y-4">
          {detail && <>
            <div className="border border-line p-4 flex flex-wrap gap-3 items-center justify-between">
              <div>
                <div className="font-display text-xl text-ink">{detail.policy.title}</div>
                <div className="font-mono text-[10px] text-ink-muted">{detail.versions.length} versions � {detail.policy.applies_to}</div>
              </div>
              <button onClick={makeDraft} disabled={busy} className="btn-industrial btn-primary" data-testid="create-policy-draft">Create Draft</button>
            </div>
            <div className="border border-line p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand mb-2">Version History</div>
              <div className="flex flex-wrap gap-2">{detail.versions.map((v) => <button key={v.id} onClick={() => { setActiveVersionId(v.id); setDraft({ ...v, published_at: toLocalInput(v.published_at), effective_at: toLocalInput(v.effective_at), acknowledgement_deadline: toLocalInput(v.acknowledgement_deadline) }); }} className={`border px-3 py-1 font-mono text-[11px] ${activeVersionId === v.id ? "border-brand text-brand" : "border-line text-ink-muted"}`}>v{v.version_number} {v.status}</button>)}</div>
            </div>
            {draft && <div className="border border-line p-4 space-y-3" data-testid="policy-draft-editor">
              <input value={draft.title || ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full bg-paper border border-line px-3 py-2 font-mono text-xs text-ink" />
              <textarea value={draft.content || ""} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={9} className="w-full bg-paper border border-line px-3 py-2 font-mono text-xs text-ink" data-testid="policy-content-editor" />
              <textarea value={draft.approved_summary || draft.ai_summary || ""} onChange={(e) => setDraft({ ...draft, approved_summary: e.target.value })} rows={4} placeholder="What's changed summary" className="w-full bg-paper border border-line px-3 py-2 font-mono text-xs text-ink" data-testid="policy-summary-editor" />
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="font-mono text-[10px] uppercase text-ink-muted">Publish/Notice<input type="datetime-local" value={draft.published_at || ""} onChange={(e) => setDraft({ ...draft, published_at: e.target.value })} className="mt-1 w-full bg-paper border border-line px-2 py-2 text-xs text-ink" /></label>
                <label className="font-mono text-[10px] uppercase text-ink-muted">Effective<input type="datetime-local" value={draft.effective_at || ""} onChange={(e) => setDraft({ ...draft, effective_at: e.target.value })} className="mt-1 w-full bg-paper border border-line px-2 py-2 text-xs text-ink" /></label>
                <label className="font-mono text-[10px] uppercase text-ink-muted">Ack Deadline<input type="datetime-local" value={draft.acknowledgement_deadline || ""} onChange={(e) => setDraft({ ...draft, acknowledgement_deadline: e.target.value })} className="mt-1 w-full bg-paper border border-line px-2 py-2 text-xs text-ink" /></label>
              </div>
              <div className="flex flex-wrap gap-4 font-mono text-xs text-ink"><label><input type="checkbox" checked={!!draft.acknowledgement_required} onChange={(e) => setDraft({ ...draft, acknowledgement_required: e.target.checked })} /> Require acknowledgement</label><label><input type="checkbox" checked={draft.email_enabled !== false} onChange={(e) => setDraft({ ...draft, email_enabled: e.target.checked })} /> Send email</label></div>
              {noticeWarn && <div className="border border-amber-500/40 bg-amber-500/5 p-3 font-mono text-xs text-amber-300" data-testid="policy-notice-warning">Fee policy notice is under 30 days. Override requires confirmation and a written reason.<label className="block mt-2"><input type="checkbox" checked={override.enabled} onChange={(e) => setOverride({ ...override, enabled: e.target.checked })} /> Override insufficient notice</label>{override.enabled && <input value={override.reason} onChange={(e) => setOverride({ ...override, reason: e.target.value })} placeholder="Override reason" className="mt-2 w-full bg-paper border border-line px-2 py-2 text-ink" />}</div>}
              <div className="flex flex-wrap gap-2"><button onClick={saveDraft} className="btn-industrial" disabled={busy}>Save</button><button onClick={runDiff} className="btn-industrial">Diff</button><button onClick={runAi} className="btn-industrial">Generate AI Summary</button><button onClick={runPreview} className="btn-industrial">Preview Notice</button><button onClick={loadStats} className="btn-industrial">Ack Stats</button><button onClick={schedule} className="btn-industrial btn-primary" disabled={busy}>Schedule</button><button onClick={publish} className="btn-industrial btn-primary" disabled={busy}>Publish Now</button>{active?.status === "scheduled" && <button onClick={() => cancelPolicySchedule(active.id).then(refreshDetail)} className="btn-industrial">Cancel</button>}{["draft", "scheduled"].includes(active?.status) && <button onClick={() => archivePolicyVersion(active.id).then(refreshDetail)} className="btn-industrial">Archive</button>}</div>
            </div>}
            {diff && <div className="border border-line p-4" data-testid="policy-diff-view"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand mb-2">Diff � +{diff.summary.added} -{diff.summary.removed} changed {diff.summary.changed}</div><div className="space-y-2 max-h-[360px] overflow-auto">{diff.sections.map((s, i) => <div key={i} className="grid sm:grid-cols-2 gap-2 font-mono text-[11px]"><pre className="bg-red-500/5 border border-red-500/20 p-2 whitespace-pre-wrap">{(s.old || []).join("\n")}</pre><pre className="bg-green-500/5 border border-green-500/20 p-2 whitespace-pre-wrap">{(s.new || []).join("\n")}</pre></div>)}</div></div>}
            {preview && <div className="border border-line p-4" data-testid="policy-notification-preview"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand mb-2">Notification Preview</div><p className="font-mono text-xs text-ink">{preview.policy_title} v{preview.version_number}</p><p className="font-mono text-xs text-ink-muted">Effective {fmt(preview.effective_at)} � {preview.acknowledgement_required ? "Acknowledgement required" : "Informational"}</p><p className="font-mono text-xs text-ink mt-2 whitespace-pre-wrap">{preview.summary}</p></div>}
            {stats && <div className="border border-line p-4 font-mono text-xs text-ink" data-testid="policy-ack-stats">Acknowledged {stats.acknowledged}/{stats.total} ({stats.percent}%) � Reviewed {stats.reviewed}</div>}
          </>}
        </div>
      </div>}
    </div>
  );
}
