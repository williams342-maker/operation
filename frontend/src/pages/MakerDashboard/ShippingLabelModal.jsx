import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X, Loader2, Package, MapPin, Truck, Check, ExternalLink, AlertTriangle } from "lucide-react";
import {
  fetchShippingDefaults,
  fetchShippingRates,
  buyShippingLabel,
  saveShipFromAddress,
} from "../../lib/api";

/**
 * ShippingLabelModal
 * ------------------
 * 3-step wizard for generating a Shippo label on a paid order:
 *   step 1 "review"   — edit From / To / Parcel (pre-filled from maker + listing)
 *   step 2 "rates"    — fetched rate list, cheapest pre-selected
 *   step 3 "done"     — shows purchased label URL + tracking # (copyable)
 *
 * Platform pays Shippo via the test key; a row lands in `shipping_ledger`
 * for weekly billing (see Phase 2). On success the parent refreshes its
 * order list so the row flips to the Fulfilled tab.
 */
export default function ShippingLabelModal({ sessionId, onClose, onSuccess }) {
  const [step, setStep] = useState("review");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [configured, setConfigured] = useState(true);
  const [testMode, setTestMode] = useState(false);

  const [fromAddr, setFromAddr] = useState(null);
  const [toAddr, setToAddr] = useState(null);
  const [parcel, setParcel] = useState(null);
  const [saveDefaultFrom, setSaveDefaultFrom] = useState(true);

  const [rates, setRates] = useState([]);
  const [shipmentMessages, setShipmentMessages] = useState([]);
  const [selectedRate, setSelectedRate] = useState(null);

  const [buying, setBuying] = useState(false);
  const [purchased, setPurchased] = useState(null); // {label_url, tracking_number, ...}

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const d = await fetchShippingDefaults(sessionId);
        setConfigured(!!d.configured);
        setTestMode(!!d.test_mode);
        setFromAddr(d.from_address);
        setToAddr(d.to_address);
        setParcel(d.parcel);
      } catch (e) {
        setErr(e?.response?.data?.detail || "Couldn't load shipping defaults.");
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  const onGetRates = async () => {
    setErr("");
    setLoading(true);
    try {
      // Opportunistically save the edited ship-from as the maker's default
      // so the next order pre-fills correctly. Silent failure is fine —
      // the label flow should not block on this.
      if (saveDefaultFrom) {
        try {
          await saveShipFromAddress(fromAddr);
        } catch (_) { /* ignore */ }
      }
      const res = await fetchShippingRates(sessionId, {
        from_address: fromAddr,
        to_address: toAddr,
        parcel,
      });
      setRates(res.rates || []);
      setShipmentMessages(res.messages || []);
      setSelectedRate(res.rates?.[0]?.rate_id || null); // cheapest auto-selected
      setStep("rates");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't fetch rates.");
    } finally {
      setLoading(false);
    }
  };

  const onBuy = async () => {
    if (!selectedRate) return;
    const chosen = rates.find((r) => r.rate_id === selectedRate);
    if (!chosen) return;
    setBuying(true);
    setErr("");
    try {
      const res = await buyShippingLabel(sessionId, {
        rate_id: chosen.rate_id,
        label_file_type: "PDF_4x6",
        rate_amount: chosen.amount,
        rate_currency: chosen.currency,
        rate_provider: chosen.provider,
        rate_servicelevel_name: chosen.servicelevel_name,
      });
      setPurchased(res);
      setStep("done");
      toast.success("Shipping label purchased.");
      // IMPORTANT: don't call onSuccess() here — it collapses the parent
      // order drawer which unmounts this modal and the user loses the
      // label PDF link / tracking # before they can click. Defer the
      // parent refresh until the user closes the modal explicitly
      // (handleClose / Done button).
    } catch (e) {
      setErr(e?.response?.data?.detail || "Label purchase failed.");
    } finally {
      setBuying(false);
    }
  };

  // Called by X / Cancel / Done / backdrop. If the label was purchased,
  // NOW is when we tell the parent to refetch — after the user has had
  // a chance to open the PDF and copy the tracking number.
  const handleClose = async () => {
    if (purchased && onSuccess) {
      try { await onSuccess(); } catch (_) { /* ignore */ }
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-start md:items-center justify-center px-3 py-8 overflow-y-auto"
      onClick={handleClose}
      data-testid="shipping-label-modal"
    >
      <div
        className="w-full max-w-3xl bg-[#0a0a0a] border border-[#ff4500] text-[#e5e5e5] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#262626]">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] flex items-center gap-2">
              <Truck size={12} /> Create Shipping Label
              {testMode && (
                <span className="px-1.5 py-0.5 border border-yellow-400/50 text-yellow-400 text-[9px]">
                  TEST MODE
                </span>
              )}
            </div>
            <div className="font-mono text-[11px] text-[#525252] mt-1">
              {step === "review" && "① Review addresses + parcel"}
              {step === "rates" && "② Pick a carrier & service"}
              {step === "done" && "③ Label ready"}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-[#a3a3a3] hover:text-[#ff4500]"
            data-testid="shipping-modal-close"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {!configured && (
            <div className="border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-400 font-mono flex items-center gap-2">
              <AlertTriangle size={14} />
              Shippo isn't configured on this deployment. Contact support.
            </div>
          )}

          {err && (
            <div
              className="border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-400 font-mono"
              data-testid="shipping-modal-error"
            >
              {err}
            </div>
          )}

          {loading && !purchased && (
            <div className="flex items-center gap-2 text-xs text-[#a3a3a3] font-mono">
              <Loader2 size={14} className="animate-spin text-[#ff4500]" />
              Loading…
            </div>
          )}

          {/* STEP 1 — review */}
          {!loading && step === "review" && fromAddr && toAddr && parcel && (
            <>
              <div className="grid md:grid-cols-2 gap-5">
                <AddressCard
                  label="Ship From (your studio)"
                  value={fromAddr}
                  onChange={setFromAddr}
                  testIdPrefix="ship-from"
                />
                <AddressCard
                  label="Ship To (buyer)"
                  value={toAddr}
                  onChange={setToAddr}
                  testIdPrefix="ship-to"
                />
              </div>
              <label className="flex items-center gap-2 font-mono text-[11px] text-[#a3a3a3]">
                <input
                  type="checkbox"
                  checked={saveDefaultFrom}
                  onChange={(e) => setSaveDefaultFrom(e.target.checked)}
                  className="accent-[#ff4500]"
                  data-testid="ship-save-default-from"
                />
                Save this address as my default Ship-From
              </label>

              <ParcelCard value={parcel} onChange={setParcel} />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={handleClose}
                  className="btn-industrial"
                  data-testid="shipping-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={onGetRates}
                  disabled={loading || !configured}
                  className="btn-industrial btn-primary disabled:opacity-50"
                  data-testid="shipping-get-rates"
                >
                  {loading ? "Fetching…" : "Get Rates →"}
                </button>
              </div>
            </>
          )}

          {/* STEP 2 — rates */}
          {!loading && step === "rates" && (
            <>
              {rates.length === 0 ? (
                <div className="border border-yellow-400/40 bg-yellow-400/5 p-3 text-xs text-yellow-400 font-mono">
                  Shippo returned no rates for this shipment. Double-check the
                  addresses and parcel dimensions.
                </div>
              ) : (
                <>
                  <div className="font-mono text-[11px] text-[#525252] uppercase tracking-[0.22em]">
                    Cheapest is auto-selected · tap another to override
                  </div>
                  <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
                    {rates.map((r, i) => (
                      <button
                        key={r.rate_id}
                        onClick={() => setSelectedRate(r.rate_id)}
                        className={`w-full text-left p-3 border transition flex items-center justify-between gap-4 ${
                          selectedRate === r.rate_id
                            ? "border-[#ff4500] bg-[#ff4500]/5"
                            : "border-[#262626] hover:border-[#525252]"
                        }`}
                        data-testid={`rate-option-${i}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs text-[#e5e5e5] truncate">
                            <span className="text-[#ff4500]">{r.provider}</span> · {r.servicelevel_name}
                            {i === 0 && (
                              <span className="ml-2 px-1.5 py-0.5 border border-emerald-400/40 text-emerald-400 text-[9px] uppercase tracking-wider">
                                Cheapest
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-[#525252] mt-1 truncate">
                            {r.estimated_days ? `${r.estimated_days} day${r.estimated_days === 1 ? "" : "s"} · ` : ""}
                            {r.duration_terms}
                          </div>
                        </div>
                        <div className="font-display text-2xl text-[#ff4500] shrink-0">
                          ${r.amount.toFixed(2)}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {shipmentMessages.length > 0 && (
                <details className="font-mono text-[10px] text-[#525252]">
                  <summary className="cursor-pointer hover:text-[#a3a3a3]">
                    Shippo messages ({shipmentMessages.length})
                  </summary>
                  <ul className="mt-2 space-y-1 pl-4 list-disc">
                    {shipmentMessages.map((m, i) => (
                      <li key={i}>{m.text}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex justify-between gap-2 pt-2">
                <button
                  onClick={() => setStep("review")}
                  className="btn-industrial"
                  data-testid="shipping-back"
                >
                  ← Back
                </button>
                <button
                  onClick={onBuy}
                  disabled={buying || !selectedRate}
                  className="btn-industrial btn-primary disabled:opacity-50"
                  data-testid="shipping-buy-label"
                >
                  {buying ? "Purchasing…" : "Buy Label →"}
                </button>
              </div>
            </>
          )}

          {/* STEP 3 — done */}
          {!loading && step === "done" && purchased && (
            <div className="space-y-4" data-testid="shipping-done">
              <div className="flex items-center gap-3 p-4 border border-emerald-400/40 bg-emerald-400/5">
                <Check size={20} className="text-emerald-400 shrink-0" />
                <div className="flex-1">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-400">
                    Label purchased
                  </div>
                  <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">
                    {purchased.provider} · {purchased.servicelevel_name} · ${Number(purchased.amount || 0).toFixed(2)} {purchased.currency}
                    {purchased.test_mode && " · TEST"}
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <a
                  href={purchased.label_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-industrial btn-primary text-center flex items-center justify-center gap-2"
                  data-testid="shipping-open-label"
                >
                  <Package size={14} /> Open Label PDF
                </a>
                {purchased.tracking_url_provider && (
                  <a
                    href={purchased.tracking_url_provider}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-industrial text-center flex items-center justify-center gap-2"
                    data-testid="shipping-open-tracking"
                  >
                    <ExternalLink size={14} /> Track at {purchased.provider}
                  </a>
                )}
              </div>

              <CopyField
                label="Tracking number"
                value={purchased.tracking_number}
                testId="shipping-tracking-number"
              />

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleClose}
                  className="btn-industrial btn-primary"
                  data-testid="shipping-close-done"
                >
                  Done →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddressCard({ label, value, onChange, testIdPrefix }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <section className="space-y-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] flex items-center gap-2">
        <MapPin size={11} /> {label}
      </div>
      <Field testId={`${testIdPrefix}-name`} placeholder="Name" value={value.name} onChange={set("name")} />
      <Field testId={`${testIdPrefix}-street1`} placeholder="Street address" value={value.street1} onChange={set("street1")} />
      <Field testId={`${testIdPrefix}-street2`} placeholder="Apt / suite (optional)" value={value.street2} onChange={set("street2")} />
      <div className="grid grid-cols-3 gap-2">
        <Field testId={`${testIdPrefix}-city`} placeholder="City" value={value.city} onChange={set("city")} />
        <Field testId={`${testIdPrefix}-state`} placeholder="State" value={value.state} onChange={set("state")} />
        <Field testId={`${testIdPrefix}-zip`} placeholder="ZIP" value={value.zip} onChange={set("zip")} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field testId={`${testIdPrefix}-country`} placeholder="Country" value={value.country} onChange={set("country")} />
        <Field testId={`${testIdPrefix}-phone`} placeholder="Phone" value={value.phone} onChange={set("phone")} />
      </div>
    </section>
  );
}

function ParcelCard({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: parseFloat(e.target.value) || 0 });
  return (
    <section className="space-y-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] flex items-center gap-2">
        <Package size={11} /> Parcel (inches / pounds) · pre-filled from listing
      </div>
      <div className="grid grid-cols-4 gap-2">
        <NumField testId="parcel-length" label="L" value={value.length} onChange={set("length")} />
        <NumField testId="parcel-width" label="W" value={value.width} onChange={set("width")} />
        <NumField testId="parcel-height" label="H" value={value.height} onChange={set("height")} />
        <NumField testId="parcel-weight" label="lbs" value={value.weight} onChange={set("weight")} />
      </div>
    </section>
  );
}

function Field({ testId, placeholder, value, onChange }) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={onChange}
      className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
      data-testid={testId}
    />
  );
}

function NumField({ testId, label, value, onChange }) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">{label}</span>
      <input
        type="number"
        step="0.01"
        min="0"
        value={value ?? 0}
        onChange={onChange}
        className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5] mt-1"
        data-testid={testId}
      />
    </label>
  );
}

function CopyField({ label, value, testId }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) { /* ignore */ }
  };
  return (
    <div className="flex items-center gap-2 p-3 border border-[#262626] bg-[#0e0e0e]">
      <div className="flex-1">
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">{label}</div>
        <div className="font-mono text-sm text-[#e5e5e5] break-all" data-testid={testId}>{value}</div>
      </div>
      <button
        onClick={copy}
        className="btn-industrial text-[10px] py-1.5 px-3"
        data-testid={`${testId}-copy`}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
