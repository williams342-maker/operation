import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  quoteCustomOrder, pushBriefToMaker, pushBriefToReddit,
  fetchRedditFeedStatus, fetchMakers, fetchBriefMakerSuggestions, http,
} from "../../lib/api";
import { adminAuthHeaders } from "../../lib/api"; // eslint-disable-line no-unused-vars
import { formatDate } from "./_shared";
import Barcode from "../Barcode";

export default function CustomOrdersList({ items, onChange }) {
  const [makers, setMakers] = useState([]);
  const [reddit, setReddit] = useState({ configured: false, can_post: false, subreddits: [] });
  const [funnel, setFunnel] = useState(null);

  const reloadFunnel = () => {
    const tok = localStorage.getItem("cm_admin_jwt");
    if (!tok) return;
    http.get("/admin/custom-orders/funnel", { headers: { Authorization: `Bearer ${tok}` } })
      .then((r) => setFunnel(r.data))
      .catch(() => {});
  };

  useEffect(() => {
    fetchMakers().then(setMakers).catch(() => {});
    fetchRedditFeedStatus().then(setReddit).catch(() => {});
    reloadFunnel();
    // Light polling — refreshes the analytics card every 60s without
    // forcing the admin to manually reload after a maker flips won_bid.
    const t = setInterval(reloadFunnel, 60_000);
    return () => clearInterval(t);
  }, [items]);

  return (
    <div className="space-y-6">
      {funnel && <FunnelCard funnel={funnel} />}
      {!items.length ? (
        <p className="font-mono text-sm text-ink-muted" data-testid="custom-empty">
          No custom briefs yet.
        </p>
      ) : (
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
      )}
    </div>
  );
}

