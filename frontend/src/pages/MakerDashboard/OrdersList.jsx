import React, { useState } from "react";
import { toast } from "sonner";
import { Receipt, ChevronDown, Truck, MapPin, Phone, Mail, User, Package, ExternalLink, Sparkles } from "lucide-react";
import EmptyState from "../../components/EmptyState";
import { formatDate } from "./_shared";
import { fetchMakerOrderDetail, markOrderShipped } from "../../lib/api";
import ShippingLabelModal from "./ShippingLabelModal";

/**
 * Orders list. Each row is a click-to-expand accordion that loads full
 * order detail on first open (shipping address, buyer phone, item images,
 * buyer note), caches it, and exposes the "Mark as shipped" action with
 * optional tracking carrier + number.
 */
export default function OrdersList({ orders, onChange }) {
  if (!orders.length) {
    return (
      <EmptyState
        icon={Receipt}
        eyebrow="◆ Paid Orders"
        title="No orders yet."
        body="Share your shop link to start moving pieces — every paid order lands here with the buyer's contact info."
        cta={{
          label: "Share My Shop",
          onClick: async () => {
            const url = window.location.origin + "/makers";
            // navigator.share rejects with AbortError when the user dismisses
            // the share sheet — swallow it silently and fall back to copy.
            // Other rejections (NotAllowedError, etc.) also fall back gracefully.
            try {
              if (navigator.share) {
                await navigator.share({ url });
                return;
              }
            } catch (e) {
              if (e?.name === "AbortError") return;
              // fall through to clipboard copy
            }
            try {
              await navigator.clipboard?.writeText(url);
              toast.success("Shop link copied to clipboard.");
            } catch {
              toast.error("Couldn't share — copy the URL from the address bar.");
            }
          },
          testId: "orders-empty-cta",
        }}
        testId="orders-empty"
      />
    );
  }
  return (
    <div className="space-y-4" data-testid="orders-list">
      {orders.map((o) => (
        <OrderRow key={o.session_id} order={o} onChange={onChange} />
      ))}
    </div>
  );
}

