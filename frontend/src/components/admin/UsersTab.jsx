import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchAdminModerationUsers,
  adminModerateUser,
  adminDeleteUser,
  adminSendPasswordReset,
  adminForceSignout,
} from "../../lib/api";
import useModalA11y from "../../hooks/useModalA11y";

export default function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  // confirmAction shape: { user, action: 'freeze'|'ban'|'restore'|'delete' }

  const refresh = async (overrideQ, overrideStatus) => {
    setLoading(true);
    setErr("");
    try {
      const data = await fetchAdminModerationUsers({
        q: (overrideQ ?? q).trim() || undefined,
        status: (overrideStatus ?? status) === "all" ? undefined : (overrideStatus ?? status),
        limit: 200,
      });
      setUsers(data.users || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onApply = async ({ user, action, reason }) => {
    setBusyId(user.user_id);
    setErr("");
    try {
      if (action === "delete") {
        await adminDeleteUser(user.user_id);
        toast.success(`Deleted ${user.email}`);
      } else if (action === "send-reset") {
        const tok = localStorage.getItem("admin_jwt");
        const r = await adminSendPasswordReset(tok, {
          role: "buyer", email: user.email,
          origin_url: window.location.origin, return_link: true,
        });
        // Show admin the reset link in case email is broken
        if (r.link) {
          await navigator.clipboard.writeText(r.link).catch(() => {});
          toast.success(`Reset link emailed to ${user.email} & copied to clipboard.`);
          window.alert(
            `Reset link sent to ${user.email}.\n\n` +
            `Also copied to your clipboard (in case email is broken):\n\n${r.link}\n\n` +
            `Link expires in 30 minutes and is single-use.`
          );
        } else {
          toast.success(`Reset link emailed to ${user.email}.`);
        }
      } else if (action === "force-signout") {
        const tok = localStorage.getItem("admin_jwt");
        await adminForceSignout(tok, { role: "buyer", email: user.email });
        toast.success(`Force-signed-out ${user.email} on all devices.`);
      } else {
        const next = action === "restore" ? "active" : action === "freeze" ? "frozen" : "banned";
        await adminModerateUser(user.user_id, next, reason || "");
        toast.success(`${user.name || user.email} → ${next}`);
      }
      setConfirmAction(null);
      await refresh();
    } catch (e) {
      const msg = e?.response?.data?.detail || `Failed to ${action} user.`;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusyId("");
    }
  };

  return (
    <div data-testid="users-tab" className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3 pb-4 border-b border-[#262626]">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") refresh(); }}
          placeholder="Search email, name, or user_id…"
          className="flex-1 bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
          data-testid="users-search-input"
        />
        <div className="flex border border-[#262626]" role="tablist">
          {["all", "active", "frozen", "banned"].map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); refresh(q, s); }}
              className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] transition border-r border-[#262626] last:border-r-0 ${
                status === s ? "bg-[#ff4500] text-[#0a0a0a]" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
              data-testid={`users-filter-${s}`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => refresh()}
          className="px-3 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]"
          data-testid="users-refresh-btn"
        >
          Refresh
        </button>
      </div>

      {err && (
        <p className="font-mono text-xs text-red-400" data-testid="users-error">{err}</p>
      )}

      {loading ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="users-loading">Loading…</p>
      ) : !users.length ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="users-empty">
          No matching users.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="font-mono text-xs text-[#a3a3a3]" data-testid="users-count">
            {users.length} {status === "all" ? "members" : status}
          </p>
          {users.map((u) => (
            <UserRow
              key={u.user_id}
              user={u}
              busy={busyId === u.user_id}
              onAction={(action) => {
                // No-confirm-modal actions: dispatch immediately
                if (action === "send-reset" || action === "force-signout") {
                  onApply({ user: u, action });
                } else {
                  setConfirmAction({ user: u, action });
                }
              }}
            />
          ))}
        </div>
      )}

      {confirmAction && (
        <ModerationConfirmModal
          {...confirmAction}
          onCancel={() => setConfirmAction(null)}
          onConfirm={(reason) => onApply({ ...confirmAction, reason })}
        />
      )}
    </div>
  );
}

