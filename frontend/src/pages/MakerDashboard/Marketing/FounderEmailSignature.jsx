import React, { useEffect, useState } from "react";
import { Mail, Copy, Download, Code, FileText } from "lucide-react";
import { toast } from "sonner";
import Section from "./Section";
import { fetchMakerMe } from "../../../lib/api";

/**
 * FounderEmailSignature
 * ---------------------
 * Founder-only email signature kit. Renders a branded HTML email signature
 * with the maker's Founder number + their Gemini-generated card thumbnail,
 * pulled live from `/api/founders/card/:slug`.
 *
 * UX:
 *   • Side-by-side: live preview + copy/download actions
 *   • Copy HTML (drops straight into Gmail, Apple Mail, Outlook Web "Insert HTML")
 *   • Copy plain text (for clients that strip HTML)
 *   • Download .htm file (Outlook desktop needs a file import)
 *
 * Returns `null` when the maker isn't a Founder (same pattern as
 * FounderCardSection — silent disappearance for everyone else).
 */
const API = process.env.REACT_APP_BACKEND_URL;
const SITE = "https://craftersmarket.org";

function buildSig(maker) {
  const num = String(maker.founder_number || 0).padStart(3, "0");
  const inaugural = maker.founder_status === "inaugural";
  const label = inaugural ? "Inaugural Founding Maker" : "Founding Maker";
  const shop = maker.shop_name || maker.name || "Maker";
  const name = maker.name || shop;
  const location = maker.location || "";
  const cardUrl = `${API}/api/founders/card/${maker.slug}`;
  const shopUrl = `${SITE}/m/${maker.slug}?utm_source=email-sig&utm_medium=signature&utm_campaign=founders`;
  const foundersUrl = `${SITE}/founders?utm_source=email-sig&utm_medium=signature&utm_campaign=founders&f=${maker.slug}`;

  // HTML — table-based for Outlook compatibility. Keep inline styles only.
  const html = `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#171717;">
  <tr>
    <td style="vertical-align:top;padding-right:16px;">
      <a href="${foundersUrl}" target="_blank" style="text-decoration:none;">
        <img src="${cardUrl}" alt="Founder #${num} Card" width="96" height="96" style="display:block;border:0;border-radius:4px;" />
      </a>
    </td>
    <td style="vertical-align:top;border-left:3px solid #ff4500;padding-left:14px;">
      <div style="font-size:15px;font-weight:bold;color:#0a0a0a;line-height:1.2;">${name}</div>
      <div style="font-size:12px;color:#525252;line-height:1.5;margin-top:2px;">${shop}${location ? " · " + location : ""}</div>
      <div style="font-size:11px;color:#ff4500;letter-spacing:0.18em;text-transform:uppercase;margin-top:8px;font-weight:bold;">◆ ${label} · #${num}</div>
      <div style="font-size:12px;color:#404040;margin-top:6px;line-height:1.4;">
        Handcrafted on <a href="${shopUrl}" target="_blank" style="color:#ff4500;text-decoration:none;font-weight:bold;">CraftersMarket</a>
        — 3% to the platform, 97% to me.
      </div>
      <div style="font-size:11px;color:#737373;margin-top:4px;">
        <a href="${foundersUrl}" target="_blank" style="color:#737373;text-decoration:underline;">See the founding 100 →</a>
      </div>
    </td>
  </tr>
</table>`;

  // Plain-text fallback — works in Markdown editors, terminals, IDE clients.
  const text =
`${name}
${shop}${location ? " · " + location : ""}
◆ ${label} · #${num}
Shop: ${shopUrl}
The founding 100: ${foundersUrl}`;

  return { html, text };
}

export default function FounderEmailSignature() {
  const [maker, setMaker] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMakerMe()
      .then(setMaker)
      .catch(() => setMaker(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!maker || maker.tier !== "founder") return null;

  const { html, text } = buildSig(maker);
  const num = String(maker.founder_number || 0).padStart(3, "0");

  const copyHtml = () => {
    navigator.clipboard?.writeText(html);
    toast.success("HTML signature copied — paste it into Gmail or Apple Mail settings.");
  };

  const copyText = () => {
    navigator.clipboard?.writeText(text);
    toast.success("Plain-text signature copied.");
  };

  const copyRich = async () => {
    // Try the modern Clipboard API with text/html so it pastes as a
    // rendered block in clients like Gmail's signature editor. Falls
    // back to HTML-as-text when the browser doesn't expose
    // ClipboardItem.
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        const item = new window.ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
        toast.success("Rich signature copied — paste straight into Gmail.");
        return;
      }
    } catch (_) {
      /* fall through */
    }
    copyHtml();
  };

  const downloadHtm = () => {
    const blob = new Blob(
      [`<!DOCTYPE html><html><body>${html}</body></html>`],
      { type: "text/html" },
    );
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `founder-${num}-${maker.slug}-signature.htm`;
    a.click();
    URL.revokeObjectURL(href);
    toast.success("Signature .htm downloaded — Outlook → File → Options → Mail → Signatures.");
  };

  return (
    <Section title="Founder email signature" testId="founder-email-signature">
      <p className="font-mono text-xs text-[#a3a3a3] mb-5 max-w-2xl leading-relaxed">
        A branded signature with your Founder card and shop link baked in.
        Every email you send becomes a quiet recruiting touch — and every reply
        confirms you ship.
      </p>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* Live preview — render the HTML inside a sandbox-ish wrapper that
            visually approximates a white-background email client. */}
        <div className="border border-[#262626] bg-white p-5 rounded-sm overflow-x-auto"
          data-testid="founder-sig-preview">
          <div
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={copyRich}
            className="w-full flex items-center justify-between border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500] hover:text-black transition px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="founder-sig-copy-rich"
          >
            <span className="flex items-center gap-2">
              <Mail size={14} /> Copy for Gmail / Apple Mail
            </span>
            <Copy size={12} />
          </button>

          <button
            onClick={copyHtml}
            className="w-full flex items-center justify-between border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="founder-sig-copy-html"
          >
            <span className="flex items-center gap-2">
              <Code size={14} /> Copy raw HTML
            </span>
            <Copy size={12} />
          </button>

          <button
            onClick={copyText}
            className="w-full flex items-center justify-between border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="founder-sig-copy-text"
          >
            <span className="flex items-center gap-2">
              <FileText size={14} /> Copy plain text
            </span>
            <Copy size={12} />
          </button>

          <button
            onClick={downloadHtm}
            className="w-full flex items-center justify-between border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="founder-sig-download"
          >
            <span className="flex items-center gap-2">
              <Download size={14} /> Download .htm (Outlook)
            </span>
            <span className="text-[10px] opacity-70">desktop</span>
          </button>

          <div className="pt-3 space-y-2 font-mono text-[10px] text-[#525252] leading-relaxed">
            <div className="text-[#a3a3a3] uppercase tracking-[0.22em] font-bold">
              ◇ Where to paste
            </div>
            <div>• Gmail → ⚙ Settings → General → Signature → paste rich.</div>
            <div>• Apple Mail → Mail → Settings → Signatures → paste rich.</div>
            <div>• Outlook desktop → File → Options → Mail → Signatures → import .htm.</div>
            <div>• Outlook web → ⚙ View settings → Mail → Compose → Signatures.</div>
          </div>
        </div>
      </div>
    </Section>
  );
}
