import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { deleteMakerApplication, fetchAdminRejectedApplications } from "../../lib/api";
import { formatDate } from "./_shared";
import AdminEmailModal from "./AdminEmailModal";

// Standalone list of rejected maker applications. Split out from the
// main Applications tab so the daily review queue stays actionable.
export default function RejectedAppsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [emailTarget, setEmailTarget] = useState(null);

  const refresh = async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await fetchAdminRejectedApplications();
      setItems(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load rejected applications.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const remove = async (a) => {
    if (!window.confirm(
      `Permanently delete this rejected application?\n\nStudio: ${a.studio_name}\nEmail: ${a.email}\n\nThis removes the audit row only.`,
    )) return;
    try {
      await deleteMakerApplication(a.id);
      toast.success("Application deleted.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to delete.");
    }
  };

  return (
    <div className="space-y-4" data-testid="rejected-apps-tab">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">◆ Decline Archive</div>
        <h2 className="font-display text-3xl md:text-4xl mt-1">Rejected Applications</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl">
          Historical record of applications that weren't approved. Review, reach out, or clean up audit rows.
        </p>
      </div>

      {loading && <div className="font-mono text-xs text-[#a3a3a3] py-6">Loading…</div>}
      {err && <div className="font-mono text-xs text-red-400 py-6">{err}</div>}
      {!loading && items.length === 0 && (
        <div className="font-mono text-xs text-[#a3a3a3] py-6" data-testid="rejected-empty">
          No rejected applications — nothing archived.
        </div>
      )}

      <div className="space-y-3">
        {items.map((a) => (
          <div
            key={a.id}
            className="border border-[#262626] p-4 hover:border-red-500/40 transition"
            data-testid={`rejected-row-${a.id}`}
          >
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400">
                  ✕ Rejected · {formatDate(a.decided_at || a.created_at)}
                </div>
                <div className="font-display text-xl mt-1 break-words">{a.studio_name}</div>
                <div className="font-mono text-xs text-[#a3a3a3] mt-1 break-words">
                  {a.name} · {a.location} ·{" "}
                  <a href={`mailto:${a.email}`} className="underline hover:text-[#ff4500] break-all">
                    {a.email}
                  </a>
                </div>
                {a.note && (
                  <div className="mt-2 font-mono text-xs text-[#a3a3a3] border-l-2 border-red-500/60 pl-3">
                    {a.note}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0 self-start">
                <button
                  onClick={() => setEmailTarget(a)}
                  data-testid={`rejected-email-${a.id}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
                >
                  ✉ Email
                </button>
                <button
                  onClick={() => remove(a)}
                  data-testid={`rejected-delete-${a.id}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-[#262626] hover:border-red-500 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] transition"
                >
                  ✕ Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {emailTarget && (
        <AdminEmailModal
          applicationId={emailTarget.id}
          recipientEmail={emailTarget.email}
          recipientName={emailTarget.name || emailTarget.studio_name}
          onClose={() => setEmailTarget(null)}
        />
      )}
    </div>
  );
}