function OrderRow({ order, onChange }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busyShip, setBusyShip] = useState(false);
  const [trackingNum, setTrackingNum] = useState(order.tracking_number || "");
  const [carrier, setCarrier] = useState(order.tracking_carrier || "USPS");
  const [labelModalOpen, setLabelModalOpen] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      setLoadingDetail(true);
      try {
        const d = await fetchMakerOrderDetail(order.session_id);
        setDetail(d);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Couldn't load order detail.");
      } finally {
        setLoadingDetail(false);
      }
    }
  };

  const handleShip = async () => {
    setBusyShip(true);
    try {
      await markOrderShipped(order.session_id, {
        tracking_number: trackingNum?.trim() || null,
        tracking_carrier: carrier?.trim() || null,
      });
      toast.success("Order marked as shipped.");
      setOpen(false);
      if (onChange) await onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to mark shipped.");
    } finally {
      setBusyShip(false);
    }
  };

  const isFulfilled = order.order_status === "fulfilled";

  return (
    <div
      className={`border transition ${open ? "border-[#ff4500]" : "border-[#262626] hover:border-[#525252]"}`}
      data-testid={`order-${order.session_id}`}
    >
      {/* Summary row — the whole header is clickable */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full text-left p-5 focus:outline-none focus:ring-2 focus:ring-[#ff4500]/40"
        data-testid={`order-toggle-${order.session_id}`}
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
              ◆ Paid · {formatDate(order.created_at)}
              {isFulfilled && (
                <span className="ml-2 px-2 py-0.5 border border-emerald-400/40 text-emerald-400">
                  shipped
                </span>
              )}
            </div>
            <div className="font-mono text-xs text-[#a3a3a3] mt-1 flex items-center gap-2 flex-wrap">
              <User size={11} className="opacity-50" />
              <span className="text-[#e5e5e5]">{order.buyer_name || "Buyer"}</span>
              <span className="text-[#525252]">·</span>
              <Mail size={11} className="opacity-50" />
              <span className="truncate">{order.buyer_email || "—"}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="font-display text-3xl text-[#ff4500]">
              ${order.maker_subtotal.toFixed(2)}
            </div>
            <ChevronDown
              size={18}
              className={`text-[#a3a3a3] transition-transform ${open ? "rotate-180" : ""}`}
            />
          </div>
        </div>
        <ul className="mt-3 space-y-1">
          {order.items.map((it) => (
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
      </button>

      {/* Expanded detail drawer */}
      {open && (
        <div
          className="border-t border-[#262626] p-5 space-y-4 bg-[#0e0e0e]"
          data-testid={`order-detail-${order.session_id}`}
        >
          {loadingDetail && (
            <div data-testid={`order-detail-skeleton-${order.session_id}`}>
              <div className="grid md:grid-cols-2 gap-6 animate-pulse">
                <div>
                  <div className="h-3 w-20 bg-[#262626] mb-3" />
                  <div className="h-3 w-48 bg-[#1f1f1f] mb-2" />
                  <div className="h-3 w-40 bg-[#1f1f1f] mb-2" />
                  <div className="h-3 w-32 bg-[#1f1f1f]" />
                </div>
                <div>
                  <div className="h-3 w-20 bg-[#262626] mb-3" />
                  <div className="h-3 w-full bg-[#1f1f1f] mb-2" />
                  <div className="h-3 w-full bg-[#1f1f1f] mb-2" />
                  <div className="h-3 w-3/4 bg-[#1f1f1f]" />
                </div>
              </div>
              <div className="mt-5 space-y-2 animate-pulse">
                <div className="flex gap-3 items-center">
                  <div className="w-14 h-14 bg-[#1f1f1f]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 bg-[#1f1f1f]" />
                    <div className="h-3 w-1/3 bg-[#262626]" />
                  </div>
                </div>
              </div>
            </div>
          )}
          {detail && (
            <>
              {/* Buyer + Shipping grid */}
              <div className="grid md:grid-cols-2 gap-6">
                <section>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                    Buyer
                  </div>
                  <div className="space-y-1 font-mono text-xs text-[#e5e5e5]">
                    <div className="flex items-center gap-2">
                      <User size={12} className="opacity-50" />
                      {detail.buyer_name || detail.shipping?.name || "—"}
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail size={12} className="opacity-50" />
                      <a
                        href={`mailto:${detail.buyer_email}`}
                        className="underline hover:text-[#ff4500]"
                      >
                        {detail.buyer_email}
                      </a>
                    </div>
                    {detail.shipping?.phone && (
                      <div className="flex items-center gap-2">
                        <Phone size={12} className="opacity-50" />
                        <a
                          href={`tel:${detail.shipping.phone}`}
                          className="underline hover:text-[#ff4500]"
                        >
                          {detail.shipping.phone}
                        </a>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                    Ship to
                  </div>
                  {detail.shipping?.address ? (
                    <div className="font-mono text-xs text-[#e5e5e5] leading-relaxed">
                      <div className="flex items-start gap-2">
                        <MapPin size={12} className="opacity-50 mt-0.5" />
                        <address className="not-italic">
                          {detail.shipping.name && <>{detail.shipping.name}<br /></>}
                          {detail.shipping.address.line1}<br />
                          {detail.shipping.address.line2 && <>{detail.shipping.address.line2}<br /></>}
                          {detail.shipping.address.city}, {detail.shipping.address.state} {detail.shipping.address.postal_code}<br />
                          {detail.shipping.address.country}
                        </address>
                      </div>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          [detail.shipping.address.line1, detail.shipping.address.line2, detail.shipping.address.city, detail.shipping.address.state, detail.shipping.address.postal_code].filter(Boolean).join(", "),
                        )}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-[11px] text-[#ff4500] hover:underline"
                        data-testid={`order-map-${order.session_id}`}
                      >
                        <ExternalLink size={10} /> Open in Maps
                      </a>
                    </div>
                  ) : (
                    <p className="font-mono text-[11px] text-[#525252]">
                      Shipping address not yet collected from Stripe.
                    </p>
                  )}
                </section>
              </div>

              {/* Buyer note */}
              {detail.buyer_note && (
                <section className="px-3 py-2 border-l-2 border-yellow-400/50 bg-yellow-400/5">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-yellow-400 mb-1">
                    Buyer note
                  </div>
                  <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed whitespace-pre-wrap">
                    {detail.buyer_note}
                  </p>
                </section>
              )}

              {/* Line items with images */}
              <section>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2 flex items-center gap-2">
                  <Package size={12} /> Items · {detail.items.length}
                </div>
                <ul className="space-y-2">
                  {detail.items.map((it) => (
                    <li key={it.product_slug} className="flex gap-3 items-center">
                      {it.image ? (
                        <img
                          src={it.image}
                          alt=""
                          className="w-14 h-14 object-cover border border-[#262626]"
                        />
                      ) : (
                        <div className="w-14 h-14 border border-[#262626] bg-[#0a0a0a]" />
                      )}
                      <div className="flex-1 font-mono text-xs">
                        <div className="text-[#e5e5e5]">{it.title}</div>
                        <div className="text-[#525252]">
                          ${it.price.toFixed(2)} × {it.quantity}
                        </div>
                      </div>
                      <div className="font-display text-lg text-[#ff4500]">
                        ${it.subtotal.toFixed(2)}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Shipping action */}
              {!isFulfilled ? (
                <section className="pt-4 border-t border-[#262626] space-y-4">
                  {/* Primary: one-click shipping label via Shippo. */}
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2 flex items-center gap-2">
                      <Sparkles size={12} className="text-[#ff4500]" /> Create shipping label
                    </div>
                    <button
                      onClick={() => setLabelModalOpen(true)}
                      className="btn-industrial btn-primary w-full flex items-center justify-center gap-2"
                      data-testid={`order-create-label-${order.session_id}`}
                    >
                      <Package size={14} /> Buy a label via Shippo →
                    </button>
                    <p className="mt-2 font-mono text-[10px] text-[#525252] leading-relaxed">
                      Platform pays the carrier — cost is added to your weekly invoice.
                      Tracking # auto-fills on the order once purchased.
                    </p>
                  </div>

                  {/* Fallback: manual mark-shipped for hand-dropped / self-purchased labels. */}
                  <details className="group">
                    <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] flex items-center gap-2 list-none">
                      <Truck size={12} /> Or mark shipped manually
                      <ChevronDown size={12} className="ml-auto transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-3 grid md:grid-cols-3 gap-2 items-stretch">
                      <select
                        value={carrier}
                        onChange={(e) => setCarrier(e.target.value)}
                        className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
                        data-testid={`order-carrier-${order.session_id}`}
                      >
                        <option value="USPS">USPS</option>
                        <option value="UPS">UPS</option>
                        <option value="FedEx">FedEx</option>
                        <option value="DHL">DHL</option>
                        <option value="Other">Other</option>
                      </select>
                      <input
                        type="text"
                        value={trackingNum}
                        onChange={(e) => setTrackingNum(e.target.value)}
                        placeholder="Tracking # (optional)"
                        className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
                        data-testid={`order-tracking-${order.session_id}`}
                      />
                      <button
                        onClick={handleShip}
                        disabled={busyShip}
                        className="btn-industrial disabled:opacity-50"
                        data-testid={`order-ship-${order.session_id}`}
                      >
                        {busyShip ? "Marking…" : "Mark shipped"}
                      </button>
                    </div>
                  </details>
                </section>
              ) : (
                <section className="pt-4 border-t border-[#262626]" data-testid={`order-shipped-${order.session_id}`}>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400 mb-2 flex items-center gap-2">
                    <Truck size={12} /> Shipped
                    {detail.shipped_at && (
                      <span className="text-[#a3a3a3]">
                        · {new Date(detail.shipped_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {detail.tracking_number && (
                    <div className="font-mono text-xs text-[#e5e5e5]">
                      {detail.tracking_carrier} · {detail.tracking_number}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      )}

      {labelModalOpen && (
        <ShippingLabelModal
          sessionId={order.session_id}
          onClose={() => setLabelModalOpen(false)}
          onSuccess={async () => {
            // Refresh both the drawer's cached detail and the parent list so
            // the row flips to the Fulfilled tab and the shipped pill renders.
            setDetail(null);
            if (onChange) await onChange();
          }}
        />
      )}
    </div>
  );
}
