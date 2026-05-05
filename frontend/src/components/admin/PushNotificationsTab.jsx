import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  fetchAdminPushStats,
  broadcastAdminPush,
  fetchAdminPushHistory,
  sendAdminPushTest,
} from "../../lib/api";
import {
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  getCurrentPushSubscription,
} from "../../lib/push";
import { useConfirm } from "../../hooks/useConfirm";

const AUDIENCES = [
  { id: "all",     label: "All Subscribers", hint: "Every device that has opted in." },
  { id: "buyers",  label: "Buyers",          hint: "Subscriptions tagged role=buyer." },
  { id: "makers",  label: "Makers",          hint: "Subscriptions tagged role=maker." },
  { id: "anon",    label: "Anonymous",       hint: "Visitors who subscribed without signing in." },
];

export default function PushNotificationsTab() {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [audience, setAudience] = useState("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/");
  const [busy, setBusy] = useState(false);
  const [mySub, setMySub] = useState(null);
  const [confirm, confirmModal] = useConfirm();

  const loadAll = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        fetchAdminPushStats(),
        fetchAdminPushHistory(50),
      ]);
      setStats(s);
      setHistory(h.history || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load push stats.");
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!isPushSupported()) return;
    getCurrentPushSubscription().then(setMySub).catch(() => setMySub(null));
  }, []);

  const handleEnable = async () => {
    if (!isPushSupported()) {
      toast.error("This browser doesn't support web push.");
      return;
    }
    setBusy(true);
    try {
      const adminEmail = (() => {
        try { return JSON.parse(localStorage.getItem("cm_admin_user") || "{}").email; } catch { return null; }
      })();
      await subscribeToPush({ role: "admin", email: adminEmail || null });
      const sub = await getCurrentPushSubscription();
      setMySub(sub);
      toast.success("Browser notifications enabled.");
      await loadAll();
    } catch (e) {
      toast.error(e?.message || "Could not enable notifications.");
    } finally { setBusy(false); }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setMySub(null);
      toast.success("Notifications disabled on this device.");
      await loadAll();
    } catch (e) {
      toast.error(e?.message || "Could not disable.");
    } finally { setBusy(false); }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      const r = await sendAdminPushTest();
      toast.success(`Test push sent to ${r.sent}/${r.total} of your devices.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test push failed.");
    } finally { setBusy(false); }
  };

  const handleBroadcast = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("Title and body are required.");
      return;
    }
    const target = stats?.by_role?.[audience] ?? 0;
    if (!target) {
      toast.error(`No subscribers in '${audience}'.`);
      return;
    }
    const ok = await confirm({
      title: "Send push broadcast?",
      message: `This will fan out to ${target} ${audience} subscriber(s). This cannot be undone.`,
      confirmLabel: `Send to ${target}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await broadcastAdminPush({ title, body, url: url || "/", audience });
      toast.success(`Broadcast sent: ${r.sent} delivered, ${r.failed} failed${r.pruned ? `, ${r.pruned} pruned` : ""}.`);
      setTitle(""); setBody(""); setUrl("/");
      await loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Broadcast failed.");
    } finally { setBusy(false); }
  };

  const counts = stats?.by_role || {};
  const supported = isPushSupported();

  return (
    <div className="space-y-8" data-testid="push-tab">
      {confirmModal}

      <div>
        <h3 className="font-display text-2xl text-[#e5e5e5]">Push notifications</h3>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
          Web Push via VAPID. Visitors opt-in from buyer/maker dashboards. Use this tab to
          broadcast to a cohort, view subscriber counts, and inspect send history.
        </p>
      </div>

      {/* This device */}
      <div className="border border-[#262626] p-5 flex flex-wrap items-center gap-3" data-testid="push-self-card">
        <div className="flex-1 min-w-[260px]">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">This device</div>
          <div className="font-mono text-sm text-[#e5e5e5] mt-1">
            {!supported && <span className="text-amber-400">Browser does not support web push.</span>}
            {supported && (mySub
              ? <span className="text-emerald-400">◆ Subscribed — you'll receive admin alerts here.</span>
              : <span className="text-[#a3a3a3]">Not subscribed yet.</span>
            )}
          </div>
        </div>
        {supported && !mySub && (
          <button
            onClick={handleEnable}
            disabled={busy}
            data-testid="push-enable-btn"
            className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-xs uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            Enable browser notifications
          </button>
        )}
        {supported && mySub && (
          <>
            <button
              onClick={handleTest}
              disabled={busy}
              data-testid="push-test-btn"
              className="px-4 py-2 border border-[#262626] hover:border-sky-500 hover:text-sky-400 font-mono text-xs uppercase tracking-[0.22em] transition disabled:opacity-50"
            >
              Send test push
            </button>
            <button
              onClick={handleDisable}
              disabled={busy}
              data-testid="push-disable-btn"
              className="px-4 py-2 border border-[#262626] hover:border-rose-500 hover:text-rose-400 font-mono text-xs uppercase tracking-[0.22em] transition disabled:opacity-50"
            >
              Disable
            </button>
          </>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="push-stats-grid">
        {AUDIENCES.map((a) => (
          <div key={a.id} className="border border-[#262626] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{a.label}</div>
            <div className="font-display text-3xl text-[#e5e5e5] mt-2" data-testid={`push-count-${a.id}`}>
              {counts[a.id] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* Compose */}
      <div className="border border-[#262626] p-5 space-y-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">Audience</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {AUDIENCES.map((a) => (
              <button
                key={a.id}
                onClick={() => setAudience(a.id)}
                data-testid={`push-audience-${a.id}`}
                className={`text-left border p-3 transition ${
                  audience === a.id
                    ? "border-[#ff4500] bg-[#ff4500]/5"
                    : "border-[#262626] hover:border-[#525252]"
                }`}
              >
                <div className="font-mono text-xs text-[#e5e5e5] uppercase tracking-[0.22em]">
                  {a.label} <span className="text-[#a3a3a3]">· {counts[a.id] ?? 0}</span>
                </div>
                <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">{a.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Title (max 120)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="New drop is live"
            data-testid="push-title"
            className="w-full mt-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-display text-xl text-[#e5e5e5]"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Body (max 400)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={400}
            placeholder="50 new pieces from vetted makers — shop the drop before they're gone."
            data-testid="push-body"
            className="w-full mt-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm text-[#e5e5e5] leading-relaxed resize-none"
          />
          <div className="font-mono text-[10px] text-[#525252] mt-1">{body.length}/400</div>
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Click-through URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/shop"
            data-testid="push-url"
            className="w-full mt-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleBroadcast}
            disabled={busy || !title.trim() || !body.trim()}
            data-testid="push-broadcast-btn"
            className="btn-industrial btn-primary disabled:opacity-50"
          >
            {busy ? "Sending…" : `Broadcast to ${counts[audience] ?? 0} →`}
          </button>
        </div>
      </div>

      {/* History */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
          Broadcast history
        </div>
        {history.length === 0 ? (
          <div className="border border-[#262626] p-5 font-mono text-xs text-[#a3a3a3]">
            No broadcasts yet.
          </div>
        ) : (
          <div className="border border-[#262626]" data-testid="push-history">
            {history.map((h) => (
              <div key={h.id} className="border-b border-[#262626] last:border-b-0 p-4 flex flex-wrap gap-3">
                <div className="flex-1 min-w-[260px]">
                  <div className="font-display text-lg text-[#e5e5e5]">{h.title}</div>
                  <div className="font-mono text-xs text-[#a3a3a3] mt-1 line-clamp-2">{h.body}</div>
                  <div className="font-mono text-[10px] text-[#525252] mt-2">
                    {h.audience.toUpperCase()} · {new Date(h.created_at).toLocaleString()} · by {h.actor || "—"}
                  </div>
                </div>
                <div className="font-mono text-xs text-right">
                  <div className="text-emerald-400">{h.sent} sent</div>
                  {h.failed > 0 && <div className="text-amber-400">{h.failed} failed</div>}
                  {h.pruned > 0 && <div className="text-[#525252]">{h.pruned} pruned</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
