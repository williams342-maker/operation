import React, { useState } from "react";
import { quoteCustomOrder } from "../../lib/api";
import { formatDate } from "./_shared";

export default function CustomOrdersList({ items, onChange }) {
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
        <CustomOrderRow key={c.id} order={c} onChange={onChange} />
      ))}
    </div>
  );
}

function CustomOrderRow({ order, onChange }) {
  const [quote, setQuote] = useState(order.quote || "");
  const [message, setMessage] = useState(order.quote_note || "");
  const [busy, setBusy] = useState(false);
  const submitQuote = async () => {
    if (!quote || isNaN(Number(quote))) return;
    setBusy(true);
    try {
      await quoteCustomOrder(order.id, { quote: Number(quote), message });
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="border border-[#262626] hover:border-[#ff4500] transition p-5"
      data-testid={`custom-${order.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-[#262626]">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ {order.status === "quoted" ? `Quoted · $${order.quote}` : "Open"} · {formatDate(order.created_at)}
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
      </div>
      <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-3">{order.description}</p>

      <div className="mt-4 grid md:grid-cols-3 gap-3 items-start">
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
        disabled={busy || !quote}
        className="btn-industrial btn-primary mt-3 disabled:opacity-50"
        data-testid={`custom-send-quote-${order.id}`}
      >
        {order.status === "quoted" ? "Re-Send Quote" : "Send Quote"}
      </button>
    </div>
  );
}
