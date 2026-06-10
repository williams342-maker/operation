import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import { deleteMakerApplication, fetchAdminRejectedApplications } from "../../lib/api";
import { formatDate } from "./_shared";
import AdminEmailModal from "./AdminEmailModal";
import { useConfirm } from "../../hooks/useConfirm";
import { RowsSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";

// Standalone list of rejected maker applications. Split out from the
// main Applications tab so the daily review queue stays actionable.
export default function RejectedAppsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [emailTarget, setEmailTarget] = useState(null);
  const [confirm, confirmModal] = useConfirm();

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
    const ok = await confirm({
      title: "Permanently delete this application?",
      body: `${a.studio_name} · ${a.email}. Removes the audit row only.`,
      confirmLabel: "Delete",
      tone: "danger",
      testId: `confirm-delete-rejected-${a.id}`,
    });
    if (!ok) return;
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
      {confirmModal}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Decline Archive</div>
        <h2 className="font-display text-3xl md:text-4xl mt-1">Rejected Applications</h2>
        <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl">
          Historical record of applications that weren't approved. Review, reach out, or clean up audit rows.
        </p>
      </div>

      {loading && <div data-testid="rejected-loading" className="py-2"><RowsSkeleton count={4} /></div>}
      {err && <div className="font-mono text-xs text-red-400 py-6">{err}</div>}
      {!loading && items.length === 0 && (
        <EmptyState
          icon={Archive}
          eyebrow="◆ Decline Archive"
          title="Nothing archived."
          body="Applications you reject will be filed here so you can reach back out later or clean up audit rows."
          testId="rejected-empty"
        />
      )}

      <div className="space-y-3">
        {items.map((a) => (
          <div
            key={a.id}
            className="border border-line p-4 hover:border-red-500/40 transition"
            data-testid={`rejected-row-${a.id}`}
          >
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400">
                  ✕ Rejected · {formatDate(a.decided_at || a.created_at)}
                </div>
                <div className="font-display text-xl mt-1 break-words">{a.studio_name}</div>
                <div className="font-mono text-xs text-ink-muted mt-1 break-words">
                  {a.name} · {a.location} ·{" "}
                  <a href={`mailto:${a.email}`} className="underline hover:text-brand break-all">
                    {a.email}
                  </a>
                </div>
                {a.note && (
                  <div className="mt-2 font-mono text-xs text-ink-muted border-l-2 border-red-500/60 pl-3">
                    {a.note}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0 self-start">
                <button
                  onClick={() => setEmailTarget(a)}
                  data-testid={`rejected-email-${a.id}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
                >
                  ✉ Email
                </button>
                <button
                  onClick={() => remove(a)}
                  data-testid={`rejected-delete-${a.id}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-line hover:border-red-500 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] transition"
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
