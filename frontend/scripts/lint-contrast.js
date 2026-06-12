#!/usr/bin/env node
/**
 * iter390 — Contrast lint (CI grep).
 *
 * The app is a LIGHT "Aged Canvas" theme (cream --paper / --surface).
 * Light Tailwind text shades (text-zinc-300, text-amber-200, text-cyan-300…)
 * are invisible on it — a full sweep removed ~960 of them (iter389).
 * This script blocks NEW ones from creeping back in.
 *
 * Rules:
 *   • Banned: light text-* shades that fail contrast on the cream canvas.
 *   • Allowed inside APPROVED DARK COMPONENTS (listed below) where light
 *     text is intentional (dark cards / cinematic strips / video feeds).
 *   • Use theme tokens instead: text-ink, text-ink-muted, text-brand,
 *     or dark 600/700 hues for statuses (text-emerald-700, text-red-600).
 *
 * Run: `yarn lint:contrast`  (also enforced by backend
 * tests/test_contrast_lint.py so the testing pipeline catches it).
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");

// Components whose light text sits on genuinely dark backgrounds.
// Add a file here ONLY if its banned classes are inside dark containers.
const APPROVED_DARK = [
  "components/sections/WhyWeExist.jsx",      // cinematic-frame pillar cards
  "components/MeetTheMakers.jsx",            // cinematic-frame maker cards
  "components/CinematicMomentsStrip.jsx",    // bg-[#070707] strip
  "components/FeaturedBuildsRail.jsx",       // bg-[#0a0705] rail
  "pages/ClipFeedPage.jsx",                  // black video feed
  "components/SimilarProductsRail.jsx",      // tag over bg-black/70 photo
  "pages/MakersPage.jsx",                    // tag over bg-black/80 photo
];

const BANNED = [
  /text-(?:zinc|gray|neutral|stone|slate)-(?:50|100|200|300|400|500)(?:\/\d+)?\b/,
  /text-amber-(?:50|100|200|300|400|500)(?:\/\d+)?\b/,
  /text-(?:yellow|orange|cyan)-(?:50|100|200|300|400|500)(?:\/\d+)?\b/,
  /text-(?:emerald|green|purple|blue|sky|indigo|teal|pink|fuchsia|rose)-(?:100|200|300)(?:\/\d+)?\b/,
];

const offenders = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(SRC, full);
    if (fs.statSync(full).isDirectory()) {
      if (name === "node_modules" || rel.startsWith("components/ui")) continue;
      walk(full);
      continue;
    }
    if (!/\.(jsx?|tsx?)$/.test(name)) continue;
    if (APPROVED_DARK.includes(rel)) continue;
    const lines = fs.readFileSync(full, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const rx of BANNED) {
        const m = line.match(rx);
        if (m) offenders.push(`${rel}:${i + 1}  →  ${m[0]}`);
      }
    });
  }
}

walk(SRC);

if (offenders.length) {
  console.error("✖ Contrast lint failed — light text shades on the light canvas:\n");
  offenders.slice(0, 40).forEach((o) => console.error("  " + o));
  if (offenders.length > 40) console.error(`  …and ${offenders.length - 40} more`);
  console.error(
    "\nUse theme tokens instead (text-ink / text-ink-muted / text-brand," +
    "\nor dark status hues like text-emerald-700). If the text genuinely sits" +
    "\non a dark background, add the file to APPROVED_DARK in scripts/lint-contrast.js.",
  );
  process.exit(1);
}
console.log("✓ Contrast lint passed — no light text shades outside approved dark components.");
