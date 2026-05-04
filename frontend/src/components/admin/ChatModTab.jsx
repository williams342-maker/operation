import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2, MicOff, Volume2, MessageSquare } from "lucide-react";
import {
  fetchAdminChatMessages, adminChatDeleteMessage,
  fetchAdminChatMutes, adminChatMute, adminChatUnmute,
} from "../../lib/api";
import { RowsSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";
import { useConfirm } from "../../hooks/useConfirm";

const CHANNELS = ["general", "wins", "help", "marketplace", "makers-only"];
const MUTE_PRESETS = [
  { label: "10 min", minutes: 10 },
  { label: "1 hour", minutes: 60 },
  { label: "24 hours", minutes: 60 * 24 },
  { label: "Indefinite", minutes: null },
];

export default function ChatModTab() {
  const [channel, setChannel] = useState("general");
  const [messages, setMessages] = useState([]);
  const [mutes, setMutes] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [loadingMutes, setLoadingMutes] = useState(true);
  const [confirm, confirmModal] = useConfirm();

  // Manual mute form
  const [muteEmail, setMuteEmail] = useState("");
  const [muteChannel, setMuteChannel] = useState("general");
  const [muteMinutes, setMuteMinutes] = useState(60);
  const [muteReason, setMuteReason] = useState("");

  const refreshMessages = async (ch = channel) => {
    setLoadingMsgs(true);
    try {
      const r = await fetchAdminChatMessages(ch, 100);
      setMessages(r.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load messages.");
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  };

  const refreshMutes = async () => {
    setLoadingMutes(true);
    try {
      const r = await fetchAdminChatMutes();
      setMutes(r.items || []);
    } catch {
      setMutes([]);
    } finally {
      setLoadingMutes(false);
    }
  };

  useEffect(() => { refreshMessages(channel); /* eslint-disable-next-line */ }, [channel]);
  useEffect(() => { refreshMutes(); }, []);

  const onDelete = async (id) => {
    const ok = await confirm({
      title: "Delete this message?",
      body: "The message disappears for everyone immediately. This cannot be undone.",
      confirmLabel: "Delete message",
      tone: "danger",
      testId: `confirm-delete-chat-${id}`,
    });
    if (!ok) return;
    try {
      await adminChatDeleteMessage(id);
      toast.success("Message deleted.");
      setMessages((arr) => arr.filter((m) => m.id !== id));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed.");
    }
  };

  const quickMute = async (email, ch, minutes, reason) => {
    try {
      await adminChatMute({
        user_email: email, channel: ch,
        minutes: minutes || null,
        reason: reason || `muted from #${ch}`,
      });
      toast.success(`${email} muted in #${ch}${minutes ? ` for ${minutes}m` : " indefinitely"}.`);
      await refreshMutes();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Mute failed.");
    }
  };

  const onUnmute = async (email, ch) => {
    try {
      await adminChatUnmute(email, ch);
      toast.success(`${email} unmuted in #${ch}.`);
      await refreshMutes();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Unmute failed.");
    }
  };

  const submitManualMute = async (e) => {
    e.preventDefault();
    if (!muteEmail.includes("@")) {
      toast.error("Enter a valid email.");
      return;
    }
    await quickMute(muteEmail.trim().toLowerCase(), muteChannel, muteMinutes, muteReason);
    setMuteEmail(""); setMuteReason("");
  };

  return (
    <div className="space-y-8" data-testid="chat-mod-tab">
      {confirmModal}
      {/* Channel selector */}
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
          ◆ Per-channel moderation
        </div>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`font-mono text-[11px] uppercase tracking-[0.22em] px-4 py-2 border transition ${
                channel === c
                  ? "bg-[#ff4500] text-[#0a0a0a] border-[#ff4500]"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]"
              }`}
              data-testid={`chatmod-channel-${c}`}
            >
              #{c}
            </button>
          ))}
        </div>
      </div>

      {/* Recent messages */}
      <div className="border border-[#262626]" data-testid="chatmod-messages">
        <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Recent messages · #{channel}
          </div>
          <button
            onClick={() => refreshMessages()}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
            data-testid="chatmod-refresh"
          >
            ↻ Refresh
          </button>
        </div>

        {loadingMsgs ? (
          <div className="p-4"><RowsSkeleton count={5} /></div>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            eyebrow={`◆ #${channel}`}
            title="Nothing to moderate."
            body="No recent messages in this channel."
          />
        ) : (
          <div className="divide-y divide-[#262626]">
            {messages.map((m) => (
              <div key={m.id} className="p-4 grid grid-cols-1 md:grid-cols-[180px_1fr_240px] gap-3" data-testid={`chatmod-row-${m.id}`}>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
                    {(m.created_at || "").slice(0, 16).replace("T", " ")}
                  </div>
                  <div className="font-mono text-[11px] text-[#a3a3a3] mt-1 truncate">
                    {m.user_name || "anon"}
                  </div>
                  <div className="font-mono text-[10px] text-[#525252] truncate">{m.user_email}</div>
                </div>
                <div className="font-mono text-xs text-[#e5e5e5] break-words">{m.text}</div>
                <div className="flex flex-wrap gap-2 self-start justify-end">
                  <button
                    onClick={() => onDelete(m.id)}
                    className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-300"
                    data-testid={`chatmod-delete-${m.id}`}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                  <button
                    onClick={() => quickMute(m.user_email, m.channel || channel, 60, "from message")}
                    className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400 hover:text-amber-300"
                    data-testid={`chatmod-mute-${m.id}`}
                  >
                    <MicOff size={12} /> Mute 1h
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual mute form */}
      <form
        onSubmit={submitManualMute}
        className="border border-[#262626] p-4 md:p-5 grid md:grid-cols-[1fr_1fr_180px_auto] gap-3 items-end"
        data-testid="chatmod-mute-form"
      >
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">User email</span>
          <input
            type="email" value={muteEmail} onChange={(e) => setMuteEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid="chatmod-mute-email"
          />
        </label>
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">Channel</span>
          <select
            value={muteChannel} onChange={(e) => setMuteChannel(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid="chatmod-mute-channel"
          >
            {CHANNELS.map((c) => <option key={c} value={c}>{`#${c}`}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">Duration</span>
          <select
            value={muteMinutes ?? ""}
            onChange={(e) => setMuteMinutes(e.target.value === "" ? null : parseInt(e.target.value, 10))}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid="chatmod-mute-duration"
          >
            {MUTE_PRESETS.map((p) => (
              <option key={p.label} value={p.minutes ?? ""}>{p.label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-industrial btn-primary" data-testid="chatmod-mute-submit">
          Mute
        </button>
        <label className="md:col-span-4">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">Reason (optional)</span>
          <input
            value={muteReason} onChange={(e) => setMuteReason(e.target.value)}
            placeholder="Showed up to a knife fight; spam; flame war"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid="chatmod-mute-reason"
          />
        </label>
      </form>

      {/* Active mutes */}
      <div className="border border-[#262626]" data-testid="chatmod-mutes">
        <div className="px-4 py-3 border-b border-[#262626] font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          Active mutes ({mutes.length})
        </div>
        {loadingMutes ? (
          <div className="p-4"><RowsSkeleton count={3} /></div>
        ) : mutes.length === 0 ? (
          <EmptyState
            icon={Volume2}
            eyebrow="◆ Quiet on the floor"
            title="Nobody's muted."
            body="When you mute a user from a channel, they'll show up here so you can lift it."
          />
        ) : (
          <div className="divide-y divide-[#262626]">
            {mutes.map((m) => (
              <div key={`${m.user_email}-${m.channel}`} className="p-4 grid grid-cols-1 md:grid-cols-[1fr_140px_1fr_140px] gap-3 items-center" data-testid={`chatmod-mute-row-${m.user_email}-${m.channel}`}>
                <div className="font-mono text-xs text-[#e5e5e5]">{m.user_email}</div>
                <div className="font-mono text-[11px] text-[#a3a3a3]">#{m.channel}</div>
                <div className="font-mono text-[10px] text-[#525252]">
                  {m.expires_at
                    ? `until ${new Date(m.expires_at).toLocaleString()}`
                    : "indefinite"}
                  {m.reason && <span className="block italic">"{m.reason}"</span>}
                </div>
                <button
                  onClick={() => onUnmute(m.user_email, m.channel)}
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400 hover:text-emerald-300 text-right"
                  data-testid={`chatmod-unmute-${m.user_email}-${m.channel}`}
                >
                  ✓ Unmute
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
