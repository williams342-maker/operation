import React from "react";
import { uploadMakerPortrait, uploadMakerCover } from "../../../lib/api";
import { FormShell, Field, ImageDropzone, useSettingsForm, inputCls } from "./_shared";

/**
 * "Info & Appearance" settings panel.
 *
 * Edits the basics buyers see at the top of the shop + auto-messaging
 * that goes out with every order. URLs point at uploaded R2 assets
 * (portrait + cover have inline drag-and-drop uploaders so makers
 * don't have to copy/paste URLs).
 *
 * Extracted from SettingsTab.jsx in iter131 — was the largest of the
 * "form" panels at ~110 lines.
 */
export default function InfoAppearance({ maker, onSaved }) {
  const fields = [
    "name", "shop_title", "location", "portrait", "cover",
    "order_receipt_banner_url", "shop_announcement",
    "message_to_buyers", "message_to_buyers_digital",
  ];
  const { form, set, dirty, busy, submit } = useSettingsForm(maker, fields, onSaved);
  return (
    <FormShell
      title="Info & Appearance"
      blurb="The basics buyers see at the top of your shop + auto-messaging that goes out with every order. URLs should point at uploaded R2 assets."
      onSubmit={submit}
      dirty={dirty}
      busy={busy}
      testId="settings-info"
    >
      <Field label="Shop name" testId="settings-info-name">
        <input className={inputCls} value={form.name} onChange={(e) => set("name")(e.target.value)} />
      </Field>
      <Field label="Shop title" hint="A short tagline shown under your shop name. Appears in search results — treat it like an SEO headline.">
        <input
          className={inputCls}
          value={form.shop_title || ""}
          onChange={(e) => set("shop_title")(e.target.value)}
          maxLength={140}
          placeholder="e.g. Precision CNC art since 2019"
          data-testid="settings-info-shop-title"
        />
      </Field>
      <Field label="Location" hint="City, state — keeps shipping estimates honest.">
        <input className={inputCls} value={form.location} onChange={(e) => set("location")(e.target.value)} />
      </Field>
      <Field label="Shop icon (square headshot or logo)" hint="Recommended 800×800. Shown on cards, receipts, and your profile. Drop an image to upload directly to the CDN — no URL juggling.">
        <ImageDropzone
          value={form.portrait}
          onUploaded={(url) => set("portrait")(url)}
          uploadFn={uploadMakerPortrait}
          kind="portrait"
          testId="settings-info-portrait-dropzone"
        />
      </Field>
      <Field label="Cover image" hint="Wide banner that fills your shop hero (recommended 2400×800). Drop an image to upload directly.">
        <ImageDropzone
          value={form.cover}
          onUploaded={(url) => set("cover")(url)}
          uploadFn={uploadMakerCover}
          kind="cover"
          testId="settings-info-cover-dropzone"
        />
      </Field>
      <Field label="Order receipt banner URL" hint="Thin banner (760×100, <2MB) printed at the top of emailed order receipts. Great place for a brand mark.">
        <input
          className={inputCls}
          value={form.order_receipt_banner_url || ""}
          onChange={(e) => set("order_receipt_banner_url")(e.target.value)}
          placeholder="https://cdn.craftersmarket.org/…"
          data-testid="settings-info-receipt-banner"
        />
      </Field>
      <Field label="Shop announcement" hint="Pinned notice shown at the top of your shop page. Use it for sales, vacations, or new drops.">
        <textarea
          rows={3}
          className={`${inputCls} resize-none`}
          value={form.shop_announcement || ""}
          onChange={(e) => set("shop_announcement")(e.target.value)}
          maxLength={800}
          placeholder="Thanks everyone for all your support. Please contact me if you have any questions…"
          data-testid="settings-info-announcement"
        />
      </Field>
      <Field label="Message to buyers" hint="Auto-appended to order confirmation emails for physical goods. Set tone and turnaround expectations.">
        <textarea
          rows={4}
          className={`${inputCls} resize-none`}
          value={form.message_to_buyers || ""}
          onChange={(e) => set("message_to_buyers")(e.target.value)}
          maxLength={1200}
          placeholder="Thank you for your order! I'm adding new patterns all the time…"
          data-testid="settings-info-msg-buyers"
        />
      </Field>
      <Field label="Message to buyers for digital items" hint="Shown on the Downloads page and in the digital-item delivery email.">
        <textarea
          rows={3}
          className={`${inputCls} resize-none`}
          value={form.message_to_buyers_digital || ""}
          onChange={(e) => set("message_to_buyers_digital")(e.target.value)}
          maxLength={1200}
          placeholder="Thanks for downloading! Need a different file format? Message me…"
          data-testid="settings-info-msg-digital"
        />
      </Field>
    </FormShell>
  );
}
