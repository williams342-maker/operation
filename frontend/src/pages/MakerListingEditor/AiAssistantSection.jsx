import React from "react";
import { Sparkles } from "lucide-react";
import { Section, Label } from "./FormControls";

/**
 * AI Assistant section — wraps the Claude-Sonnet-4.5 backed listing-copy
 * generator. Maker types a free-form bullet list, the backend returns a
 * polished title + description + suggested SEO tags, and the parent merges
 * them into the form.
 *
 * Hidden by default-able via the "Hide" button on the right rail to keep
 * vertical space tight once the AI has done its job.
 */
export default function AiAssistantSection({
  aiHidden, setAiHidden,
  aiPrompt, setAiPrompt,
  aiBusy, runAI,
}) {
  return (
    <Section
      eyebrow="◆ Powered by Claude"
      title="AI Assistant"
      subtitle="Describe your item in plain language and the AI will draft your title, description, tags, and suggest a price."
      right={
        <button
          type="button" onClick={() => setAiHidden((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
          data-testid="editor-ai-toggle"
        >
          {aiHidden ? "Show" : "Hide"}
        </button>
      }
    >
      {!aiHidden && (
        <>
          <Label>Describe your item *</Label>
          <textarea
            rows={5} value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="e.g. Plasma cut Texas longhorn skull from 11ga steel, powder coated matte black, 24x18 inches, ready to hang with keyhole brackets. Great for man caves, ranches, bars."
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm resize-y"
            data-testid="editor-ai-prompt"
          />
          <p className="font-mono text-[10px] text-[#525252] mt-2">
            The more detail you provide, the better the output. Include size, material, finish, and use case.
          </p>
          <button
            type="button" onClick={runAI} disabled={aiBusy || !aiPrompt.trim()}
            className="btn-industrial btn-primary mt-4 inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="editor-ai-generate"
          >
            <Sparkles size={14} /> {aiBusy ? "Generating…" : "Generate Listing"}
          </button>
          <p className="font-mono text-[10px] text-[#525252] mt-3">
            ✦ AI-generated content will fill in Title, Description, Tags, and Price below. You can edit anything before publishing.
          </p>
        </>
      )}
    </Section>
  );
}
