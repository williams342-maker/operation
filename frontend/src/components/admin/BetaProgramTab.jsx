/**
 * iter428 — Admin panel for the beta app-testing program.
 * Two roles: (1) toggle program on/off + edit URLs + tune the community
 * stat counters, (2) audit the signup list.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const API = process.env.REACT_APP_BACKEND_URL;
const _auth = () => {
  const t = localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export default function BetaProgramTab() {
  const [cfg, setCfg] = useState(null);
  const [signups, setSignups] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [viewShot, setViewShot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s, f] = await Promise.all([
        fetch(`${API}/api/admin/beta-program/config`, { headers: _auth() }).then(r => r.json()),
        fetch(`${API}/api/admin/beta-program/signups`, { headers: _auth() }).then(r => r.json()),
        fetch(`${API}/api/admin/beta-program/feedback`, { headers: _auth() }).then(r => r.json()),
      ]);
      setCfg(c); setSignups(s.signups || []); setFeedback(f.feedback || []);
    } catch (e) { toast.error(`Load failed: ${e.message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const FEEDBACK_STATUS_OPTIONS = [
    { value: "new", label: "New" },
    { value: "reviewed", label: "Reviewed" },
    { value: "resolved", label: "Resolved" },
  ];

  async function setFeedbackStatus(id, status) {
    try {
      const r = await fetch(`${API}/api/admin/beta-program/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ..._auth() },
        body: JSON.stringify({ status }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setFeedback((rows) => rows.map((f) => (f.id === id ? { ...f, status } : f)));
      toast.success("Feedback status updated.");
    } catch (e) { toast.error(e.message); }
  }

  const STATUS_OPTIONS = [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "invitation_sent", label: "Invitation Sent" },
    { value: "installed", label: "Installed" },
    { value: "active_tester", label: "Active Tester" },
    { value: "removed", label: "Removed" },
  ];

  async function setStatus(id, status) {
    try {
      const r = await fetch(`${API}/api/admin/beta-program/signups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ..._auth() },
        body: JSON.stringify({ status }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setSignups((rows) => rows.map((s) => (s.id === id ? { ...s, status } : s)));
      toast.success("Status updated.");
    } catch (e) { toast.error(e.message); }
  }

  const [inviting, setInviting] = useState(null);
  async function sendInvite(row) {
    if (!window.confirm(`Email the ${(row.platform || row.device || "").toUpperCase()} beta invite to ${row.email}?`)) return;
    setInviting(row.id);
    try {
      const r = await fetch(`${API}/api/admin/beta-program/signups/${row.id}/invite`, {
        method: "POST",
        headers: { ..._auth() },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setSignups((rows) => rows.map((s) => (s.id === row.id ? { ...s, ...d } : s)));
      toast.success(`Invite sent to ${row.email}.`);
    } catch (e) { toast.error(e.message); }
    finally { setInviting(null); }
  }

  async function save() {
    setSaving(true);
    try {
      const body = {
        enabled: cfg.enabled,
        android_url: cfg.android_url,
        ios_url: cfg.ios_url,
        headline: cfg.headline,
        bugs_fixed: Number(cfg.bugs_fixed) || 0,
        features_requested: Number(cfg.features_requested) || 0,
        features_released: Number(cfg.features_released) || 0,
      };
      const r = await fetch(`${API}/api/admin/beta-program/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ..._auth() },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setCfg(d);
      toast.success("Beta program config saved.");
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading || !cfg) return (
    <div className="border border-line p-6 text-center text-ink-muted font-mono text-xs">Loading…</div>
  );

  return (
    <div className="space-y-6" data-testid="beta-program-tab">
      <div className="border border-line p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">◆ Program config</div>

        <label className="flex items-center gap-3 mb-4">
          <input type="checkbox" checked={!!cfg.enabled}
                 onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
                 className="accent-brand" data-testid="bp-enabled" />
          <span className="text-ink">Beta program is active (renders the /app-testing landing page + header hint)</span>
        </label>

        <label className="block mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Headline</span>
          <input value={cfg.headline || ""}
                 onChange={(e) => setCfg({ ...cfg, headline: e.target.value })}
                 maxLength={140}
                 className="mt-1 w-full border border-line bg-paper px-3 py-2 font-mono text-sm"
                 data-testid="bp-headline" />
        </label>
        <label className="block mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Android join URL (Google Play testing)</span>
          <input value={cfg.android_url || ""}
                 onChange={(e) => setCfg({ ...cfg, android_url: e.target.value })}
                 className="mt-1 w-full border border-line bg-paper px-3 py-2 font-mono text-xs"
                 data-testid="bp-android-url" />
        </label>
        <label className="block mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">iOS join URL (TestFlight)</span>
          <input value={cfg.ios_url || ""}
                 onChange={(e) => setCfg({ ...cfg, ios_url: e.target.value })}
                 className="mt-1 w-full border border-line bg-paper px-3 py-2 font-mono text-xs"
                 data-testid="bp-ios-url" />
        </label>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { k: "bugs_fixed",         label: "Bugs fixed" },
            { k: "features_requested", label: "Feature requests" },
            { k: "features_released",  label: "Features released" },
          ].map(f => (
            <label key={f.k} className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{f.label}</span>
              <input type="number" min="0" value={cfg[f.k] ?? 0}
                     onChange={(e) => setCfg({ ...cfg, [f.k]: e.target.value })}
                     className="mt-1 w-full border border-line bg-paper px-3 py-2 font-mono text-sm tabular-nums"
                     data-testid={`bp-${f.k}`} />
            </label>
          ))}
        </div>

        <button onClick={save} disabled={saving}
                className="bg-brand hover:bg-brand-hover text-ink font-mono text-xs uppercase tracking-[0.22em] px-6 py-2 disabled:opacity-40"
                data-testid="bp-save">
          {saving ? "…" : "Save configuration"}
        </button>
      </div>

      <div className="border border-line p-6" data-testid="bp-signups-section">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
          ◆ Signups · {signups.length}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-ink-muted uppercase tracking-[0.18em] text-[10px]">
                <th className="text-left px-2 py-2">Submitted</th>
                <th className="text-left px-2 py-2">Name</th>
                <th className="text-left px-2 py-2">Email</th>
                <th className="text-left px-2 py-2">Platform</th>
                <th className="text-left px-2 py-2">Phone model</th>
                <th className="text-left px-2 py-2">Role</th>
                <th className="text-left px-2 py-2">Notes</th>
                <th className="text-left px-2 py-2">Status</th>
                <th className="text-left px-2 py-2">Invite</th>
              </tr>
            </thead>
            <tbody>
              {signups.length === 0 && (
                <tr><td colSpan={9} className="text-center py-6 text-ink-muted">No signups yet.</td></tr>
              )}
              {signups.map(s => (
                <tr key={s.id} className="border-t border-line align-top" data-testid={`bp-signup-row-${s.id}`}>
                  <td className="px-2 py-2 whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</td>
                  <td className="px-2 py-2">{s.name}</td>
                  <td className="px-2 py-2">{s.email}</td>
                  <td className="px-2 py-2 uppercase">{s.platform || s.device}</td>
                  <td className="px-2 py-2">{s.phone_model || "—"}</td>
                  <td className="px-2 py-2 capitalize">{s.role || "—"}</td>
                  <td className="px-2 py-2 max-w-[220px] whitespace-pre-wrap break-words">{s.notes || "—"}</td>
                  <td className="px-2 py-2">
                    <select
                      value={s.status || "pending"}
                      onChange={(e) => setStatus(s.id, e.target.value)}
                      className="border border-line bg-paper px-2 py-1 font-mono text-[11px]"
                      data-testid={`bp-status-${s.id}`}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => sendInvite(s)}
                      disabled={inviting === s.id}
                      className="border border-brand text-brand hover:bg-brand hover:text-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-40 transition whitespace-nowrap"
                      data-testid={`bp-invite-${s.id}`}
                      title="Email setup instructions and mark as Invitation Sent"
                    >
                      {inviting === s.id ? "Sending…" : s.status === "invitation_sent" ? "Resend" : "Send invite"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border border-line p-6" data-testid="bp-feedback-section">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
          ◆ Feedback · {feedback.length}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-ink-muted uppercase tracking-[0.18em] text-[10px]">
                <th className="text-left px-2 py-2">Submitted</th>
                <th className="text-left px-2 py-2">Platform</th>
                <th className="text-left px-2 py-2">Type</th>
                <th className="text-left px-2 py-2">From</th>
                <th className="text-left px-2 py-2">Phone model</th>
                <th className="text-left px-2 py-2">Message</th>
                <th className="text-left px-2 py-2">Shot</th>
                <th className="text-left px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {feedback.length === 0 && (
                <tr><td colSpan={8} className="text-center py-6 text-ink-muted">No feedback yet.</td></tr>
              )}
              {feedback.map(f => (
                <tr key={f.id} className="border-t border-line align-top" data-testid={`bp-feedback-row-${f.id}`}>
                  <td className="px-2 py-2 whitespace-nowrap">{new Date(f.created_at).toLocaleString()}</td>
                  <td className="px-2 py-2 uppercase">{f.platform}</td>
                  <td className="px-2 py-2 capitalize">{f.type}</td>
                  <td className="px-2 py-2">{f.name ? `${f.name} · ` : ""}{f.email}</td>
                  <td className="px-2 py-2">{f.phone_model || "—"}</td>
                  <td className="px-2 py-2 max-w-[280px] whitespace-pre-wrap break-words">{f.message}</td>
                  <td className="px-2 py-2">
                    {f.screenshot ? (
                      <button onClick={() => setViewShot(f.screenshot)}
                              className="text-brand hover:underline text-[11px]"
                              data-testid={`bp-feedback-shot-${f.id}`}>
                        View
                      </button>
                    ) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={f.status || "new"}
                      onChange={(e) => setFeedbackStatus(f.id, e.target.value)}
                      className="border border-line bg-paper px-2 py-1 font-mono text-[11px]"
                      data-testid={`bp-feedback-status-${f.id}`}
                    >
                      {FEEDBACK_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {viewShot && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
             onClick={() => setViewShot(null)} data-testid="bp-shot-modal">
          <img src={viewShot} alt="feedback screenshot" className="max-h-[85vh] max-w-full border border-line" />
        </div>
      )}
    </div>
  );
}
