import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  quoteCustomOrder, pushBriefToMaker, pushBriefToReddit,
  fetchRedditFeedStatus, fetchMakers,
} from "../../lib/api";
import { formatDate } from "./_shared";

export default function CustomOrdersList({ items, onChange }) {
  const [makers, setMakers] = useState([]);
  const [reddit, setReddit] = useState({ configured: false, can_post: false, subreddits: [] });

  useEffect(() => {
    fetchMakers().then(setMakers).catch(() => {});
    fetchRedditFeedStatus().then(setReddit).catch(() => {});
  }, []);

  if (!items.length) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="custom-empty">
        No custom briefs yet.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="custom-list">
      {items.map((c) => (
        <CustomOrderRow
          key={c.id}
          order={c}
          makers={makers}
          reddit={reddit}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function CustomOrderRow({ order, makers, reddit, onChange }) {
  const [quote, setQuote] = useState(order.quote || "");
  const [message, setMessage] = useState(order.quote_note || "");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const [makerSlug, setMakerSlug] = useState(order.assigned_maker_slug || "");
  const [adminNote, setAdminNote] = useState("");
  const [notifyBuyer, setNotifyBuyer] = useState(true);
  const [redditSub, setRedditSub] = useState(
    (reddit.subreddits && reddit.subreddits[0]) || "forhire",
  );

  const submitQuote = async () => {
    if (!quote || isNaN(Number(quote))) return;
    setBusy("quote"); setErr("");
    try {
      await quoteCustomOrder(order.id, { quote: Number(quote), message });
      await onChange();
      toast.success("Quote sent to buyer.");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to send quote.");
    } finally { setBusy(""); }
  };

  const handlePushToMaker = async () => {
    if (!makerSlug) {
      setErr("Pick a maker first.");
      return;
    }
    setBusy("maker"); setErr("");
    try {
      const r = await pushBriefToMaker(order.id, {
        maker_slug: makerSlug,
        note: adminNote || undefined,
        notify_buyer: notifyBuyer,
      });
      toast.success(`Brief routed to ${makerSlug}. Thread #${r.thread_id.slice(0, 8)}.`);
      setAdminNote("");
      await onChange();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Failed to push to maker.";
      setErr(detail);
      toast.error(detail);
    } finally { setBusy(""); }
  };

  const handlePushToReddit = async () => {
    if (!order.assigned_maker_slug) {
      setErr("Push to a maker first — Reddit posts need a fulfilment plan.");
      return;
    }
    setBusy("reddit"); setErr("");
    try {
      const r = await pushBriefToReddit(order.id, { subreddit: redditSub });
      toast.success(`Posted to r/${redditSub}.`);
      if (r.url) window.open(r.url, "_blank", "noopener");
      await onChange();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Failed to post to Reddit.";
      setErr(detail);
      toast.error(detail);
    } finally { setBusy(""); }
  };

  const isAssigned = !!order.assigned_maker_slug;
  const isOnReddit = !!order.posted_to_reddit_at;
  const makerStatus = order.maker_response_status;

  // Determine top-of-card status pill
  let statusLabel = "Open";
  let statusColor = "text-[#ff4500]";
  if (order.status === "quoted") {
    statusLabel = `Quoted · $${order.quote}`;
    statusColor = "text-emerald-400";
  } else if (isAssigned) {
    statusLabel = `Assigned → ${order.assigned_maker_name || order.assigned_maker_slug}`;
    statusColor = "text-cyan-400";
  }

  return (
    <div
      className="border border-[#262626] hover:border-[#ff4500] transition p-5"
      data-testid={`custom-${order.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-[#262626]">
        <div>
          <div className={`font-mono text-[10px] uppercase tracking-[0.22em] ${statusColor}`}>
            ◆ {statusLabel} · {formatDate(order.created_at)}
          </div>
          <div className="font-display text-2xl mt-1">{order.project_type}</div>
          <div className="font-mono text-xs text-[#a3a3a3] mt-1">
            {order.name} ·{" "}
            <a href={`mailto:${order.email}`} className="underline hover:text-[#ff4500]">
              {order.email}
            </a>{" "}
            {order.phone ? `· ${order.phone}` : ""}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-2">
            {order.material} · {order.size || "size n/a"} · {order.budget || "budget n/a"}
          </div>
        </div>
        <div className="flex flex-col gap-1 items-end">
          {isAssigned && makerStatus && (
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border border-[#262626]"
                  data-testid={`brief-maker-status-${order.id}`}>
              Maker: {makerStatus}
            </span>
          )}
          {isOnReddit && (
            <a
              href={order.reddit_post_url || "#"}
              target="_blank" rel="noopener noreferrer"
              className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
              data-testid={`brief-reddit-link-${order.id}`}
            >
              ↗ r/{order.reddit_subreddit}
            </a>
          )}
        </div>
      </div>
      <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-3">{order.description}</p>

      {/* ───── Step 1: Quote (existing) ───── */}
      <div className="mt-5 pt-5 border-t border-[#1a1a1a]">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
          Step 1 · Quote the buyer
        </div>
        <div className="grid md:grid-cols-3 gap-3 items-start">
          <input
            type="number"
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            placeholder="Quote ($)"
            min="0"
            step="0.01"
            className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`custom-quote-${order.id}`}
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Optional message to buyer"
            className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`custom-msg-${order.id}`}
          />
        </div>
        <button
          onClick={submitQuote}
          disabled={busy === "quote" || !quote}
          className="btn-industrial btn-primary mt-3 disabled:opacity-50"
          data-testid={`custom-send-quote-${order.id}`}
        >
          {busy === "quote" ? "Sending…" : order.status === "quoted" ? "Re-Send Quote" : "Send Quote"}
        </button>
      </div>

      {/* ───── Step 2: Push to Maker ───── */}
      <div className="mt-5 pt-5 border-t border-[#1a1a1a]" data-testid={`brief-maker-section-${order.id}`}>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
          Step 2 · Route to a maker
        </div>
        <div className="grid md:grid-cols-3 gap-3 items-start">
          <select
            value={makerSlug}
            onChange={(e) => setMakerSlug(e.target.value)}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`brief-maker-select-${order.id}`}
          >
            <option value="">Pick a maker…</option>
            {makers.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name || m.slug} · {m.location || "—"}
              </option>
            ))}
          </select>
          <textarea
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            rows={2}
            placeholder="Note to the maker (optional)"
            className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`brief-admin-note-${order.id}`}
          />
        </div>
        <label className="inline-flex items-center gap-2 mt-3 font-mono text-[11px] text-[#a3a3a3]">
          <input
            type="checkbox"
            checked={notifyBuyer}
            onChange={(e) => setNotifyBuyer(e.target.checked)}
            data-testid={`brief-notify-buyer-${order.id}`}
          />
          Email buyer that we routed their brief
        </label>
        <div className="mt-3 flex gap-2 flex-wrap">
          <button
            onClick={handlePushToMaker}
            disabled={busy === "maker" || !makerSlug}
            className="btn-industrial btn-primary disabled:opacity-50"
            data-testid={`brief-push-maker-${order.id}`}
          >
            {busy === "maker"
              ? "Routing…"
              : isAssigned ? "Re-route to a different maker" : "Push to maker →"}
          </button>
        </div>
      </div>

      {/* ───── Step 3: Push to Reddit ───── */}
      <div className="mt-5 pt-5 border-t border-[#1a1a1a]" data-testid={`brief-reddit-section-${order.id}`}>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
          Step 3 · Broadcast on Reddit {isOnReddit && <span className="text-emerald-400 ml-2">✓ posted</span>}
        </div>
        {!reddit.can_post ? (
          <p className="font-mono text-[11px] text-[#a3a3a3]" data-testid={`brief-reddit-disabled-${order.id}`}>
            Reddit posting needs <code className="text-[#ff4500]">REDDIT_USERNAME</code> +{" "}
            <code className="text-[#ff4500]">REDDIT_PASSWORD</code> in backend env. Once added,
            this section activates and posts a self-text brief to the chosen sub.
          </p>
        ) : (
          <div className="grid md:grid-cols-3 gap-3 items-start">
            <select
              value={redditSub}
              onChange={(e) => setRedditSub(e.target.value)}
              disabled={isOnReddit}
              className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5] disabled:opacity-50"
              data-testid={`brief-reddit-sub-${order.id}`}
            >
              {reddit.subreddits.map((s) => (
                <option key={s} value={s}>r/{s}</option>
              ))}
            </select>
            <button
              onClick={handlePushToReddit}
              disabled={busy === "reddit" || isOnReddit || !isAssigned}
              className="btn-industrial btn-primary md:col-span-2 disabled:opacity-50"
              data-testid={`brief-push-reddit-${order.id}`}
            >
              {busy === "reddit"
                ? "Posting…"
                : isOnReddit
                  ? "Already posted"
                  : !isAssigned
                    ? "Push to maker first"
                    : `Post to r/${redditSub} →`}
            </button>
          </div>
        )}
        {order.reddit_error && !isOnReddit && (
          <p className="font-mono text-[11px] text-red-400 mt-2" data-testid={`brief-reddit-error-${order.id}`}>
            Last attempt failed: {order.reddit_error}
          </p>
        )}
      </div>

      {err && (
        <p className="font-mono text-[11px] text-red-400 mt-3" data-testid={`brief-err-${order.id}`}>
          {err}
        </p>
      )}
    </div>
  );
}
