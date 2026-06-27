// iter413co — Verify technique taxonomy contracts.
import {
  TECHNIQUES_BY_CATEGORY,
  techniquesForCategory,
  ALL_TECHNIQUES,
} from "../src/lib/techniqueOptions.js";
// Bypass constants.js (uses extensionless import; Node ESM is strict).
// Instead, regex-extract CATEGORIES from the file text + assert legacy
// TECHNIQUES re-export points at ALL_TECHNIQUES.
import { readFileSync } from "node:fs";
const constSrc = readFileSync(new URL("../src/pages/MakerListingEditor/constants.js", import.meta.url), "utf8");
const catBlockMatch = constSrc.match(/export const CATEGORIES = \[([\s\S]*?)\];/);
const CATEGORIES = catBlockMatch
  ? Array.from(catBlockMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1])
  : [];
const techExportOk = /export const TECHNIQUES = _ALL_TECHNIQUES;/.test(constSrc);
const TECHNIQUES = techExportOk ? ALL_TECHNIQUES : [];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} :: ${name}${detail ? " :: " + detail : ""}`);
}

// 1. Fiber & Textiles order
const fiber = techniquesForCategory("Fiber & Textiles");
const fiberExpected = ["Embroidery","Thread Painting","Quilting","Crochet","Knitting","Weaving","Needle Felting","Macramé","Mixed Media","Other"];
check("Fiber & Textiles list & order",
  JSON.stringify(fiber) === JSON.stringify(fiberExpected),
  JSON.stringify(fiber));

// 2. Woodworking
const wood = techniquesForCategory("Woodworking");
const woodExpected = ["Hand Carving","Scroll Saw","Router","Wood Turning","Pyrography","CNC","Joinery","Other"];
check("Woodworking list & order",
  JSON.stringify(wood) === JSON.stringify(woodExpected),
  JSON.stringify(wood));

// 3. Jewelry & Wearables
const jewelry = techniquesForCategory("Jewelry & Wearables");
const jewelryExpected = ["Wire Wrapping","Silversmithing","Resin","Lost Wax Casting","Enameling","Electroforming","Embroidery","Beading","Other"];
check("Jewelry & Wearables list & order",
  JSON.stringify(jewelry) === JSON.stringify(jewelryExpected),
  JSON.stringify(jewelry));

// 4. Pottery & Ceramics
const pottery = techniquesForCategory("Pottery & Ceramics");
const potteryExpected = ["Wheel Throwing","Hand Building","Slip Casting","Raku","Glazing","Sgraffito","Other"];
check("Pottery & Ceramics list",
  JSON.stringify(pottery) === JSON.stringify(potteryExpected),
  JSON.stringify(pottery));

// 5. Glass, Paper Crafts, Mixed Media non-empty + ends in Other
for (const cat of ["Glass","Paper Crafts","Mixed Media"]) {
  const arr = techniquesForCategory(cat);
  check(`${cat} non-empty + ends in Other`,
    Array.isArray(arr) && arr.length > 0 && arr[arr.length - 1] === "Other",
    JSON.stringify(arr));
}

// 6. Unknown category falls back to DEFAULT_TECHNIQUES
const unknown = techniquesForCategory("Some Unknown Cat");
const defaultExpected = ["Mixed Media","Hand-Made","Machine-Made","Other"];
check("Unknown category fallback DEFAULT_TECHNIQUES",
  JSON.stringify(unknown) === JSON.stringify(defaultExpected),
  JSON.stringify(unknown));

// 7. Case-insensitive lookup
const lowerFiber = techniquesForCategory("fiber & textiles");
check("Case-insensitive lookup (fiber & textiles)",
  JSON.stringify(lowerFiber) === JSON.stringify(fiberExpected),
  JSON.stringify(lowerFiber));

// 8. CUSTOM removed everywhere
let customFound = [];
for (const [cat, arr] of Object.entries(TECHNIQUES_BY_CATEGORY)) {
  for (const t of arr) {
    if (String(t).toLowerCase() === "custom") customFound.push(`${cat}:${t}`);
  }
}
check("No 'Custom' entry in any technique list",
  customFound.length === 0,
  customFound.join(", "));

// 9. ALL_TECHNIQUES sorted + de-duplicated
const flat = Object.values(TECHNIQUES_BY_CATEGORY).flat();
const expectedAll = Array.from(new Set(flat)).sort();
check("ALL_TECHNIQUES sorted + de-duplicated",
  JSON.stringify(ALL_TECHNIQUES) === JSON.stringify(expectedAll),
  `len=${ALL_TECHNIQUES.length}`);

// 10. CATEGORIES contains Glass / Paper Crafts / Mixed Media
for (const cat of ["Glass","Paper Crafts","Mixed Media"]) {
  check(`CATEGORIES contains '${cat}'`, CATEGORIES.includes(cat));
}

// 11. Legacy TECHNIQUES export equals ALL_TECHNIQUES
check("Legacy TECHNIQUES export equals ALL_TECHNIQUES",
  Array.isArray(TECHNIQUES) && TECHNIQUES.length > 0 &&
  JSON.stringify(TECHNIQUES) === JSON.stringify(ALL_TECHNIQUES),
  `len=${TECHNIQUES.length}`);

// 12. Simulate MakerListingEditor set() reset logic
function simulateSet(form, patch) {
  const next = { ...form, ...patch };
  if (patch.category && patch.category !== form.category) {
    const opts = techniquesForCategory(patch.category);
    if (!opts.includes(next.technique)) {
      next.technique = opts[0];
    }
  }
  return next;
}
let form = { category: "Custom Signs", technique: "Plasma" };
form = simulateSet(form, { category: "Fiber & Textiles" });
check("set() resets technique when not in new list",
  form.technique === "Embroidery" && form.category === "Fiber & Textiles",
  JSON.stringify(form));

// technique preserved when in new list
let form2 = { category: "Wall Art", technique: "Plasma" };
form2 = simulateSet(form2, { category: "Custom Signs" });
check("set() preserves technique when still valid",
  form2.technique === "Plasma",
  JSON.stringify(form2));

// category unchanged → technique untouched
let form3 = { category: "Wall Art", technique: "Embroidery" };
form3 = simulateSet(form3, { title: "test" });
check("set() with unchanged category preserves technique",
  form3.technique === "Embroidery",
  JSON.stringify(form3));

const failed = results.filter((r) => !r.ok);
console.log(`\nTotal: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
