import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, Clock, CheckCircle2 } from "lucide-react";
import {
  fetchMakerInformAct, submitMakerInformAct, certifyMakerInformAct,
} from "../../../lib/api";

const TAX_TYPES = [
  { v: "ssn", label: "SSN" },
  { v: "ein", label: "EIN" },
  { v: "itin", label: "ITIN" },
];
const GOV_TYPES = [
  { v: "drivers_license", label: "Driver's license" },
  { v: "passport", label: "Passport" },
  { v: "state_id", label: "State ID" },
];

const EMPTY = {
  full_name: "", is_business: false, business_name: "",
  street: "", city: "", state: "", zip_code: "", country: "US",
  contact_email: "", contact_phone: "",
  tax_id_type: "ssn", tax_id: "", gov_id_type: "drivers_license",
  bank_name: "", bank_account_name: "", bank_last4: "",
};

function Field({ label, testid, ...props }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted block mb-1">{label}</span>
      <input
        {...props}
        data-testid={testid}
        className="w-full px-3 py-2 bg-paper border border-line focus:border-brand focus:outline-none font-mono text-sm text-ink"
      />
    </label>
  );
}

function StatusBadge({ status, overdue }) {
  const map = {
    collection_required: ["bg-red-950/40 text-red-400 border-red-800", "Action required"],
    pending_verification: ["bg-amber-950/40 text-brand border-amber-700", "Under review"],
    verified: ["bg-emerald-950/40 text-emerald-500 border-emerald-800", overdue ? "Verified · certification due" : "Verified"],
    suspended: ["bg-red-950/60 text-red-400 border-red-700", "Suspended"],
  };
  const [cls, label] = map[status] || ["bg-surface text-ink-muted border-line", "Monitoring"];
  return (
    <span className={`inline-block px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] ${cls}`}
      data-testid="inform-act-status">
      {label}
    </span>
  );
}

/** INFORM Consumers Act compliance card. Renders only once a maker is
 *  flagged as high-volume (or has ever been flagged). */
