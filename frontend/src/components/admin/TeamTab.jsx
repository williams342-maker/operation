import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shield, Plus, X, Crown, Users } from "lucide-react";
import {
  fetchAdminTeam, inviteAdmin, updateAdminCaps, revokeAdmin,
} from "../../lib/api";

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

  if (loading || !data) {
    return (
      <div className="py-12 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]" data-testid="team-loading">
        ◆ Loading team…
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="team-tab">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-1">◆ Access</div>
          <h2 className="font-display text-3xl uppercase">Admin Team.</h2>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-[60ch]">
            Super admins are managed via the <span className="text-[#ff4500]">ADMIN_EMAILS</span> env
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

      <div className="border border-[#262626]" data-testid="team-table">
        <div className="grid grid-cols-[2fr_3fr_1fr_1fr] gap-3 px-4 py-3 border-b border-[#262626] bg-[#0f0f0f] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          <div>Email</div>
          <div>Capabilities</div>
          <div>Last seen</div>
          <div className="text-right">Actions</div>
        </div>
        {data.team.map((row) => (
          <TeamRow
            key={row.email}
            row={row}
            allCaps={data.capabilities}
            onChanged={load}
          />
        ))}
        {data.team.length === 0 && (
          <div className="p-8 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-[#525252]">
            ◆ No admins yet.
          </div>
        )}
      </div>

      <div className="text-[10px] font-mono text-[#525252] tracking-[0.18em] uppercase">
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
    if (!window.confirm(`Permanently revoke admin access for ${row.email}?`)) return;
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
      className={`grid grid-cols-[2fr_3fr_1fr_1fr] gap-3 px-4 py-4 border-b border-[#1f1f1f] items-center ${
        row.is_active === false ? "opacity-50" : ""
      }`}
      data-testid={`team-row-${row.email}`}
    >
      <div className="font-mono text-xs text-[#e5e5e5] flex items-center gap-2 min-w-0 truncate">
        {isSuper ? <Crown size={12} className="text-[#ff4500] shrink-0" /> : <Shield size={12} className="text-[#a3a3a3] shrink-0" />}
        <span className="truncate">{row.email}</span>
        {isSuper && (
          <span className="bg-[#ff4500] text-[#0a0a0a] text-[9px] font-mono px-1.5 py-0.5 uppercase tracking-[0.18em]">
            Super
          </span>
        )}
        {row.is_active === false && (
          <span className="border border-[#525252] text-[#737373] text-[9px] font-mono px-1.5 py-0.5 uppercase tracking-[0.18em]">
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
                on ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]" : "border-[#262626] text-[#a3a3a3]"
              }`}
              title={CAP_HINTS[c]}
              data-testid={`cap-toggle-${row.email}-${c}`}
            >
              {CAP_LABELS[c] || c}
            </button>
          ) : (
            <span
              key={c}
              className="px-2 py-0.5 border border-[#262626] bg-[#0d0d0d] font-mono text-[10px] uppercase tracking-[0.18em] text-[#a3a3a3]"
              title={CAP_HINTS[c]}
            >
              {CAP_LABELS[c] || c}
            </span>
          );
        })}
      </div>
      <div className="font-mono text-[10px] text-[#737373]">
        {row.last_seen ? new Date(row.last_seen).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[10px] font-mono">
        {isSuper ? (
          <span className="text-[#525252] uppercase tracking-[0.18em]">env-locked</span>
        ) : editing ? (
          <>
            <button onClick={save} disabled={busy} className="px-2 py-1 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500]/10 uppercase tracking-[0.18em]" data-testid={`team-save-${row.email}`}>
              Save
            </button>
            <button onClick={() => { setEditing(false); setCaps(row.capabilities || []); }} className="px-2 py-1 text-[#737373] uppercase tracking-[0.18em]">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} disabled={busy} className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] uppercase tracking-[0.18em]" data-testid={`team-edit-${row.email}`}>
              Edit
            </button>
            <button onClick={toggleActive} disabled={busy} className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] uppercase tracking-[0.18em]">
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
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#0a0a0a] border border-[#262626] mx-4" data-testid="team-invite-modal">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#262626]">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">◆ Grant access</div>
            <h2 className="font-display text-2xl uppercase">Invite Admin</h2>
          </div>
          <button onClick={onClose} className="p-2 text-[#a3a3a3] hover:text-[#ff4500]" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Email *</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
              data-testid="team-invite-email"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Quick presets</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(presets).map(([key, presetCaps]) => (
                <button
                  type="button" key={key} onClick={() => applyPreset(key)}
                  className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.18em]"
                  title={presetCaps.join(", ")}
                  data-testid={`team-preset-${key}`}
                >
                  {key.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Capabilities *</label>
            <div className="space-y-2">
              {allCaps.map((c) => (
                <label key={c} className="flex items-start gap-3 p-3 border border-[#262626] hover:border-[#404040] cursor-pointer" data-testid={`team-invite-cap-${c}`}>
                  <input
                    type="checkbox" checked={caps.includes(c)}
                    onChange={() => toggleCap(c)}
                    className="mt-0.5 accent-[#ff4500]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs uppercase tracking-[0.22em] text-[#e5e5e5] block">
                      {CAP_LABELS[c] || c}
                    </span>
                    <span className="font-mono text-[10px] text-[#737373] mt-0.5 block">
                      {CAP_HINTS[c]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Note (optional)</label>
            <input
              type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400}
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
              placeholder="e.g. Q2 finance hire — refunds + payouts only"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-[#262626]">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50" data-testid="team-invite-submit">
              <Users size={14} /> {busy ? "Sending…" : "Send Invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
