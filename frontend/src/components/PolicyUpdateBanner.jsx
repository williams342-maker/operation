import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { acknowledgePolicyNotice, fetchMakerPolicyNotices, reviewPolicyNotice } from "../lib/api";

function fmt(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").slice(0, 16);
}

export default function PolicyUpdateBanner() {
  const [data, setData] = useState(null);
  const [checked, setChecked] = useState({});
  const [busy, setBusy] = useState("");

  const load = () => fetchMakerPolicyNotices().then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  const notices = data?.notices || [];
  if (!notices.length) return null;

  async function markReviewed(n) {
    setBusy(n.id);
    try { await reviewPolicyNotice(n.id); toast.success("Policy update marked reviewed."); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not mark reviewed."); }
    finally { setBusy(""); }
  }

  async function acknowledge(n) {
    setBusy(n.id);
    try {
      await acknowledgePolicyNotice({ notification_id: n.id, version_id: n.version_id, accepted: true });
      toast.success("Policy acknowledgement recorded."); await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not acknowledge policy."); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-3" data-testid="policy-update-banner">
      {notices.map((n) => {
        const p = n.payload || {};
        const required = !!p.acknowledgement_required;
        const days = p.notice?.days_remaining ?? 0;
        return <div key={n.id} className="border border-amber-600/40 bg-amber-500/5 p-4 flex gap-3 items-start">
          {required ? <AlertTriangle size={18} className="text-amber-300 mt-0.5" /> : <CheckCircle2 size={18} className="text-brand mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand">{required ? "Policy Updated · Acknowledgement Required" : "Upcoming Policy Change"}</div>
            <div className="font-display text-xl text-ink mt-1">{p.policy_title} <span className="text-brand">v{p.version_number}</span></div>
            <p className="font-mono text-[11px] text-ink-muted mt-1">Effective {fmt(p.effective_at)} · {p.notice?.in_effect ? "In effect" : `${days} day${days === 1 ? "" : "s"} remaining`}</p>
            <p className="font-mono text-xs text-ink mt-3 whitespace-pre-wrap">{p.summary}</p>
            {required && <label className="flex items-start gap-2 mt-3 font-mono text-[11px] text-ink"><input type="checkbox" checked={!!checked[n.id]} onChange={(e) => setChecked({ ...checked, [n.id]: e.target.checked })} className="mt-0.5 accent-[#ff4500]" /> I have reviewed this exact policy version and agree to it.</label>}
            <div className="flex flex-wrap gap-2 mt-4">
              <a href={p.compare_url || p.url} className="btn-industrial" data-testid="policy-view-changes">View Changes</a>
              <a href={p.url || "/policies"} className="btn-industrial" data-testid="policy-view-full">View Full Policy</a>
              {required ? <button onClick={() => acknowledge(n)} disabled={!checked[n.id] || busy === n.id} className="btn-industrial btn-primary" data-testid="policy-acknowledge-btn">Acknowledge</button> : <button onClick={() => markReviewed(n)} disabled={busy === n.id} className="btn-industrial btn-primary" data-testid="policy-reviewed-btn">Mark Reviewed</button>}
            </div>
          </div>
        </div>;
      })}
    </div>
  );
}