export default function InformActCard() {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMakerInformAct().then(setState).catch(() => {});
  }, []);

  if (!state || state.status === "monitoring") return null;

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await submitMakerInformAct({
        ...form,
        business_name: form.is_business ? form.business_name : null,
      });
      setState(r);
      setShowForm(false);
      setForm(EMPTY);
      toast.success("Information submitted — our team will verify it shortly.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't submit. Check the fields and retry.");
    } finally {
      setBusy(false);
    }
  };

  const certify = async () => {
    setBusy(true);
    try {
      setState(await certifyMakerInformAct());
      toast.success("Certified — see you next year.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't certify.");
    } finally {
      setBusy(false);
    }
  };

  const needsSubmission = ["collection_required", "suspended"].includes(state.status);
  const deadline = state.deadline_at ? new Date(state.deadline_at).toLocaleDateString() : null;

  return (
    <section className="border border-line p-5" data-testid="inform-act-card">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-start gap-3">
          {state.status === "verified"
            ? <ShieldCheck size={16} className="text-emerald-500 mt-1 shrink-0" />
            : <ShieldAlert size={16} className="text-brand mt-1 shrink-0" />}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ INFORM Consumers Act</div>
            <h3 className="font-display text-xl uppercase mt-1">Seller verification.</h3>
          </div>
        </div>
        <StatusBadge status={state.status} overdue={state.certification_overdue} />
      </div>

      <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-lg mb-4">
        Your shop passed <b className="text-ink">{state.window?.tx_count ?? 0} orders</b> and{" "}
        <b className="text-ink">${Number(state.window?.revenue || 0).toLocaleString()}</b> in the last
        12 months. Federal law (the INFORM Consumers Act) requires high-volume sellers to verify
        their identity with the marketplace. We only store the last 4 digits of your tax ID and bank
        account — never the full numbers.
      </p>

      {state.status === "collection_required" && deadline && (
        <div className="border-l-4 border-red-600 bg-red-950/20 px-3 py-2 mb-4 font-mono text-xs text-red-400" data-testid="inform-deadline-banner">
          <Clock size={12} className="inline mr-1.5 -mt-0.5" />
          Submit by <b>{deadline}</b> — shops that miss the deadline must be suspended.
        </div>
      )}
      {state.status === "suspended" && (
        <div className="border-l-4 border-red-600 bg-red-950/20 px-3 py-2 mb-4 font-mono text-xs text-red-400" data-testid="inform-suspended-banner">
          Your shop is suspended: {state.suspended_reason || "verification incomplete."} Submit your info to get reinstated.
        </div>
      )}
      {state.rejection_note && state.status === "collection_required" && (
        <div className="border-l-4 border-amber-600 bg-amber-950/20 px-3 py-2 mb-4 font-mono text-xs text-brand" data-testid="inform-rejection-note">
          Reviewer note: {state.rejection_note}
        </div>
      )}

      {state.status === "pending_verification" && (
        <div className="font-mono text-xs text-ink-muted" data-testid="inform-pending-msg">
          Submitted {state.submission?.submitted_at ? new Date(state.submission.submitted_at).toLocaleDateString() : ""} — our
          team verifies within 10 days. Nothing else to do right now.
        </div>
      )}

      {state.status === "verified" && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="font-mono text-xs text-ink-muted">
            <CheckCircle2 size={12} className="inline mr-1 -mt-0.5 text-emerald-500" />
            Verified{state.verified_at ? ` on ${new Date(state.verified_at).toLocaleDateString()}` : ""}.
            {state.disclosure_required && " A seller-identity summary appears on your shop page (required at $20k+/yr)."}
          </div>
          {state.certification_overdue && (
            <button onClick={certify} disabled={busy}
              className="btn-industrial btn-primary text-xs disabled:opacity-50"
              data-testid="inform-certify-btn">
              {busy ? "…" : "Certify my info is current →"}
            </button>
          )}
        </div>
      )}

      {needsSubmission && !showForm && (
        <button onClick={() => setShowForm(true)} className="btn-industrial btn-primary text-xs"
          data-testid="inform-open-form-btn">
          Submit my information →
        </button>
      )}

      {needsSubmission && showForm && (
        <form onSubmit={submit} className="space-y-4 mt-2" data-testid="inform-act-form">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Full legal name" testid="inform-field-full-name" value={form.full_name} onChange={set("full_name")} required maxLength={120} />
            <Field label="Contact email" testid="inform-field-email" type="email" value={form.contact_email} onChange={set("contact_email")} required />
            <Field label="Contact phone" testid="inform-field-phone" value={form.contact_phone} onChange={set("contact_phone")} required />
            <label className="flex items-end gap-2 pb-2 font-mono text-xs text-ink cursor-pointer">
              <input type="checkbox" checked={form.is_business} onChange={set("is_business")} data-testid="inform-field-is-business" />
              I sell as a registered business
            </label>
            {form.is_business && (
              <Field label="Business name" testid="inform-field-business-name" value={form.business_name} onChange={set("business_name")} required />
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Street address" testid="inform-field-street" value={form.street} onChange={set("street")} required />
            <Field label="City" testid="inform-field-city" value={form.city} onChange={set("city")} required />
            <Field label="State" testid="inform-field-state" value={form.state} onChange={set("state")} required maxLength={50} />
            <Field label="ZIP" testid="inform-field-zip" value={form.zip_code} onChange={set("zip_code")} required maxLength={12} />
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted block mb-1">Tax ID type</span>
              <select value={form.tax_id_type} onChange={set("tax_id_type")} data-testid="inform-field-tax-type"
                className="w-full px-3 py-2 bg-paper border border-line font-mono text-sm text-ink">
                {TAX_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
            <Field label="Tax ID number" testid="inform-field-tax-id" value={form.tax_id} onChange={set("tax_id")} required maxLength={20} placeholder="Stored as last-4 only" />
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted block mb-1">Government ID type</span>
              <select value={form.gov_id_type} onChange={set("gov_id_type")} data-testid="inform-field-gov-type"
                className="w-full px-3 py-2 bg-paper border border-line font-mono text-sm text-ink">
                {GOV_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Bank name" testid="inform-field-bank-name" value={form.bank_name} onChange={set("bank_name")} required />
            <Field label="Name on bank account" testid="inform-field-bank-account-name" value={form.bank_account_name} onChange={set("bank_account_name")} required />
            <Field label="Account last 4 digits" testid="inform-field-bank-last4" value={form.bank_last4}
              onChange={(e) => setForm((f) => ({ ...f, bank_last4: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) }))} required maxLength={4} />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy} className="btn-industrial btn-primary text-xs disabled:opacity-50"
              data-testid="inform-submit-btn">
              {busy ? "Submitting…" : "Submit for verification"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} disabled={busy}
              className="px-3 py-2 border border-line hover:border-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink transition"
              data-testid="inform-cancel-btn">
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
