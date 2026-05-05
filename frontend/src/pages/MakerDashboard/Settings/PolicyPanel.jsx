import React from "react";
import { FormShell, Field, ToggleRow, useSettingsForm, inputCls } from "./_shared";

/**
 * "Policy settings" panel — returns / refunds / exchanges + custom
 * order policy. These are the shop-wide defaults; per-listing overrides
 * remain on each listing's editor.
 *
 * Extracted from SettingsTab.jsx in iter131 — was the largest "form"
 * panel at ~145 lines after the buyer-preview block.
 */
export default function PolicyPanel({ maker, onSaved }) {
  const fields = [
    "returns_policy",
    "accepts_returns_default",
    "accepts_exchanges_default",
    "return_window_days",
    "return_shipping_paid_by",
    "restocking_fee_pct",
    "non_returnable_items",
    "custom_order_policy",
    "custom_orders_require_proof",
  ];
  const { form, set, dirty, busy, submit } = useSettingsForm(maker, fields, onSaved);
  const acceptsAny = !!form.accepts_returns_default || !!form.accepts_exchanges_default;
  return (
    <FormShell
      title="Policy settings"
      blurb="Returns, refunds, and exchange rules — shown on every product page below the price. These are your shop-wide defaults; per-listing overrides remain on each listing's editor."
      onSubmit={submit}
      dirty={dirty}
      busy={busy}
      testId="settings-policy"
    >
      <div className="space-y-3">
        <ToggleRow
          label="Accept returns by default"
          hint="Buyers can return items for a refund within your return window."
          value={!!form.accepts_returns_default}
          onChange={(v) => set("accepts_returns_default")(v)}
          testId="policy-accepts-returns"
        />
        <ToggleRow
          label="Accept exchanges by default"
          hint="Buyers can exchange items for a different size, color, or variation."
          value={!!form.accepts_exchanges_default}
          onChange={(v) => set("accepts_exchanges_default")(v)}
          testId="policy-accepts-exchanges"
        />
      </div>

      {acceptsAny && (
        <div className="border border-[#262626] bg-[#0a0a0a] p-4 space-y-4" data-testid="policy-rules-block">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            ◆ Your return / exchange rules
          </div>
          <Field label="Return window (days)" hint="How long after delivery a buyer can request a return.">
            <input
              type="number"
              min={1}
              max={365}
              className={inputCls}
              value={form.return_window_days ?? 14}
              onChange={(e) => set("return_window_days")(parseInt(e.target.value || "0", 10))}
              data-testid="policy-return-window"
            />
          </Field>
          <Field label="Who pays return shipping?" hint="Most shops pass shipping cost to the buyer unless the error was theirs.">
            <select
              className={inputCls}
              value={form.return_shipping_paid_by || "buyer"}
              onChange={(e) => set("return_shipping_paid_by")(e.target.value)}
              data-testid="policy-return-shipping-payer"
            >
              <option value="buyer">Buyer pays return shipping</option>
              <option value="seller">Seller pays return shipping</option>
            </select>
          </Field>
          <Field label="Restocking fee (%)" hint="Optional — deducted from the refund. Leave at 0 for no fee.">
            <input
              type="number"
              min={0}
              max={100}
              className={inputCls}
              value={form.restocking_fee_pct ?? 0}
              onChange={(e) => set("restocking_fee_pct")(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10))))}
              data-testid="policy-restocking-fee"
            />
          </Field>
          <Field label="Items that CANNOT be returned" hint="One per line or a short paragraph. Custom/personalized items are typically non-returnable.">
            <textarea
              rows={3}
              className={`${inputCls} resize-none leading-relaxed`}
              value={form.non_returnable_items || ""}
              onChange={(e) => set("non_returnable_items")(e.target.value)}
              data-testid="policy-non-returnable"
            />
          </Field>
        </div>
      )}

      <Field label="Additional return / exchange notes" hint="Free-text policy shown on every product page. Use this for anything the structured fields above don't cover.">
        <textarea rows={6} className={`${inputCls} resize-none leading-relaxed`} value={form.returns_policy || ""} onChange={(e) => set("returns_policy")(e.target.value)} data-testid="policy-returns-notes" />
      </Field>

      <div className="border border-[#262626] bg-[#0a0a0a] p-4 space-y-4" data-testid="policy-custom-orders-block">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          ◆ Custom &amp; personalized orders
        </div>
        <ToggleRow
          label="Require design proof approval before production"
          hint="Industry standard. Buyers must approve a written proof (photo, render, mock-up) before you cut/print/ship. Turn OFF for very simple personalizations (e.g. name engraving) where a proof is overkill."
          value={form.custom_orders_require_proof !== false}
          onChange={(v) => set("custom_orders_require_proof")(v)}
          testId="policy-require-proof"
        />
        <Field label="Custom-order policy (optional)" hint="Override the platform default. Cover deposits, change-fees, lead times, what's non-customizable. Leave blank to use the platform-wide policy.">
          <textarea
            rows={5}
            className={`${inputCls} resize-none leading-relaxed`}
            value={form.custom_order_policy || ""}
            onChange={(e) => set("custom_order_policy")(e.target.value)}
            placeholder="e.g. 50% deposit at proof approval, 50% before shipment. Two free revisions; additional revisions $25 each. No refunds once cutting begins."
            data-testid="policy-custom-order-text"
          />
        </Field>
      </div>

      <div className="border border-[#262626] bg-[#0d0d0d] p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
          ◆ Buyer will see
        </div>
        <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed" data-testid="policy-buyer-preview">
          {acceptsAny ? (
            <>
              This shop accepts {[
                form.accepts_returns_default && "returns",
                form.accepts_exchanges_default && "exchanges",
              ].filter(Boolean).join(" and ")} within{" "}
              <span className="text-white">{form.return_window_days ?? 14} days</span> of delivery.{" "}
              {form.return_shipping_paid_by === "seller"
                ? "The seller covers return shipping."
                : "The buyer pays return shipping."}{" "}
              {form.restocking_fee_pct > 0 && (
                <>A <span className="text-white">{form.restocking_fee_pct}%</span> restocking fee applies. </>
              )}
              {form.non_returnable_items && (
                <>Excluded: <span className="text-white">{form.non_returnable_items}</span></>
              )}
            </>
          ) : (
            "This shop does not accept returns or exchanges."
          )}
        </p>
      </div>
    </FormShell>
  );
}
