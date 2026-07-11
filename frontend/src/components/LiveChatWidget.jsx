import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchChatHistory, openChatSocket } from "../lib/api";
import { useSiteSettings } from "../hooks/useSiteSettings";

// Floating live-chat popup → community #help channel.
// Mounts globally so shoppers can chat from any page without leaving.
// Auto-hides when:
//  - admin disables `live_chat_enabled` site-setting
//  - the user is on /community (full chat page already there)
//  - the user is on /admin or /maker (operator console — irrelevant noise)
const STORAGE_OPEN = "cm_live_chat_open";
const STORAGE_DISMISSED = "cm_live_chat_dismissed_at";
const DISMISS_DAYS = 3;
const CHANNELS = [
  { id: "help",     label: "#help" },
  { id: "general",  label: "#general" },
  { id: "showcase", label: "#showcase" },
];

function getToken() {
  return (
    localStorage.getItem("cm_buyer_jwt") ||
    localStorage.getItem("cm_maker_jwt") ||
    localStorage.getItem("cm_admin_jwt") ||
    ""
  );
}

function recentlyDismissed() {
  try {
    const ts = parseInt(localStorage.getItem(STORAGE_DISMISSED) || "0", 10);
    return ts && Date.now() - ts < DISMISS_DAYS * 86400 * 1000;
  } catch {
    return false;
  }
}

// iter442 — hard isolation: a crash anywhere inside the chat widget renders
// nothing instead of unmounting the app tree. Checkout can never be taken
// down by chat.
class ChatErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* silent — chat is strictly optional */ }
  render() { return this.state.failed ? null : this.props.children; }
}