function FunnelCard({ funnel }) {
  const s = funnel.stages || {};
  const pct = (n) => `${Math.round((n || 0) * 100)}%`;
  return (
    <div className="border border-line p-4 md:p-5" data-testid="brief-funnel-card">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          ◆ Brief routing funnel
        </div>
        <div className="flex gap-3 font-mono text-[10px] uppercase tracking-[0.22em]">
          <span className="text-ink-muted">
            Win-rate <b className="text-brand">{pct(funnel.win_rate)}</b>
          </span>
          <span className="text-ink-muted">
            Reddit-rate <b className="text-brand">{pct(funnel.reddit_post_rate)}</b>
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <FunnelStat label="Submitted" value={s.submitted} />
        <FunnelStat label="Quoted" value={s.quoted} />
        <FunnelStat label="Routed" value={s.routed} accent />
        <FunnelStat label="Accepted" value={s.accepted} />
        <FunnelStat label="On Reddit" value={s.posted_to_reddit} />
        <FunnelStat label="Won" value={s.won_bid} highlight />
        <FunnelStat label="Completed" value={s.completed} />
        <FunnelStat label="Declined" value={s.declined} />
      </div>
      {(funnel.by_subreddit?.length || funnel.by_maker?.length) ? (
        <div className="mt-4 pt-4 border-t border-line grid md:grid-cols-2 gap-4">
          {funnel.by_subreddit?.length > 0 && (
            <div data-testid="funnel-by-subreddit">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                By subreddit
              </div>
              <ul className="space-y-1 font-mono text-xs text-ink">
                {funnel.by_subreddit.slice(0, 5).map((r) => (
                  <li key={r.subreddit} className="flex justify-between gap-3">
                    <span>r/{r.subreddit}</span>
                    <span className="text-ink-muted">{r.posted} posted · {r.won} won · <b className="text-brand">{pct(r.win_rate)}</b></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {funnel.by_maker?.length > 0 && (
            <div data-testid="funnel-by-maker">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                By maker
              </div>
              <ul className="space-y-1 font-mono text-xs text-ink">
                {funnel.by_maker.slice(0, 5).map((r) => (
                  <li key={r.maker_slug} className="flex justify-between gap-3">
                    <span>{r.maker_slug}</span>
                    <span className="text-ink-muted">{r.routed} routed · {r.won} won · <b className="text-brand">{pct(r.win_rate)}</b></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FunnelStat({ label, value, accent, highlight }) {
  return (
    <div className={`px-3 py-2 border ${highlight ? "border-yellow-400/40 bg-yellow-400/5" : accent ? "border-cyan-400/40 bg-cyan-400/5" : "border-line"}`}>
      <div className="font-display text-2xl">{value || 0}</div>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">{label}</div>
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
  const [suggestions, setSuggestions] = useState([]);

  // Load top-N maker suggestions for this brief on first render.
  // Skips re-fetching if the brief is already assigned (not useful then).
  useEffect(() => {
    if (order.assigned_maker_slug) return;
    fetchBriefMakerSuggestions(order.id)
      .then((d) => setSuggestions(d.suggestions || []))
      .catch(() => {});
  }, [order.id, order.assigned_maker_slug]);

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
  let statusColor = "text-brand";
  if (order.status === "quoted") {
    statusLabel = `Quoted · $${order.quote}`;
    statusColor = "text-emerald-700";
  } else if (isAssigned) {
    statusLabel = `Assigned → ${order.assigned_maker_name || order.assigned_maker_slug}`;
    statusColor = "text-brand";
  }

  return (
    <div
      className="border border-line hover:border-brand transition p-5"
      data-testid={`custom-${order.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-line">
        <div>
          <div className={`font-mono text-[10px] uppercase tracking-[0.22em] ${statusColor}`}>
            ◆ {statusLabel} · {formatDate(order.created_at)}
          </div>
          <div className="font-display text-2xl mt-1">{order.project_type}</div>
          <div className="font-mono text-xs text-ink-muted mt-1">
            {order.name} ·{" "}
            <a href={`mailto:${order.email}`} className="underline hover:text-brand">
              {order.email}
            </a>{" "}
            {order.phone ? `· ${order.phone}` : ""}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-2">
            {order.material} · {order.size || "size n/a"} · {order.budget || "budget n/a"}
          </div>
        </div>
        <div className="flex flex-col gap-2 items-start md:items-end">
          {order.tracking_number && (
            <div className="border border-line px-3 py-2 bg-paper" title={`Tracking #${order.tracking_number}`}>
              <Barcode
                value={order.tracking_number}
                height={32}
                width={1.4}
                fontSize={10}
                testId={`brief-barcode-${order.id}`}
              />
            </div>
          )}
          {isAssigned && makerStatus && (
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border border-line"
                  data-testid={`brief-maker-status-${order.id}`}>
              Maker: {makerStatus}
            </span>
          )}
          {isOnReddit && (
            <a
              href={order.reddit_post_url || "#"}
              target="_blank" rel="noopener noreferrer"
              className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border border-orange-500/50 text-brand hover:bg-orange-500/10"
              data-testid={`brief-reddit-link-${order.id}`}
            >
              ↗ r/{order.reddit_subreddit}
            </a>
          )}
        </div>
      </div>
      <p className="font-mono text-xs text-ink leading-relaxed mt-3">{order.description}</p>

      {/* ───── Step 1: Quote (existing) ───── */}
      <div className="mt-5 pt-5 border-t border-line">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
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
            className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
            data-testid={`custom-quote-${order.id}`}
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Optional message to buyer"
            className="md:col-span-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
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
      <div className="mt-5 pt-5 border-t border-line" data-testid={`brief-maker-section-${order.id}`}>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
          Step 2 · Route to a maker
        </div>
        {suggestions.length > 0 && !order.assigned_maker_slug && (
          <div className="mb-3 pb-3 border-b border-line" data-testid={`brief-suggestions-${order.id}`}>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2 flex items-center justify-between gap-2">
              <span>✨ Suggested matches</span>
              <button
                type="button"
                onClick={async () => {
                  const top = suggestions[0];
                  setBusy("autoroute"); setErr("");
                  try {
                    const r = await pushBriefToMaker(order.id, {
                      maker_slug: top.slug,
                      note: `Routed to you because: ${top.reason}.`,
                      notify_buyer: notifyBuyer,
                    });
                    toast.success(`Auto-routed to ${top.name} · ${top.reason}.`);
                    setMakerSlug(top.slug);
                    setAdminNote("");
                    void r;
                    await onChange();
                  } catch (e) {
                    const detail = e?.response?.data?.detail || "Failed to auto-route.";
                    setErr(detail);
                    toast.error(detail);
                  } finally { setBusy(""); }
                }}
                disabled={busy === "autoroute"}
                className="px-2.5 py-1 border border-yellow-400/60 text-brand hover:bg-yellow-400/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                data-testid={`brief-autoroute-${order.id}`}
                title={`One-click route to ${suggestions[0].name} (top match: ${suggestions[0].reason})`}
              >
                {busy === "autoroute" ? "Routing…" : "★ Route to top →"}
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {suggestions.slice(0, 5).map((s, i) => (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => setMakerSlug(s.slug)}
                  className={`text-left px-3 py-2 border transition font-mono text-xs hover:border-yellow-400 ${
                    makerSlug === s.slug
                      ? "border-yellow-400 bg-yellow-400/5"
                      : "border-line"
                  }`}
                  data-testid={`brief-suggestion-${order.id}-${i}`}
                  title={s.reason}
                >
                  <div className="text-ink">
                    {i === 0 && <span className="text-brand mr-1">★</span>}
                    {s.name}
                  </div>
                  <div className="text-[10px] text-ink-muted mt-0.5">{s.reason}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-3 items-start">
          <select
            value={makerSlug}
            onChange={(e) => setMakerSlug(e.target.value)}
            className="bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
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
            className="md:col-span-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
            data-testid={`brief-admin-note-${order.id}`}
          />
        </div>
        <label className="inline-flex items-center gap-2 mt-3 font-mono text-[11px] text-ink-muted">
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
      <div className="mt-5 pt-5 border-t border-line" data-testid={`brief-reddit-section-${order.id}`}>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
          Step 3 · Broadcast on Reddit {isOnReddit && <span className="text-emerald-700 ml-2">✓ posted</span>}
        </div>
        {!reddit.can_post ? (
          <p className="font-mono text-[11px] text-ink-muted" data-testid={`brief-reddit-disabled-${order.id}`}>
            Reddit posting needs <code className="text-brand">REDDIT_USERNAME</code> +{" "}
            <code className="text-brand">REDDIT_PASSWORD</code> in backend env. Once added,
            this section activates and posts a self-text brief to the chosen sub.
          </p>
        ) : (
          <div className="grid md:grid-cols-3 gap-3 items-start">
            <select
              value={redditSub}
              onChange={(e) => setRedditSub(e.target.value)}
              disabled={isOnReddit}
              className="bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink disabled:opacity-50"
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

      {/* iter413ax — Admin lifecycle actions on the brief. */}
      <BriefAdminActions order={order} onChange={onChange} />
    </div>
  );
}


// iter413ax — Compact action bar with Email Client / Email Maker /
// Archive / Purge. Each action confirms via toast, then re-fetches the
// parent list so the row updates without a full page reload.
function BriefAdminActions({ order, onChange }) {
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(null); // 'client' | 'maker' | null
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const tok = typeof window !== "undefined" ? localStorage.getItem("cm_admin_jwt") : null;
  const H = tok ? { Authorization: `Bearer ${tok}` } : {};

  const refresh = () => { if (typeof onChange === "function") onChange(); };

  const doArchive = async () => {
    if (!window.confirm("Archive this brief? It will be hidden from the default list (reversible).")) return;
    setBusy(true);
    try {
      await http.post(`/admin/custom-orders/${order.id}/archive`, {}, { headers: H });
      toast.success("Brief archived");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Archive failed");
    } finally { setBusy(false); }
  };

  const doPurge = async () => {
    if (!window.confirm("Permanently delete this brief and its bids? This cannot be undone.")) return;
    setBusy(true);
    try {
      await http.delete(`/admin/custom-orders/${order.id}`, { headers: H });
      toast.success("Brief purged");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Purge failed");
    } finally { setBusy(false); }
  };

  const doSendEmail = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Subject and message both required");
      return;
    }
    setBusy(true);
    try {
      await http.post(
        `/admin/custom-orders/${order.id}/email`,
        { target: composing, subject: subject.trim(), message: message.trim() },
        { headers: H },
      );
      toast.success(`Email sent to ${composing}`);
      setComposing(null);
      setSubject("");
      setMessage("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Email failed");
    } finally { setBusy(false); }
  };

  return (
    <div
      className="mt-4 pt-3 border-t border-line flex flex-wrap items-center gap-2"
      data-testid={`brief-admin-actions-${order.id}`}
    >
      <button
        className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border border-line text-ink hover:text-brand hover:border-brand transition-colors disabled:opacity-40"
        onClick={() => setComposing("client")}
        disabled={busy || !order.email}
        data-testid={`brief-email-client-${order.id}`}
      >
        ✉ Email client
      </button>
      <button
        className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border border-line text-ink hover:text-brand hover:border-brand transition-colors disabled:opacity-40"
        onClick={() => setComposing("maker")}
        disabled={busy || !order.maker_email}
        title={!order.maker_email ? "Push to maker first" : ""}
        data-testid={`brief-email-maker-${order.id}`}
      >
        ✉ Email maker
      </button>
      <button
        className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border border-line text-ink-muted hover:text-warn hover:border-warn transition-colors disabled:opacity-40"
        onClick={doArchive}
        disabled={busy}
        data-testid={`brief-archive-${order.id}`}
      >
        Archive
      </button>
      <button
        className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border border-line text-ink-muted hover:text-danger hover:border-danger transition-colors disabled:opacity-40"
        onClick={doPurge}
        disabled={busy}
        data-testid={`brief-purge-${order.id}`}
      >
        Purge
      </button>

      {composing && (
        <div className="w-full mt-3 p-3 border border-line bg-canvas-tint space-y-2"
             data-testid={`brief-email-compose-${order.id}`}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            New email · to {composing} ({composing === "client" ? order.email : order.maker_email})
          </p>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full px-2 py-1.5 bg-canvas border border-line text-ink text-sm font-mono"
            data-testid={`brief-email-subject-${order.id}`}
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message body — plain text, line breaks preserved."
            rows={4}
            className="w-full px-2 py-1.5 bg-canvas border border-line text-ink text-sm font-mono"
            data-testid={`brief-email-message-${order.id}`}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={doSendEmail}
              disabled={busy}
              className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 bg-brand text-canvas hover:opacity-80 transition disabled:opacity-40"
              data-testid={`brief-email-send-${order.id}`}
            >
              {busy ? "Sending…" : "Send"}
            </button>
            <button
              onClick={() => { setComposing(null); setSubject(""); setMessage(""); }}
              disabled={busy}
              className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border border-line text-ink-muted hover:text-ink transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
