import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send } from "lucide-react";
import { useLocation } from "react-router-dom";
import { aiChat, aiSubmitBrief } from "../lib/api";

const STARTER = {
  role: "assistant",
  text:
    "Hi — I'm the Crafters Market helper. I can answer product questions, walk you through " +
    "the marketplace, or capture a custom-order brief. What can I help with?",
};

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([STARTER]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const scrollRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await aiChat({
        message: text,
        session_id: sessionId,
        page_context: `User is on ${location.pathname}`,
      });
      setSessionId(res.session_id);
      setMessages((m) => [...m, { role: "assistant", text: res.reply }]);
      maybeOfferBriefSubmit(text, res.reply);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Hmm — I lost the connection. Try again in a moment." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // If the assistant says "sending this brief", we look for a buyer email + name in
  // the conversation and POST it to /api/ai/submit-brief.
  const maybeOfferBriefSubmit = async (lastUser, reply) => {
    if (!/sending this brief|send this brief|sending it to the team/i.test(reply)) return;
    const all = [...messages, { role: "user", text: lastUser }, { role: "assistant", text: reply }]
      .map((m) => m.text)
      .join("\n");
    const email = (all.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0];
    if (!email) return;
    const draftPayload = {
      name: (all.match(/name(?:'s| is|:)?\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) || [])[1] || "Customer",
      email,
      project_type: "Custom from AI assistant",
      material: (all.match(/(steel|wood|oak|aluminum|acrylic|leather|brass)/i) || [])[1] || "TBD",
      size: (all.match(/(\d{1,3}\s?(?:in|inch|"|cm|ft|foot))/i) || [])[1] || "",
      budget: (all.match(/\$\d+(?:[,.]\d+)?/) || [])[0] || "",
      description: lastUser.slice(0, 600),
    };
    try {
      await aiSubmitBrief(draftPayload);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "✓ Brief sent to the team. They'll reply with a free quote within 24 hours.",
          system: true,
        },
      ]);
    } catch {
      /* silent */
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Floating launcher — positioned above the Emergent badge so it doesn't get covered */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-24 right-6 z-[60] bg-[#ff4500] text-black w-14 h-14 flex items-center justify-center border-2 border-[#ff4500] hover:rotate-3 transition-transform shadow-[0_0_24px_rgba(255,69,0,0.45)]"
        aria-label={open ? "Close assistant" : "Open assistant"}
        data-testid="ai-launcher"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-44 right-4 sm:right-6 z-[60] w-[min(92vw,420px)] h-[min(70vh,580px)] bg-[#0a0a0a] border border-[#262626] flex flex-col"
            data-testid="ai-panel"
          >
            <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500]">
                  ◆ AI Assistant · online
                </div>
                <div className="font-display text-xl mt-1">Workshop Helper</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-[#a3a3a3] hover:text-[#ff4500]"
              >
                <X size={18} />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3" data-testid="ai-messages">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] ${
                    m.role === "user"
                      ? "ml-auto bg-[#ff4500]/10 border-[#ff4500]/30"
                      : m.system
                      ? "border-[#ff4500]/40 bg-[#ff4500]/5 mx-auto text-center"
                      : "border-[#262626] bg-[#121212]"
                  } border px-3 py-2 font-mono text-[13px] text-[#e5e5e5] leading-relaxed whitespace-pre-wrap`}
                >
                  {m.text}
                </div>
              ))}
              {busy && (
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#525252]">
                  ◆ thinking…
                </div>
              )}
            </div>

            <div className="border-t border-[#262626] p-3 flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                rows={2}
                placeholder="Ask anything — products, custom orders, shipping…"
                disabled={busy}
                className="flex-1 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5] resize-none"
                data-testid="ai-input"
              />
              <button
                onClick={send}
                disabled={busy || !draft.trim()}
                className="self-stretch bg-[#ff4500] text-black px-4 disabled:opacity-50"
                aria-label="Send"
                data-testid="ai-send"
              >
                <Send size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
