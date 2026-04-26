import React from "react";
import { formatDate } from "./_shared";

export default function OrdersList({ orders }) {
  if (!orders.length) {
    return (
      <p
        className="font-mono text-sm text-[#a3a3a3]"
        data-testid="orders-empty"
      >
        No paid orders yet. When a buyer checks out one of your pieces, it'll show up here.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="orders-list">
      {orders.map((o) => (
        <div
          key={o.session_id}
          className="border border-[#262626] hover:border-[#ff4500] transition p-5"
          data-testid={`order-${o.session_id}`}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pb-3 border-b border-[#262626]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
                ◆ Paid · {formatDate(o.created_at)}
              </div>
              <div className="font-mono text-xs text-[#a3a3a3] mt-1">
                {o.buyer_email ? (
                  <>
                    Buyer:{" "}
                    <a href={`mailto:${o.buyer_email}`} className="text-[#e5e5e5] underline">
                      {o.buyer_email}
                    </a>
                  </>
                ) : (
                  "Buyer email not provided"
                )}
              </div>
            </div>
            <div className="font-display text-3xl text-[#ff4500]">
              ${o.maker_subtotal.toFixed(2)}
            </div>
          </div>
          <ul className="mt-3 space-y-1">
            {o.items.map((it) => (
              <li
                key={it.product_slug}
                className="flex justify-between font-mono text-xs text-[#e5e5e5]"
              >
                <span>
                  {it.title} <span className="text-[#525252]">× {it.quantity}</span>
                </span>
                <span className="text-[#a3a3a3]">${it.subtotal.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
