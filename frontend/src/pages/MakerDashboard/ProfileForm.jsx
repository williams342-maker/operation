import React, { useRef, useState } from "react";
import { uploadMakerBanner, updateMakerProfile } from "../../lib/api";
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
  const bannerRef = useRef(null);
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
      <Field
        label="Cover image URL"
        value={form.cover}
        onChange={change("cover")}
        testId="profile-cover"
        wide
      />

      {/* Plus-only: custom shop banner upload */}
      <div className="md:col-span-2" data-testid="profile-banner-section">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2 flex items-center gap-2">
          Custom shop banner
          {!isPlus && (
            <span className="text-[#ff4500] text-[10px]">★ Plus-only</span>
          )}
        </div>
        {bannerUrl && (
          <div className="aspect-[4/1] overflow-hidden border border-[#262626] mb-2 bg-[#121212]">
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
        <button
          type="button"
          onClick={() => bannerRef.current?.click()}
          disabled={!isPlus || bannerBusy}
          className={`w-full border border-dashed px-4 py-3 text-left font-mono text-[11px] transition ${
            isPlus
              ? "border-[#262626] hover:border-[#ff4500] text-[#a3a3a3] hover:text-[#ff4500]"
              : "border-[#1a1a1a] text-[#525252] cursor-not-allowed"
          }`}
          data-testid="profile-banner-upload"
        >
          {bannerBusy
            ? "Uploading…"
            : !isPlus
            ? "Upgrade to Crafters Plus to unlock"
            : bannerUrl
            ? "↻ Replace banner"
            : "+ Upload banner image (recommended 1600×400)"}
        </button>
        {bannerErr && (
          <p className="font-mono text-[10px] text-red-400 mt-1" data-testid="profile-banner-err">{bannerErr}</p>
        )}
      </div>

      <label className="block md:col-span-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          Bio
        </span>
        <textarea
          value={form.bio}
          onChange={change("bio")}
          rows={5}
          className="mt-2 w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5] resize-y transition"
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
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500]"
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