function UserRow({ user: u, busy, onAction }) {
  const modStatus = u.moderation_status || "active";
  const isBanned = modStatus === "banned";
  const isFrozen = modStatus === "frozen";
  const badgeClass = isBanned
    ? "bg-red-900/40 text-red-300 border-red-800"
    : isFrozen
    ? "bg-yellow-900/40 text-yellow-300 border-yellow-800"
    : "bg-emerald-900/30 text-emerald-300 border-emerald-800";
  return (
    <div
      className="border border-[#262626] hover:border-[#ff4500] transition p-3 flex flex-col md:flex-row md:items-center gap-3"
      data-testid={`user-${u.user_id}`}
    >
      {u.picture ? (
        <img src={u.picture} alt="" className="w-10 h-10 rounded-full object-cover border border-[#262626]" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[#121212] border border-[#262626] flex items-center justify-center font-mono text-xs text-[#a3a3a3] shrink-0">
          {(u.name || u.email || "?")[0]?.toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-display text-base truncate">{u.name || u.email.split("@")[0]}</div>
          <span
            className={`px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em] ${badgeClass}`}
            data-testid={`user-status-${u.user_id}`}
          >
            {modStatus}
          </span>
        </div>
        <a href={`mailto:${u.email}`} className="font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.22em] hover:text-[#ff4500]">
          {u.email}
        </a>
        {u.moderation_reason && (
          <div className="font-mono text-[10px] text-red-400 mt-1 truncate" title={u.moderation_reason}>
            ◆ {u.moderation_reason}
          </div>
        )}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] md:text-right shrink-0">
        <div>{u.thread_count || 0} threads · {u.reply_count || 0} replies</div>
        <div>joined {(u.created_at || "").slice(0, 10)}</div>
        <div>last seen {(u.last_seen || u.created_at || "").slice(0, 10)}</div>
      </div>
      <div className="flex flex-wrap gap-1 shrink-0">
        {/* Password tools — available regardless of moderation status */}
        <button
          disabled={busy}
          onClick={() => onAction("send-reset")}
          title="Email this user a 30-min single-use password reset link. Link is also copied to your clipboard so you can deliver it via another channel if their email is broken."
          className="px-2 py-1 border border-blue-800 hover:border-blue-500 hover:text-blue-300 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
          data-testid={`user-reset-${u.user_id}`}
        >
          Send Reset
        </button>
        <button
          disabled={busy}
          onClick={() => onAction("force-signout")}
          title="Invalidate all of this user's active sessions on every device. They'll have to sign in again."
          className="px-2 py-1 border border-purple-800 hover:border-purple-500 hover:text-purple-300 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
          data-testid={`user-signout-${u.user_id}`}
        >
          Force Signout
        </button>
        {modStatus === "active" && (
          <>
            <button
              disabled={busy}
              onClick={() => onAction("freeze")}
              className="px-2 py-1 border border-yellow-800 hover:border-yellow-500 hover:text-yellow-300 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
              data-testid={`user-freeze-${u.user_id}`}
            >
              Freeze
            </button>
            <button
              disabled={busy}
              onClick={() => onAction("ban")}
              className="px-2 py-1 border border-red-800 hover:border-red-500 hover:text-red-300 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
              data-testid={`user-ban-${u.user_id}`}
            >
              Ban
            </button>
          </>
        )}
        {modStatus !== "active" && (
          <button
            disabled={busy}
            onClick={() => onAction("restore")}
            className="px-2 py-1 border border-emerald-800 hover:border-emerald-500 hover:text-emerald-300 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
            data-testid={`user-restore-${u.user_id}`}
          >
            Restore
          </button>
        )}
        {modStatus === "frozen" && (
          <button
            disabled={busy}
            onClick={() => onAction("ban")}
            className="px-2 py-1 border border-red-800 hover:border-red-500 hover:text-red-300 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
            data-testid={`user-ban-${u.user_id}`}
          >
            Ban
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => onAction("delete")}
          className="px-2 py-1 border border-[#262626] hover:border-red-500 hover:text-red-300 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
          data-testid={`user-delete-${u.user_id}`}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ModerationConfirmModal({ user, action, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  const isDelete = action === "delete";
  const requiresReason = action === "freeze" || action === "ban";
  const dialogRef = useModalA11y(onCancel);

  const headlines = {
    freeze: "Freeze user?",
    ban: "Ban user?",
    restore: "Restore user?",
    delete: "Hard-delete user?",
  };
  const blurbs = {
    freeze: "Frozen users keep their posts visible but are blocked from sign-in, posting, replying, and chat until restored.",
    ban: "Banned users are blocked from sign-in. All of their existing forum threads + replies will be veiled with `[removed by moderators]`.",
    restore: "This will reset moderation status to active. Any veiled posts from a previous ban will be restored.",
    delete: "This permanently removes the user record AND scrubs every thread, reply, and chat message they ever posted. Cannot be undone.",
  };
  const ctaClass = isDelete || action === "ban"
    ? "bg-red-600 hover:bg-red-500 text-white border-red-700"
    : action === "freeze"
    ? "bg-yellow-500 hover:bg-yellow-400 text-[#0a0a0a] border-yellow-600"
    : "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
      data-testid="user-mod-modal"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-mod-headline"
        className="bg-[#0a0a0a] border border-[#262626] max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
          ◆ Moderation
        </div>
        <h3 id="user-mod-headline" className="font-display text-2xl uppercase">{headlines[action]}</h3>
        <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
          {blurbs[action]}
        </p>
        <div className="border border-[#262626] p-3 space-y-1">
          <div className="font-display text-base truncate">{user.name || user.email.split("@")[0]}</div>
          <div className="font-mono text-[10px] text-[#a3a3a3] truncate">{user.email}</div>
          <div className="font-mono text-[10px] text-[#525252]">
            {user.thread_count || 0} threads · {user.reply_count || 0} replies
          </div>
        </div>
        {requiresReason && (
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              Reason {requiresReason && <span className="text-[#ff4500]">(required)</span>}
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={action === "ban" ? "e.g. Repeat policy violation — harassment in #showcase" : "e.g. Spam reports — temporary timeout"}
              className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
              data-testid="user-mod-reason"
              autoFocus
            />
          </label>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="user-mod-cancel"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={requiresReason && !reason.trim()}
            className={`px-4 py-2 border font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50 disabled:cursor-not-allowed ${ctaClass}`}
            data-testid="user-mod-confirm"
          >
            {action === "delete" ? "Delete forever" : action === "ban" ? "Ban user" : action === "freeze" ? "Freeze user" : "Restore user"}
          </button>
        </div>
      </div>
    </div>
  );
}
