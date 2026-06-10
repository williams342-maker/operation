import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shield, Plus, X, Crown, Users, Search } from "lucide-react";
import {
  fetchAdminTeam, inviteAdmin, updateAdminCaps, revokeAdmin,
} from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";
import { timeAgo } from "../../lib/timeAgo";

/** Multi-tier admin team management — visible to super admins only.
 *  Super admins are env-defined (ADMIN_EMAILS) and can never be revoked
 *  via the UI. Non-super admins live in `admin_users` and can be edited
 *  here (capabilities toggled, deactivated, or fully revoked).
 */
const CAP_LABELS = {
  marketplace: "Marketplace",
  content: "Content",
  support: "Support",
  finance: "Finance",
  moderation: "Moderation",
  read_only: "Read only",
};
const CAP_HINTS = {
  marketplace: "Approve makers · manage listings · suspend shops",
  content: "Homepage · banners · journal · SEO · featured products",
  support: "Tickets · refund initiation · custom-order intervention",
  finance: "Payouts · refund execution · commissions · ad spend",
  moderation: "Chat · forum · showcase moderation · user bans",
  read_only: "View dashboard, blocks every mutation",
};

export default function TeamTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await fetchAdminTeam());
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load team.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!data?.team) return [];
    const q = query.trim().toLowerCase();
    return data.team
      .filter((row) => showInactive || row.is_active !== false)
      .filter((row) => {
        if (!q) return true;
        if ((row.email || "").toLowerCase().includes(q)) return true;
        if ((row.capabilities || []).some((c) => c.toLowerCase().includes(q))) return true;
        return false;
      });
  }, [data, query, showInactive]);

  if (loading || !data) {
    return (
      <div className="py-12 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-brand" data-testid="team-loading">
        ◆ Loading team…
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="team-tab">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-1">◆ Access</div>
          <h2 className="font-display text-3xl uppercase">Admin Team.</h2>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-[60ch]">
            Super admins are managed via the <span className="text-brand">ADMIN_EMAILS</span> env
            and cannot be edited here. Multi-tier admins below can be granted any combination of capabilities
            (or read-only). Soft cap of 10 active admins.
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="btn-industrial btn-primary inline-flex items-center gap-2"
          data-testid="team-invite-btn"
        >
          <Plus size={14} /> Invite Admin
        </button>
      </div>

      <div className="border border-line" data-testid="team-table">
        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center px-4 py-3 border-b border-line bg-[#0c0c0c]">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search admins by email or capability…"
              className="w-full pl-9 pr-3 py-2 bg-paper border border-line focus:border-brand outline-none font-mono text-xs"
              data-testid="team-search-input"
            />
          </div>
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted flex items-center gap-2 shrink-0">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="accent-[#ff4500]"
              data-testid="team-show-inactive"
            />
            Show revoked
          </label>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted shrink-0">
            {filtered.length} / {data.team.length}
          </div>
        </div>
        <div className="grid grid-cols-[2fr_3fr_1fr_1fr] gap-3 px-4 py-3 border-b border-line bg-paper font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          <div>Email</div>
          <div>Capabilities</div>
          <div>Last seen</div>
          <div className="text-right">Actions</div>
        </div>
        {filtered.map((row) => (
          <TeamRow
            key={row.email}
            row={row}
            allCaps={data.capabilities}
            onChanged={load}
          />
        ))}
        {filtered.length === 0 && (
          <div className="p-8 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-ink-muted" data-testid="team-empty">
            ◆ {data.team.length === 0 ? "No admins yet." : query ? `No admins match "${query}".` : "No matching admins."}
          </div>
        )}
      </div>

      <div className="text-[10px] font-mono text-ink-muted tracking-[0.18em] uppercase">
        ◆ Cap presets: {Object.keys(data.presets).join(" · ")}
      </div>

      {showInvite && (
        <InviteModal
          presets={data.presets}
          allCaps={data.capabilities}
          onClose={() => setShowInvite(false)}
          onInvited={() => { setShowInvite(false); load(); }}
        />
      )}
    </div>
  );
}

function TeamRow({ row, allCaps, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [caps, setCaps] = useState(row.capabilities || []);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmModal] = useConfirm();
  const isSuper = !!row.is_super_admin;

  const toggleCap = (c) => {
    if (c === "read_only") {
      setCaps(caps.includes(c) ? [] : ["read_only"]);
      return;
    }
    setCaps((cur) => cur.includes(c)
      ? cur.filter((x) => x !== c)
      : [...cur.filter((x) => x !== "read_only"), c]);
  };

  const save = async () => {
    if (!caps.length) {
      toast.error("Pick at least one capability.");
      return;
    }
    setBusy(true);
    try {
      await updateAdminCaps(row.email, { capabilities: caps });
      toast.success("Capabilities updated.");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    setBusy(true);
    try {
      await updateAdminCaps(row.email, { is_active: !row.is_active });
      toast.success(row.is_active ? "Deactivated." : "Reactivated.");
      onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const ok = await confirm({
      title: "Revoke admin access?",
      body: `${row.email} will immediately lose all admin permissions. They can be re-invited later.`,
      confirmLabel: "Revoke",
      tone: "danger",
      testId: `confirm-revoke-${row.email}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await revokeAdmin(row.email);
      toast.success("Access revoked.");
      onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Revoke failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`grid grid-cols-[2fr_3fr_1fr_1fr] gap-3 px-4 py-4 border-b border-line items-center ${
        row.is_active === false ? "opacity-50" : ""
      }`}
      data-testid={`team-row-${row.email}`}
    >
      {confirmModal}
      <div className="font-mono text-xs text-ink flex items-center gap-2 min-w-0 truncate">
        {isSuper ? <Crown size={12} className="text-brand shrink-0" /> : <Shield size={12} className="text-ink-muted shrink-0" />}
        <span className="truncate">{row.email}</span>
        {isSuper && (
          <span className="bg-brand text-[#0a0a0a] text-[9px] font-mono px-1.5 py-0.5 uppercase tracking-[0.18em]">
            Super
          </span>
        )}
        {row.is_active === false && (
          <span className="border border-[#525252] text-ink-muted text-[9px] font-mono px-1.5 py-0.5 uppercase tracking-[0.18em]">
            Inactive
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(editing ? allCaps : (row.capabilities || [])).map((c) => {
          const on = caps.includes(c);
          return editing && !isSuper ? (
            <button
              key={c} onClick={() => toggleCap(c)}
              className={`px-2 py-0.5 border font-mono text-[10px] uppercase tracking-[0.18em] ${
                on ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-muted"
              }`}
              title={CAP_HINTS[c]}
              data-testid={`cap-toggle-${row.email}-${c}`}
            >
              {CAP_LABELS[c] || c}
            </button>
          ) : (
            <span
              key={c}
              className="px-2 py-0.5 border border-line bg-paper font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted"
              title={CAP_HINTS[c]}
            >
              {CAP_LABELS[c] || c}
            </span>
          );
        })}
      </div>
      <div
        className="font-mono text-[10px] text-ink-muted"
        title={row.last_seen ? new Date(row.last_seen).toLocaleString() : "Has never logged in."}
        data-testid={`team-last-seen-${row.email}`}
      >
        {row.last_seen ? timeAgo(row.last_seen) : <span className="text-ink-muted">never</span>}
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[10px] font-mono">
        {isSuper ? (
          <span className="text-ink-muted uppercase tracking-[0.18em]">env-locked</span>
        ) : editing ? (
          <>
            <button onClick={save} disabled={busy} className="px-2 py-1 border border-brand text-brand hover:bg-brand/10 uppercase tracking-[0.18em]" data-testid={`team-save-${row.email}`}>
              Save
            </button>
            <button onClick={() => { setEditing(false); setCaps(row.capabilities || []); }} className="px-2 py-1 text-ink-muted uppercase tracking-[0.18em]">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} disabled={busy} className="px-2 py-1 border border-line hover:border-brand uppercase tracking-[0.18em]" data-testid={`team-edit-${row.email}`}>
              Edit
            </button>
            <button onClick={toggleActive} disabled={busy} className="px-2 py-1 border border-line hover:border-brand uppercase tracking-[0.18em]">
              {row.is_active === false ? "Activate" : "Deactivate"}
            </button>
            <button onClick={revoke} disabled={busy} className="px-2 py-1 text-red-400 hover:bg-red-500/10 uppercase tracking-[0.18em]" data-testid={`team-revoke-${row.email}`}>
              Revoke
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function InviteModal({ presets, allCaps, onClose, onInvited }) {
  const [email, setEmail] = useState("");
  const [caps, setCaps] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const applyPreset = (key) => {
    setCaps([...(presets[key] || [])]);
  };

  const toggleCap = (c) => {
    if (c === "read_only") {
      setCaps(caps.includes(c) ? [] : ["read_only"]);
      return;
    }
    setCaps((cur) => cur.includes(c)
      ? cur.filter((x) => x !== c)
      : [...cur.filter((x) => x !== "read_only"), c]);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      toast.error("Valid email required.");
      return;
    }
    if (!caps.length) {
      toast.error("Pick at least one capability or a preset.");
      return;
    }
    setBusy(true);
    try {
      await inviteAdmin(email.trim().toLowerCase(), caps, note.trim() || null);
      toast.success(`Invite emailed to ${email}.`);
      onInvited();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Invite failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-paper/80 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md bg-paper border border-line mx-4 max-h-[88vh] flex flex-col"
        data-testid="team-invite-modal"
      >
        {/* Compact header — half the previous vertical footprint */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-brand">◆ Grant access</div>
            <h2 className="font-display text-lg uppercase leading-tight">Invite Admin</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-ink-muted hover:text-brand" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {/* Scrollable body — keeps header + send button fixed in view */}
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
            <div>
              <label className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted block mb-1">Email *</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-2.5 py-1.5 font-mono text-xs"
                data-testid="team-invite-email"
              />
            </div>
            <div>
              <label className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted block mb-1">Quick presets</label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(presets).map(([key, presetCaps]) => (
                  <button
                    type="button" key={key} onClick={() => applyPreset(key)}
                    className="px-2 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[9px] uppercase tracking-[0.18em]"
                    title={presetCaps.join(", ")}
                    data-testid={`team-preset-${key}`}
                  >
                    {key.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted block mb-1">Capabilities *</label>
              {/* 2-col compact grid — was a full-width 9-row stack with 3-line cards */}
              <div className="grid grid-cols-2 gap-1.5">
                {allCaps.map((c) => {
                  const on = caps.includes(c);
                  return (
                    <label
                      key={c}
                      className={`flex items-center gap-2 px-2 py-1.5 border cursor-pointer transition ${
                        on ? "border-brand bg-brand/5" : "border-line hover:border-line"
                      }`}
                      data-testid={`team-invite-cap-${c}`}
                      title={CAP_HINTS[c]}
                    >
                      <input
                        type="checkbox" checked={on}
                        onChange={() => toggleCap(c)}
                        className="accent-[#ff4500] shrink-0"
                      />
                      <span className={`font-mono text-[10px] uppercase tracking-[0.18em] truncate ${on ? "text-brand" : "text-ink"}`}>
                        {CAP_LABELS[c] || c}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted block mb-1">Note (optional)</label>
              <input
                type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400}
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-2.5 py-1.5 font-mono text-xs"
                placeholder="e.g. Q2 finance hire — refunds + payouts only"
              />
            </div>
          </div>
          {/* Sticky action footer — Send button always visible regardless of screen height */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line bg-paper shrink-0">
            <button type="button" onClick={onClose} className="px-3 py-2 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 bg-brand hover:bg-[#ff5722] text-ink font-mono text-[11px] uppercase tracking-[0.22em] inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_0_1px_#ff4500]"
              data-testid="team-invite-submit"
            >
              <Users size={14} /> {busy ? "Sending…" : "Send Invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