function LiveChatWidgetInner() {
  const settings = useSiteSettings();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(STORAGE_OPEN) === "1"; } catch { return false; }
  });
  const [channel, setChannel] = useState(() => {
    try {
      const saved = localStorage.getItem("cm_live_chat_channel");
      return CHANNELS.some((c) => c.id === saved) ? saved : "help";
    } catch { return "help"; }
  });
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [buddies, setBuddies] = useState([]);
  const wsRef = useRef(null);
  const scrollRef = useRef(null);

  const token = useMemo(() => getToken(), []);
  const enabled = !settings || settings.live_chat_enabled !== false;

  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const onChatPage = path.startsWith("/community") || path.startsWith("/admin") || path.startsWith("/maker");

  // Persist channel selection across sessions
  useEffect(() => {
    try { localStorage.setItem("cm_live_chat_channel", channel); } catch { /* ignore */ }
  }, [channel]);

  // Listen for cross-component "open me" requests (e.g. from AIAssistant
  // empty state CTA). Also clears the dismiss cooldown so the popup
  // honors the user's explicit click intent.
  useEffect(() => {
    const onOpenRequest = (e) => {
      try { localStorage.removeItem(STORAGE_DISMISSED); } catch { /* ignore */ }
      const wantedCh = e?.detail?.channel;
      if (wantedCh && CHANNELS.some((c) => c.id === wantedCh)) setChannel(wantedCh);
      setOpen(true);
    };
    window.addEventListener("cm:open-live-chat", onOpenRequest);
    return () => window.removeEventListener("cm:open-live-chat", onOpenRequest);
  }, []);

  // Open ↔ close persistence + clear unread when opened
  useEffect(() => {
    try { localStorage.setItem(STORAGE_OPEN, open ? "1" : "0"); } catch { /* ignore */ }
    if (open) setUnread(0);
  }, [open]);

  // Auto-scroll on new messages while open
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  // Connect WebSocket — reconnects when channel or token changes.
  // iter442 — auth is a short-lived single-use ticket fetched over an authed
  // POST (JWT never appears in the URL). Reconnects use exponential backoff
  // with jitter, give up after MAX_RETRIES, and never retry fatal closes
  // (bad auth 4401, forbidden 4403, unknown channel 4404, disabled 4503).
  useEffect(() => {
    if (!enabled || onChatPage || !token) return;
    let alive = true;
    let ws = null;
    let attempts = 0;
    let timer = null;
    const MAX_RETRIES = 8;
    const FATAL_CODES = [4401, 4403, 4404, 4503];

    setMessages([]);
    setBuddies([]);
    setConnected(false);
    setUnavailable(false);

    const scheduleRetry = () => {
      if (!alive) return;
      attempts += 1;
      if (attempts > MAX_RETRIES) {
        setUnavailable(true); // stop hammering the server — chat goes quiet, nothing else breaks
        return;
      }
      const base = Math.min(1000 * 2 ** attempts, 30000);
      const jitter = Math.random() * 0.3 * base;
      timer = setTimeout(connect, base + jitter);
    };

    const connect = async () => {
      if (!alive) return;
      let sock;
      try {
        sock = await openChatSocket(channel, token);
      } catch {
        scheduleRetry(); // ticket fetch failed (offline / expired session)
        return;
      }
      if (!alive) { try { sock.close(); } catch { /* ignore */ } return; }
      ws = sock;
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); setUnavailable(false); attempts = 0; };
      ws.onclose = (e) => {
        setConnected(false);
        if (!alive) return;
        if (FATAL_CODES.includes(e?.code)) { setUnavailable(true); return; }
        scheduleRetry();
      };
      ws.onerror = () => { /* close handler decides retry */ };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.kind === "presence" || (msg.kind === "system" && msg.buddies)) {
          setBuddies(msg.buddies || []);
          if (msg.kind === "presence") return;
        }
        if (msg.kind === "typing") return;
        setMessages((m) => [...m, msg]);
        if (msg.kind === "message") {
          // Only count unread when the panel is closed AND it's not our own.
          setOpen((isOpen) => {
            if (!isOpen) setUnread((u) => u + 1);
            return isOpen;
          });
        }
      };
    };

    // Backfill recent history before live socket joins so the panel isn't empty.
    fetchChatHistory(channel).then((hist) => {
      if (alive) setMessages(hist || []);
    }).catch(() => {});
    connect();

    return () => {
      alive = false;
      clearTimeout(timer);
      try { ws && ws.close(); } catch { /* ignore */ }
    };
  }, [enabled, onChatPage, token, channel]);

  if (!enabled || onChatPage) return null;
  if (!open && recentlyDismissed()) return null;

  const send = (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    const ws = wsRef.current;
    if (!text || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ text }));
    setDraft("");
  };

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_DISMISSED, String(Date.now())); } catch { /* ignore */ }
    setOpen(false);
  };

  // Floating launcher button (when collapsed)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="live-chat-launcher"
        aria-label="Open live chat"
        className="fixed bottom-6 left-6 z-[60] flex items-center gap-2 px-4 py-3 bg-paper border border-brand hover:bg-brand hover:text-[#0a0a0a] text-brand font-mono text-[11px] uppercase tracking-[0.22em] transition shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      >
        <span aria-hidden>◆</span>
        Live chat
        {unread > 0 && (
          <span
            data-testid="live-chat-unread"
            className="ml-1 px-1.5 py-0.5 bg-brand text-[#0a0a0a] text-[10px] leading-none font-bold"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    );
  }

  // Expanded panel
  return (
    <div
      data-testid="live-chat-panel"
      className="fixed bottom-6 left-6 z-[60] w-[min(92vw,360px)] h-[min(72vh,520px)] bg-paper border border-line flex flex-col shadow-[0_12px_36px_rgba(0,0,0,0.7)]"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
              ◆ Live chat
            </div>
            <div className="font-mono text-[10px] text-ink-muted mt-0.5">
              {connected
                ? `${buddies.length || 0} online`
                : unavailable
                  ? "Chat is offline right now"
                  : token ? "Connecting…" : "Sign in to join"}
            </div>
          </div>
          {token && (
            <Link
              to={`/community?channel=${channel}`}
              data-testid="live-chat-fullview"
              title="Open full chat view"
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition px-1"
            >
              Full view →
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Minimise chat"
            data-testid="live-chat-minimise"
            className="font-mono text-[18px] text-ink-muted hover:text-ink leading-none px-1"
            title="Minimise"
          >
            –
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Hide for 3 days"
            data-testid="live-chat-dismiss"
            className="font-mono text-[14px] text-ink-muted hover:text-rose-400 leading-none px-1"
            title="Hide for 3 days"
          >
            ×
          </button>
        </div>
        {token && (
          <div className="flex gap-1 mt-2" data-testid="live-chat-channel-tabs">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChannel(c.id)}
                data-testid={`live-chat-channel-${c.id}`}
                className={`flex-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] border transition ${
                  channel === c.id
                    ? "border-brand text-brand bg-brand/5"
                    : "border-line text-ink-muted hover:border-line hover:text-ink"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      {!token ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-3">
          <p className="font-mono text-xs text-ink-muted leading-relaxed">
            Sign in to chat with the workshop crew and other shoppers.
          </p>
          <Link
            to="/community/login"
            data-testid="live-chat-signin"
            className="px-3 py-2 border border-brand text-brand hover:bg-brand hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] transition"
          >
            Sign in →
          </Link>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
            data-testid="live-chat-messages"
          >
            {messages.length === 0 && (
              <div className="font-mono text-[10px] text-ink-muted text-center py-6">
                Be the first to say hi.
              </div>
            )}
            {messages
              .filter((m) => m.kind === "message" || m.kind === "system")
              .slice(-80)
              .map((m, i) => (
                <div
                  key={m.id || `${m.created_at}-${i}`}
                  className="font-mono text-xs leading-relaxed"
                  data-testid={`live-chat-msg-${i}`}
                >
                  {m.kind === "system" ? (
                    <div className="text-ink-muted italic">— {m.text} —</div>
                  ) : (
                    <div>
                      <span className="text-brand">{m.user_name || "anon"}</span>
                      <span className="text-ink-muted"> · </span>
                      <span className="text-ink">{m.text}</span>
                    </div>
                  )}
                </div>
              ))}
          </div>
          <form
            onSubmit={send}
            className="border-t border-line flex"
            data-testid="live-chat-form"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={connected ? "Type a message…" : unavailable ? "Chat is offline" : "Reconnecting…"}
              disabled={!connected}
              maxLength={500}
              data-testid="live-chat-input"
              className="flex-1 bg-transparent outline-none px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-muted disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!connected || !draft.trim()}
              data-testid="live-chat-send"
              className="px-3 font-mono text-[10px] uppercase tracking-[0.22em] text-brand hover:bg-brand hover:text-[#0a0a0a] transition border-l border-line disabled:opacity-30"
            >
              Send →
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default function LiveChatWidget() {
  return (
    <ChatErrorBoundary>
      <LiveChatWidgetInner />
    </ChatErrorBoundary>
  );
}
