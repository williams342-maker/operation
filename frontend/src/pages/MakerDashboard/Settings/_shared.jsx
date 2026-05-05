import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";
import { updateMakerProfile } from "../../../lib/api";

/**
 * Shared form scaffolding for the Settings tab panels.
 *
 * Originally lived inline in SettingsTab.jsx alongside every panel —
 * extracted in iter131 so the panel files (Account, Policy, Info, etc.)
 * import what they need without pulling in the parent shell. Nothing in
 * here is panel-specific.
 *
 * Exported helpers:
 *   FormShell      — title/blurb wrapper + Save button + dirty indicator
 *   Field          — label + hint + input slot
 *   ToggleRow      — boolean switch row with hint text
 *   ImageDropzone  — drag-and-drop image uploader (portrait or cover)
 *   useSettingsForm — local form state + dirty tracking + save handler
 *   inputCls       — common <input>/<textarea> class string
 */
export const inputCls =
  "w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2.5 font-mono text-sm text-[#e5e5e5]";

export function FormShell({ title, blurb, children, onSubmit, dirty, busy, testId }) {
  return (
    <form
      onSubmit={onSubmit}
      className="border border-[#262626] p-5 md:p-6 space-y-5"
      data-testid={testId}
    >
      <div>
        <h2 className="font-display text-2xl md:text-3xl uppercase">{title}</h2>
        {blurb && (
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 leading-relaxed">{blurb}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
      <div className="flex items-center justify-end gap-3 border-t border-[#1f1f1f] pt-4">
        {dirty && (
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400" data-testid={`${testId}-dirty`}>
            ◇ Unsaved changes
          </span>
        )}
        <button
          type="submit"
          disabled={!dirty || busy}
          className="btn-industrial btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid={`${testId}-save`}
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

export function Field({ label, hint, children, testId }) {
  return (
    <label className="block" data-testid={testId}>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <span className="font-mono text-[10px] text-[#525252] mt-1.5 block">{hint}</span>
      )}
    </label>
  );
}

export function ToggleRow({ label, hint, value, onChange, testId }) {
  return (
    <div className="flex items-start justify-between gap-3 border border-[#262626] p-3" data-testid={testId}>
      <div className="min-w-0">
        <div className="font-mono text-xs text-[#e5e5e5]">{label}</div>
        {hint && <div className="font-mono text-[10px] text-[#a3a3a3] mt-1 leading-relaxed">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 border transition-colors ${
          value ? "bg-[#ff4500] border-[#ff4500]" : "bg-[#0a0a0a] border-[#262626]"
        }`}
        data-testid={`${testId}-toggle`}
      >
        <span className={`inline-block h-4 w-4 mt-0.5 bg-black transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

/**
 * Drag-and-drop image uploader for shop assets (portrait / cover).
 * - Accepts PNG / JPG / WebP, ≤10MB.
 * - On success, calls `onUploaded(url)`. The upload endpoint already
 *   updates the maker doc — `onUploaded` is just so the UI reflects
 *   immediately.
 */
export function ImageDropzone({ value, onUploaded, uploadFn, kind, testId }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputId = `dropzone-${kind}-${React.useId()}`;
  const aspect = kind === "cover" ? "aspect-[3/1]" : "aspect-square max-w-[180px]";

  const handleFile = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast.error("Use a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be 10 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const { url } = await uploadFn(file);
      onUploaded(url);
      toast.success(`${kind === "cover" ? "Cover" : "Shop icon"} updated.`);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Upload failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid={testId}>
      <div
        className={`${aspect} relative border-2 border-dashed transition-colors overflow-hidden bg-[#0a0a0a] ${
          drag ? "border-[#ff4500] bg-[#ff4500]/5" : "border-[#262626]"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        {value ? (
          <>
            <img src={value} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onUploaded("")}
              className="absolute top-2 right-2 bg-black/70 hover:bg-black border border-[#262626] p-1.5"
              data-testid={`${testId}-remove`}
              aria-label="Remove image"
            >
              <X className="w-3.5 h-3.5 text-[#e5e5e5]" />
            </button>
          </>
        ) : (
          <label
            htmlFor={inputId}
            className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer text-center px-4"
          >
            {busy ? (
              <Loader2 className="w-5 h-5 text-[#ff4500] animate-spin" />
            ) : (
              <>
                <Upload className="w-5 h-5 text-[#a3a3a3] mb-2" />
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#e5e5e5]">
                  Drop image or click
                </div>
                <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">PNG · JPG · WebP · ≤10MB</div>
              </>
            )}
          </label>
        )}
      </div>
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
        data-testid={`${testId}-input`}
      />
    </div>
  );
}

/**
 * Form-state hook used by every settings panel. Tracks dirty diff
 * against the original maker doc, only sends changed fields on save
 * (avoids leaking empty-string defaults into bool columns), surfaces
 * errors via toast.
 */
export function useSettingsForm(maker, fields, onSaved) {
  const initial = React.useMemo(
    () => Object.fromEntries(fields.map((f) => [f, maker?.[f] ?? ""])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maker, fields.join("|")],
  );
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { setForm(initial); }, [initial]);
  const dirty = fields.some((f) => (form[f] ?? "") !== (initial[f] ?? ""));
  const set = (k) => (v) => setForm((c) => ({ ...c, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const patch = Object.fromEntries(
        fields
          .filter((f) => (form[f] ?? "") !== (initial[f] ?? ""))
          .map((f) => [f, form[f]]),
      );
      const updated = await updateMakerProfile(patch);
      toast.success("Saved.");
      onSaved?.(updated);
    } catch (e2) {
      const d = e2?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  };
  return { form, set, dirty, busy, submit };
}
