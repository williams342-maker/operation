import React, { useRef, useState } from "react";
import { uploadMakerBanner, uploadMakerCover, updateMakerProfile } from "../../lib/api";
import { Field } from "./_shared";

export default function ProfileForm({ maker, onSaved }) {
  const [form, setForm] = useState({
    name: maker.name || "",
    bio: maker.bio || "",
    location: maker.location || "",
    techniques: (maker.techniques || []).join(", "),
    years_crafting: maker.years_crafting ?? "",
    machinery: (maker.machinery || []).join(", "),
    portrait: maker.portrait || "",
    cover: maker.cover || "",
    email: maker.email || "",
  });
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  const [bannerUrl, setBannerUrl] = useState(maker.banner_image_url || "");
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerErr, setBannerErr] = useState("");
  const [bannerDrag, setBannerDrag] = useState(false);
  const bannerRef = useRef(null);
  // iter330 — Free-tier cover-photo upload. The backend endpoint
  // `/maker/uploads/cover` already exists (no Plus gate) and writes to
  // `makers.cover`; this state + handler wires the same drop-or-click
  // pattern used for the Plus banner. Motivation: multiple founders
  // (Rayanne @ Fly Flowers and Finery, 2026-07-02) pasted URLs into
  // the Cover URL field that weren't hostable-image URLs (Google Drive
  // share links, Instagram post URLs) — file upload avoids the
  // shareable-URL footgun entirely.
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverErr, setCoverErr] = useState("");
  const [coverDrag, setCoverDrag] = useState(false);
  const coverRef = useRef(null);
  const isPlus = maker.subscription_status === "active";

  const change = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onBannerFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setBannerErr("Banner must be an image."); return;
    }
    setBannerErr("");
    setBannerBusy(true);
    try {
      const { url } = await uploadMakerBanner(f);
      setBannerUrl(url);
      onSaved({ ...maker, banner_image_url: url });
    } catch (e2) {
      setBannerErr(e2?.response?.data?.detail || "Upload failed.");
    } finally {
      setBannerBusy(false);
      if (bannerRef.current) bannerRef.current.value = "";
    }
  };

  // iter330 — Free-tier cover-photo upload handler. Mirrors onBannerFile
  // but writes to the `cover` field (which the shop page reads via
  // `banner_image_url || cover`). Also updates `form.cover` so a Save
  // Changes click doesn't overwrite the freshly-uploaded URL with stale
  // form state.
  const onCoverFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setCoverErr("Cover must be an image."); return;
    }
    setCoverErr("");
    setCoverBusy(true);
    try {
      const { url } = await uploadMakerCover(f);
      setForm((prev) => ({ ...prev, cover: url }));
      onSaved({ ...maker, cover: url });
    } catch (e2) {
      setCoverErr(e2?.response?.data?.detail || "Upload failed.");
    } finally {
      setCoverBusy(false);
      if (coverRef.current) coverRef.current.value = "";
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ kind: "loading", message: "" });
    try {
      const payload = {
        ...form,
        techniques: form.techniques
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean),
        // Meet-the-Makers — same comma-list pattern as techniques, but
        // we preserve the maker's casing because machinery is brand-name
        // ("Hypertherm Powermax 85") not category ("PLASMA").
        machinery: form.machinery
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
        // Years crafting: cast to int, drop the field if empty so we
        // don't accidentally clear an existing value with 0.
        years_crafting: form.years_crafting === "" ? undefined : Number(form.years_crafting),
      };
      const updated = await updateMakerProfile(payload);
      onSaved(updated);
      setStatus({ kind: "saved", message: "Profile saved." });
      setTimeout(() => setStatus({ kind: "idle", message: "" }), 2400);
    } catch (e2) {
      setStatus({
        kind: "error",
        message: e2?.response?.data?.detail || "Save failed.",
      });
    }
  };

  return (
    <form onSubmit={submit} className="grid md:grid-cols-2 gap-6" data-testid="profile-form">
      <Field label="Studio name" value={form.name} onChange={change("name")} testId="profile-name" />
      <Field
        label="Contact email"
        value={form.email}
        onChange={change("email")}
        type="email"
        testId="profile-email"
      />
      <Field
        label="Location"
        value={form.location}
        onChange={change("location")}
        testId="profile-location"
      />
      <Field
        label="Techniques (comma-separated)"
        value={form.techniques}
        onChange={change("techniques")}
        testId="profile-techniques"
      />
      <Field
        label="Years crafting"
        value={form.years_crafting}
        onChange={change("years_crafting")}
        type="number"
        testId="profile-years-crafting"
      />
      <Field
        label="Workshop machinery (comma-separated)"
        value={form.machinery}
        onChange={change("machinery")}
        testId="profile-machinery"
        wide
      />
      <Field
        label="Portrait image URL"
        value={form.portrait}
        onChange={change("portrait")}
        testId="profile-portrait"
        wide
      />
      {/* iter330 — Cover photo: file upload + URL fallback. The upload
          button writes an R2 URL into form.cover (also persisted server-
          side immediately). Power users can still paste a direct image
          URL into the text field — the two paths converge on the same
          `cover` field. */}
      <div className="md:col-span-2" data-testid="profile-cover-section">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mb-2">
          Cover photo
        </div>
        {form.cover && (
          <div className="aspect-[4/1] overflow-hidden border border-line mb-2 bg-surface">
            <img
              src={form.cover}
              alt="Shop cover"
              className="w-full h-full object-cover"
              data-testid="profile-cover-preview"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          </div>
        )}
        <input
          ref={coverRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onCoverFile}
          disabled={coverBusy}
          className="hidden"
          data-testid="profile-cover-file"
        />
        <div
          onDragOver={(e) => { if (!coverBusy) { e.preventDefault(); setCoverDrag(true); } }}
          onDragLeave={() => setCoverDrag(false)}
          onDrop={(e) => {
            if (coverBusy) return;
            e.preventDefault();
            setCoverDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onCoverFile({ target: { files: [f] } });
          }}
        >
          <button
            type="button"
            onClick={() => coverRef.current?.click()}
            disabled={coverBusy}
            className={`w-full border border-dashed px-4 py-3 text-left font-mono text-[11px] transition ${
              coverDrag
                ? "border-brand text-brand bg-brand/5"
                : "border-line hover:border-brand text-ink-muted hover:text-brand"
            }`}
            data-testid="profile-cover-upload"
          >
            {coverBusy
              ? "Uploading…"
              : coverDrag
              ? "↓ Release to upload"
              : form.cover
              ? "↻ Drop or click to replace cover photo"
              : "+ Drop or click to upload cover photo (recommended 1600×400, JPG/PNG/WebP, ≤10 MB)"}
          </button>
        </div>
        {coverErr && (
          <p className="font-mono text-[10px] text-red-400 mt-1" data-testid="profile-cover-err">{coverErr}</p>
        )}
        <label className="block mt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            or paste a direct image URL
          </span>
          <input
            type="text"
            value={form.cover}
            onChange={change("cover")}
            placeholder="https://…"
            className="mt-1 w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink transition"
            data-testid="profile-cover"
          />
        </label>
      </div>

      {/* Plus-only: custom shop banner upload */}
      <div className="md:col-span-2" data-testid="profile-banner-section">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mb-2 flex items-center gap-2">
          Custom shop banner
          {!isPlus && (
            <span className="text-brand text-[10px]">★ Plus-only</span>
          )}
        </div>
        {bannerUrl && (
          <div className="aspect-[4/1] overflow-hidden border border-line mb-2 bg-surface">
            <img
              src={bannerUrl}
              alt="Shop banner"
              className="w-full h-full object-cover"
              data-testid="profile-banner-preview"
            />
          </div>
        )}
        <input
          ref={bannerRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onBannerFile}
          disabled={!isPlus || bannerBusy}
          className="hidden"
          data-testid="profile-banner-file"
        />
        {/* iter313d — Drag-drop wrapper. Maintains the existing
            click-to-browse behavior + adds proper onDrop so the maker
            can drag a banner JPG straight from their desktop. Plus-only
            gating preserved — drops are ignored when isPlus is false. */}
        <div
          onDragOver={(e) => { if (isPlus && !bannerBusy) { e.preventDefault(); setBannerDrag(true); } }}
          onDragLeave={() => setBannerDrag(false)}
          onDrop={(e) => {
            if (!isPlus || bannerBusy) return;
            e.preventDefault();
            setBannerDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onBannerFile({ target: { files: [f] } });
          }}
        >
          <button
            type="button"
            onClick={() => bannerRef.current?.click()}
            disabled={!isPlus || bannerBusy}
            className={`w-full border border-dashed px-4 py-3 text-left font-mono text-[11px] transition ${
              bannerDrag
                ? "border-brand text-brand bg-brand/5"
                : isPlus
                ? "border-line hover:border-brand text-ink-muted hover:text-brand"
                : "border-line text-ink-muted cursor-not-allowed"
            }`}
            data-testid="profile-banner-upload"
          >
            {bannerBusy
              ? "Uploading…"
              : !isPlus
              ? "Upgrade to Crafters Plus to unlock"
              : bannerDrag
              ? "↓ Release to upload"
              : bannerUrl
              ? "↻ Drop or click to replace banner"
              : "+ Drop or click to upload banner (recommended 1600×400)"}
          </button>
        </div>
        {bannerErr && (
          <p className="font-mono text-[10px] text-red-400 mt-1" data-testid="profile-banner-err">{bannerErr}</p>
        )}
      </div>

      <label className="block md:col-span-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted">
          Bio
        </span>
        <textarea
          value={form.bio}
          onChange={change("bio")}
          rows={5}
          className="mt-2 w-full bg-transparent border border-line focus:border-brand outline-none px-4 py-3 font-mono text-sm text-ink resize-y transition"
          data-testid="profile-bio"
        />
      </label>

      <div className="md:col-span-2 flex items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={status.kind === "loading"}
          className="btn-industrial btn-primary disabled:opacity-60"
          data-testid="profile-save"
        >
          {status.kind === "loading" ? "Saving…" : "Save Changes"}
        </button>
        {status.kind === "saved" && (
          <span
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand"
            data-testid="profile-saved-msg"
          >
            ✓ {status.message}
          </span>
        )}
        {status.kind === "error" && (
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-red-400">
            {status.message}
          </span>
        )}
      </div>
    </form>
  );
}
