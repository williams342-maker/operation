/**
 * iter450 — Store Sections multi-select for the listing editor.
 * Fetches the maker's sections once; checkbox membership is controlled by
 * the parent (`value` = array of section slugs).
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMakerSections } from "../lib/api";

export const StoreSectionsField = ({ value = [], onChange }) => {
  const [sections, setSections] = useState(null);

  useEffect(() => {
    fetchMakerSections()
      .then((d) => setSections(d.sections || []))
      .catch(() => setSections([]));
  }, []);

  if (sections === null) {
    return <p className="font-mono text-[10px] text-ink-muted mt-1">Loading sections…</p>;
  }
  if (sections.length === 0) {
    return (
      <p className="font-mono text-[10px] text-ink-muted mt-1 leading-relaxed" data-testid="editor-sections-empty">
        You haven't created any Store Sections yet.{" "}
        <Link to="/maker/dashboard?tab=sections" className="text-brand hover:underline">
          Create sections
        </Link>{" "}
        to give buyers a way to browse your shop by department.
      </p>
    );
  }
  const toggle = (slug) =>
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);

  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {sections.map((s) => {
        const on = value.includes(s.slug);
        return (
          <button key={s.id} type="button" onClick={() => toggle(s.slug)}
                  className={`px-3 py-1.5 border font-mono text-[11px] transition ${
                    on ? "border-brand text-brand bg-brand/[0.06]" : "border-line text-ink-muted hover:border-brand"}`}
                  data-testid={`editor-section-${s.slug}`}
                  aria-pressed={on}>
            {on ? "✓ " : ""}{s.name}
          </button>
        );
      })}
    </div>
  );
};

export default StoreSectionsField;
