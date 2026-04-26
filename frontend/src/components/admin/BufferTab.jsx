import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchBufferStatus, fetchBufferPosts, adminBufferPost,
} from "../../lib/api";
import { Stat } from "./_shared";

const SERVICE_TONE = {
  instagram: "border-pink-700/50 text-pink-300",
  facebook: "border-blue-700/50 text-blue-300",
  pinterest: "border-red-700/50 text-red-300",
  twitter: "border-sky-700/50 text-sky-300",
  linkedin: "border-blue-700/50 text-blue-300",
  threads: "border-zinc-700/50 text-zinc-300",
  tiktok: "border-fuchsia-700/50 text-fuchsia-300",
  bluesky: "border-cyan-700/50 text-cyan-300",
  mastodon: "border-purple-700/50 text-purple-300",
};

function ChannelChip({ ch, selected, onClick }) {
  const tone = SERVICE_TONE[ch.service] || "border-[#262626] text-[#a3a3a3]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 border font-mono text-[11px] uppercase tracking-[0.18em] transition ${
        selected ? `bg-[#ff4500] text-[#0a0a0a] border-[#ff4500]` : `${tone} hover:border-[#ff4500]`
      }`}
      data-testid={`buffer-channel-${ch.service}`}
    >
      {ch.service} · {ch.name}
    </button>
  );
}

function ResultBadge({ r }) {
  if (r.success) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400">
        ✓ {r.service || "sent"}
      </span>
    );
  }
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400"
      title={r.error}
    >
      ✗ {r.service || "fail"}
    </span>
  );
}

export default function BufferTab() {
  const [status, setStatus] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [selected, setSelected] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const channels = status?.channels || [];

  const load = async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([fetchBufferStatus(), fetchBufferPosts(50)]);
      setStatus(s);
      setPosts(p.items || []);
      // Auto-select all channels by default for fan-out posting
      if (s.channels?.length && selected.length === 0) {
        setSelected(s.channels.map((c) => c.id));
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load Buffer status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const totals = useMemo(() => {
    let sent = 0, failed = 0;
    for (const p of posts) {
      sent += p.success_count || 0;
      failed += p.failed_count || 0;
    }
    return { sent, failed, posts: posts.length };
  }, [posts]);

  const toggleChannel = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) {
      toast.error("Add some text first.");
      return;
    }
    if (!selected.length) {
      toast.error("Pick at least one channel.");
      return;
    }
    setSubmitting(true);
    try {
      const row = await adminBufferPost({
        text: text.trim(),
        channel_ids: selected,
        image_url: imageUrl.trim() || null,
        mode: "addToQueue",
      });
      const ok = row.success_count || 0;
      const bad = row.failed_count || 0;
      if (bad === 0) {
        toast.success(`Queued on ${ok} channel${ok === 1 ? "" : "s"}.`);
      } else {
        toast.warning(`Queued on ${ok}/${ok + bad} channels — see log for failures.`);
      }
      setText("");
      setImageUrl("");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Post failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#525252] py-12 text-center" data-testid="buffer-tab-loading">
        ◆ Loading Buffer…
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="buffer-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-6">
        <Stat label="Channels" value={channels.length} testId="buffer-stat-channels" />
        <Stat label="Recent Posts" value={totals.posts} testId="buffer-stat-posts" />
        <Stat label="Channel Sends OK" value={totals.sent} testId="buffer-stat-sent" />
        <Stat label="Channel Sends Failed" value={totals.failed} testId="buffer-stat-failed" />
      </div>

      {!status?.enabled && (
        <div className="border border-amber-400/40 bg-amber-400/5 p-4 font-mono text-xs text-amber-300" data-testid="buffer-disabled">
          Buffer is not configured. Set <code>BUFFER_API_KEY</code> and <code>BUFFER_ORG_ID</code> in <code>backend/.env</code>.
          {status?.reason && <span className="block mt-2 text-amber-200/70">→ {status.reason}</span>}
        </div>
      )}

      {status?.enabled && (
        <>
          <div className="border border-[#262626]">
            <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Connected channels
              </div>
              <span
                className={`font-mono text-[10px] uppercase tracking-[0.22em] ${
                  status.auto_publish ? "text-emerald-400" : "text-[#525252]"
                }`}
                data-testid="buffer-auto-publish"
              >
                ◆ Auto-post on listing publish: {status.auto_publish ? "ON" : "OFF"}
              </span>
            </div>
            <div className="p-4 flex flex-wrap gap-2">
              {channels.length === 0 && (
                <span className="font-mono text-[11px] text-[#525252]">
                  No channels connected. Add one in publish.buffer.com.
                </span>
              )}
              {channels.map((c) => (
                <ChannelChip
                  key={c.id}
                  ch={c}
                  selected={selected.includes(c.id)}
                  onClick={() => toggleChannel(c.id)}
                />
              ))}
            </div>
          </div>

          <form onSubmit={submit} className="border border-[#262626] p-4 space-y-3" data-testid="buffer-composer">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              Compose post
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="What's the story? Drop a link, tag the maker, ship the post."
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
              data-testid="buffer-text-input"
            />
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Optional image URL (required for Pinterest)"
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
              data-testid="buffer-image-input"
            />
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || !selected.length}
                className="btn-industrial btn-primary disabled:opacity-50 text-xs"
                data-testid="buffer-submit"
              >
                {submitting ? "Queueing…" : `Queue on ${selected.length} channel${selected.length === 1 ? "" : "s"}`}
              </button>
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
                Mode: addToQueue (next available slot per channel)
              </span>
            </div>
          </form>

          <div className="border border-[#262626]" data-testid="buffer-log">
            <div className="px-4 py-3 border-b border-[#262626] font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              Recent posts ({posts.length})
            </div>
            {posts.length === 0 ? (
              <div className="p-6 text-center font-mono text-[11px] text-[#525252]">
                Nothing queued yet. Compose your first post above.
              </div>
            ) : (
              <div className="divide-y divide-[#262626]">
                {posts.map((p) => (
                  <div key={p.id} className="p-4 grid grid-cols-1 md:grid-cols-[120px_1fr_180px] gap-3" data-testid={`buffer-row-${p.id}`}>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
                        {new Date(p.created_at).toLocaleString()}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] mt-1 text-[#a3a3a3]">
                        {p.source}{p.product_slug ? ` · ${p.product_slug}` : ""}
                      </div>
                    </div>
                    <div className="font-mono text-xs text-[#e5e5e5] break-words">
                      {p.text}
                      {p.image_url && (
                        <a href={p.image_url} target="_blank" rel="noreferrer" className="block mt-1 text-[10px] text-[#525252] hover:text-[#ff4500] truncate">
                          🖼 {p.image_url}
                        </a>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 self-start">
                      {(p.results || []).map((r, i) => (
                        <ResultBadge key={i} r={r} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
