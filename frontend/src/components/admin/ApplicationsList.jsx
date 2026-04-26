import React, { useState } from "react";
import { decideMakerApplication } from "../../lib/api";
import { formatDate } from "./_shared";

export default function ApplicationsList({ items, onChange }) {
  if (!items.length) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="apps-empty">
        No applications yet.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="apps-list">
      {items.map((a) => (
        <ApplicationRow key={a.id} app={a} onChange={onChange} />
      ))}
    </div>
  );
}

function ApplicationRow({ app, onChange }) {
  const [note, setNote] = useState(app.note || "");
  const [busy, setBusy] = useState(false);
  const decided = app.status === "approved" || app.status === "rejected";
  const decide = async (approved) => {
    setBusy(true);
    try {
      await decideMakerApplication(app.id, { approved, note });
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="border border-[#262626] hover:border-[#ff4500] transition p-5"
      data-testid={`app-${app.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-[#262626]">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ {app.status ? `Decided · ${app.status}` : "Pending"} · {formatDate(app.created_at)}
          </div>
          <div className="font-display text-2xl mt-1">{app.studio_name}</div>
          <div className="font-mono text-xs text-[#a3a3a3] mt-1">
            {app.name} · {app.location} ·{" "}
            <a href={`mailto:${app.email}`} className="underline hover:text-[#ff4500]">
              {app.email}
            </a>
          </div>
          {app.techniques?.length ? (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-2">
              {app.techniques.join(" · ")}
            </div>
          ) : null}
          {app.portfolio_url ? (
            <div className="font-mono text-[10px] mt-1">
              <a
                href={app.portfolio_url}
                target="_blank"
                rel="noreferrer"
                className="text-[#ff4500] hover:underline"
              >
                Portfolio ↗
              </a>
            </div>
          ) : null}
        </div>
      </div>
      <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-3">{app.about}</p>

      {!decided && (
        <div className="mt-4 space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional note (sent to applicant)"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`app-note-${app.id}`}
          />
          <div className="flex gap-3">
            <button
              onClick={() => decide(true)}
              disabled={busy}
              className="btn-industrial btn-primary disabled:opacity-50"
              data-testid={`app-approve-${app.id}`}
            >
              Approve
            </button>
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="px-5 py-3 border border-[#262626] hover:border-red-500 hover:text-red-400 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid={`app-reject-${app.id}`}
            >
              Reject
            </button>
          </div>
        </div>
      )}
      {decided && app.note && (
        <div className="mt-3 font-mono text-xs text-[#a3a3a3] border-l-2 border-[#ff4500] pl-3">
          {app.note}
        </div>
      )}
    </div>
  );
}
