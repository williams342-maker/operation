/**
 * JournalBody — minimal markdown renderer scoped to journal posts.
 *
 * We support the few markdown conveniences makers actually reach for:
 *   • Blank-line paragraph breaks
 *   • Inline images   `![alt](https://…)`
 *   • Inline links    `[label](https://…)`
 *   • Bare URLs       `https://…` → autolinked
 *
 * This is deliberately not a full markdown engine — pulling in a
 * library (remark, marked, react-markdown) was overkill for the few
 * primitives we needed and shipped 30-50KB of JS for the privilege.
 *
 * Security: every rendered URL is whitelisted to http(s) only and runs
 * through `noopener noreferrer nofollow`. Image src is also restricted
 * to http(s) so a maker can't inject `javascript:` or `data:` URIs.
 */
import React from "react";

// Captures `![alt](url)` then `[label](url)`. Order matters — image
// regex runs first so `![` doesn't match the link.
//
// iOS 15 / older Safari does NOT support regex lookbehind, so the
// bare-URL autolinker (in `autolink()` below) builds a non-lookbehind
// regex inline rather than living up here as a module-level constant.
const IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function renderInline(text, keyPrefix) {
  // We split by image first because they're block-ish — render an
  // <img> node per match, plain text in between gets recursed into
  // link rendering.
  const parts = [];
  let last = 0;
  let imgMatch;
  IMAGE_RE.lastIndex = 0;
  let i = 0;
  while ((imgMatch = IMAGE_RE.exec(text)) !== null) {
    if (imgMatch.index > last) {
      parts.push(...renderLinks(text.slice(last, imgMatch.index), `${keyPrefix}-${i++}`));
    }
    parts.push(
      <img
        key={`${keyPrefix}-img-${i++}`}
        src={imgMatch[2]}
        alt={imgMatch[1] || ""}
        className="block w-full my-6 border border-line"
        loading="lazy"
      />,
    );
    last = imgMatch.index + imgMatch[0].length;
  }
  if (last < text.length) {
    parts.push(...renderLinks(text.slice(last), `${keyPrefix}-${i++}`));
  }
  return parts;
}

function renderLinks(text, keyPrefix) {
  // First pass: explicit `[label](url)` markdown links.
  const out = [];
  let last = 0;
  let m;
  LINK_RE.lastIndex = 0;
  let i = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push(...autolink(text.slice(last, m.index), `${keyPrefix}-${i++}`));
    }
    out.push(
      <a
        key={`${keyPrefix}-l-${i++}`}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-brand underline underline-offset-2 hover:text-[#ff8c42]"
      >
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push(...autolink(text.slice(last), `${keyPrefix}-${i++}`));
  }
  return out;
}

function autolink(text, keyPrefix) {
  // Last pass — bare https URLs. We use a 2-group regex so we can
  // explicitly re-emit the leading guard character (used to be a
  // lookbehind, but iOS 15 doesn't support those). Group 1 is the
  // guard, group 2 is the URL. We rebuild a fresh non-stateful regex
  // each call to avoid any global lastIndex pitfalls.
  const re = /(^|[^("\w])(https?:\/\/[^\s<>")]+)/g;
  const out = [];
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    const guard = m[1];
    const url = m[2];
    const urlStart = m.index + guard.length;
    if (urlStart > last) out.push(text.slice(last, urlStart));
    out.push(
      <a
        key={`${keyPrefix}-u-${i++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-brand underline underline-offset-2 hover:text-[#ff8c42] break-all"
      >
        {url}
      </a>,
    );
    last = urlStart + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function JournalBody({ body }) {
  // Split paragraphs on blank lines (\n\n+). Single newlines inside a
  // paragraph become spaces — matches the markdown convention authors
  // expect when they break long sentences for readability.
  const paragraphs = (body || "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  return (
    <div className="space-y-5" data-testid="journal-body">
      {paragraphs.map((para, idx) => {
        // If the entire paragraph is a single image, render it as a
        // standalone block (no <p> wrap so we don't produce invalid
        // <p><img></p> markup that some browsers fight us on).
        const onlyImage = /^!\[[^\]]*\]\(https?:\/\/[^\s)]+\)$/.test(para);
        if (onlyImage) {
          return (
            <React.Fragment key={`para-${idx}`}>
              {renderInline(para, `para-${idx}`)}
            </React.Fragment>
          );
        }
        return (
          <p
            key={`para-${idx}`}
            className="font-mono text-base text-ink leading-relaxed"
          >
            {renderInline(para, `para-${idx}`)}
          </p>
        );
      })}
    </div>
  );
}
