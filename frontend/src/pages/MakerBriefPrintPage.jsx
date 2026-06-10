import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Printer, ArrowLeft } from "lucide-react";
import Barcode from "../components/Barcode";
import { fetchMakerBrief } from "../lib/api";

/**
 * Print-optimised bench sheet for a single brief.
 *
 * Top half = brief details + LARGE barcode (so a maker can scan it from
 * a phone at the bench). Bottom half = a 7-step shop-floor checklist
 * (Received → Measured → Cut → Assembled → Finished → Ready → Delivered)
 * with empty signature/initial boxes per step.
 *
 * Native browser print is the simplest path: this page hits @media print
 * to hide chrome (no nav/footer/banner/buttons), Letter-sized layout, and
 * the user's "Save as PDF" option creates the file. No extra libs.
 */
export default function MakerBriefPrintPage() {
  const { briefId } = useParams();
  const navigate = useNavigate();
  const [brief, setBrief] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) {
      navigate("/maker/login");
      return;
    }
    fetchMakerBrief(briefId)
      .then(setBrief)
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load brief."));
  }, [briefId, navigate]);

  if (err) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <p className="font-mono text-sm text-red-400" data-testid="print-error">{err}</p>
      </div>
    );
  }
  if (!brief) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <p className="font-mono text-xs text-ink-muted" data-testid="print-loading">Loading brief…</p>
      </div>
    );
  }

  return (
    <div className="brief-print bg-white text-black min-h-screen" data-testid="brief-print-page">
      {/* Print + Back controls — hidden on print */}
      <div className="no-print sticky top-0 z-10 bg-paper text-ink border-b border-line px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand inline-flex items-center gap-2"
          data-testid="brief-print-back"
        >
          <ArrowLeft size={14} /> Back to dashboard
        </button>
        <button
          onClick={() => window.print()}
          className="btn-industrial btn-primary inline-flex items-center gap-2"
          data-testid="brief-print-trigger"
        >
          <Printer size={16} /> Print / Save PDF
        </button>
      </div>

      <div className="sheet">
        {/* ─── HEADER ─── */}
        <header className="header">
          <div>
            <div className="kicker">CRAFTERS MARKET · BENCH SHEET</div>
            <h1 className="title">{brief.project_type}</h1>
            <div className="subtitle">
              {brief.material} · {brief.size || "size open"} · {brief.budget || "budget open"}
            </div>
          </div>
          <div className="barcode-block">
            <Barcode
              value={brief.tracking_number}
              height={60}
              width={2.4}
              fontSize={14}
              lineColor="#000000"
              background="#ffffff"
              testId={`brief-print-barcode-${brief.tracking_number}`}
            />
          </div>
        </header>

        {/* ─── BUYER + KEY DETAILS ─── */}
        <section className="grid-2col">
          <div>
            <div className="section-label">Buyer</div>
            <div className="big">{brief.name}</div>
            <div className="meta">{brief.email}</div>
            {brief.phone && <div className="meta">{brief.phone}</div>}
          </div>
          <div>
            <div className="section-label">Routed</div>
            <div className="big">
              {brief.assigned_at
                ? new Date(brief.assigned_at).toLocaleDateString()
                : "—"}
            </div>
            <div className="meta">
              Submitted {new Date(brief.created_at).toLocaleDateString()}
            </div>
            <div className="meta">Timeline · {brief.timeline || "flexible"}</div>
          </div>
        </section>

        {/* ─── BRIEF BODY ─── */}
        <section className="brief-body">
          <div className="section-label">Brief</div>
          <p>{brief.description}</p>
        </section>

        {brief.assignment_note && (
          <section className="admin-note">
            <div className="section-label">Admin note</div>
            <p>{brief.assignment_note}</p>
          </section>
        )}

        {/* ─── SHOP-FLOOR CHECKLIST ─── */}
        <section className="checklist">
          <div className="section-label">Shop-floor checklist</div>
          <ol>
            {[
              { step: "Received", desc: "Brief reviewed, materials on hand" },
              { step: "Measured", desc: "Dimensions confirmed, template cut" },
              { step: "Cut", desc: "Stock cut, edges deburred" },
              { step: "Assembled", desc: "Components fitted / welded / fixed" },
              { step: "Finished", desc: "Sanded, coated, polished" },
              { step: "Ready", desc: "QC pass, photographed, packaged" },
              { step: "Delivered", desc: "Shipped or picked up" },
            ].map(({ step, desc }, i) => (
              <li key={step} data-testid={`brief-print-step-${i}`}>
                <span className="step-num">{i + 1}</span>
                <div className="step-body">
                  <div className="step-title">{step}</div>
                  <div className="step-desc">{desc}</div>
                </div>
                <span className="checkbox" />
                <span className="initials-box">Date / Initials</span>
              </li>
            ))}
          </ol>
        </section>

        <footer className="foot">
          <div>Tracking · <b>{brief.tracking_number}</b></div>
          <div>craftersmarket.org/track/{brief.tracking_number}</div>
        </footer>
      </div>

      <style>{`
        .brief-print { font-family: 'Courier New', Courier, monospace; }

        /* On screen, give the sheet a paper-like card feel */
        .brief-print .sheet {
          max-width: 8.5in;
          min-height: 11in;
          margin: 24px auto;
          padding: 0.65in 0.6in;
          background: #fff;
          color: #000;
          box-shadow: 0 0 0 1px #1f1f1f, 0 24px 60px rgba(0,0,0,0.4);
          box-sizing: border-box;
        }

        .brief-print .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
          padding-bottom: 16px;
          border-bottom: 2px solid #000;
          margin-bottom: 18px;
        }
        .brief-print .kicker {
          font-size: 9px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: #555;
        }
        .brief-print .title {
          font-size: 26px;
          font-weight: 800;
          margin: 4px 0 6px;
          text-transform: uppercase;
          line-height: 1.1;
        }
        .brief-print .subtitle {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #333;
        }
        .brief-print .barcode-block {
          padding: 8px 10px;
          border: 1px solid #000;
          background: #fff;
        }

        .brief-print .grid-2col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          margin-bottom: 16px;
        }
        .brief-print .section-label {
          font-size: 9px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: #555;
          margin-bottom: 4px;
        }
        .brief-print .big {
          font-size: 14px;
          font-weight: 700;
          margin-bottom: 2px;
        }
        .brief-print .meta {
          font-size: 11px;
          color: #333;
        }

        .brief-print .brief-body {
          padding: 12px 0;
          border-top: 1px solid #ccc;
          margin: 8px 0;
        }
        .brief-print .brief-body p {
          font-size: 12px;
          line-height: 1.55;
          white-space: pre-wrap;
          margin: 4px 0 0;
        }
        .brief-print .admin-note {
          padding: 10px 12px;
          border-left: 3px solid #000;
          background: #f4f4f4;
          margin: 8px 0 14px;
        }
        .brief-print .admin-note p {
          font-size: 11px;
          line-height: 1.55;
          margin: 4px 0 0;
        }

        .brief-print .checklist {
          margin-top: 18px;
          padding-top: 14px;
          border-top: 2px solid #000;
        }
        .brief-print .checklist ol {
          list-style: none;
          padding: 0;
          margin: 8px 0 0;
        }
        .brief-print .checklist li {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 9px 4px;
          border-bottom: 1px solid #ddd;
        }
        .brief-print .step-num {
          display: inline-flex;
          width: 24px;
          height: 24px;
          align-items: center;
          justify-content: center;
          border: 1px solid #000;
          font-size: 11px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .brief-print .step-body { flex: 1; }
        .brief-print .step-title {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .brief-print .step-desc {
          font-size: 10px;
          color: #555;
          margin-top: 1px;
        }
        .brief-print .checkbox {
          display: inline-block;
          width: 18px;
          height: 18px;
          border: 1px solid #000;
          flex-shrink: 0;
        }
        .brief-print .initials-box {
          display: inline-block;
          width: 130px;
          padding: 4px 8px;
          border: 1px solid #000;
          font-size: 9px;
          color: #777;
          text-align: center;
          flex-shrink: 0;
        }

        .brief-print .foot {
          margin-top: 24px;
          padding-top: 12px;
          border-top: 1px solid #000;
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #555;
        }

        /* Print rules — strip chrome, single page if possible */
        @media print {
          @page { size: Letter; margin: 0.4in; }
          body { background: #fff !important; }
          .no-print, header[data-testid="beta-banner"], nav, footer { display: none !important; }
          .brief-print .sheet {
            box-shadow: none;
            margin: 0;
            padding: 0;
            max-width: none;
            min-height: 0;
          }
          .brief-print .checklist li { padding: 7px 4px; }
        }
      `}</style>
    </div>
  );
}
