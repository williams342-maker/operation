// Test the productGuides.js registry contracts.
import { pickGuideForProduct, pickGuidesForProduct, PRODUCT_GUIDES } from "/app/frontend/src/lib/productGuides.js";

let pass = 0, fail = 0;
function t(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`PASS: ${name}`); pass++; }
  else {
    console.log(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}

// 1) Loretta's bug — indoor fiber + "garden" keyword should NOT surface outdoor mounting
t(
  "Fiber & Textiles + 'garden' description -> null",
  pickGuideForProduct({category: "Fiber & Textiles", title: "Garden Wall Hanging", description: "gift for a garden lover", technique: "Embroidery"}),
  null
);

// 2) Outdoor Art + steel + plasma => metal-gauge-finish-guide highest priority
const r2 = pickGuideForProduct({category: "Outdoor Art", title: "Steel garden flag", technique: "Plasma"});
t("Outdoor Art steel+plasma -> metal-gauge-finish-guide", r2?.slug, "metal-gauge-finish-guide");

// 3) Address Numbers + outdoor mailbox => outdoor-mounting-guide
const r3 = pickGuideForProduct({category: "Address Numbers", description: "outdoor mailbox"});
t("Address Numbers mailbox -> outdoor-mounting-guide", r3?.slug, "outdoor-mounting-guide");

// 4) Pottery + outdoor planter => null (excluded)
t(
  "Pottery & Ceramics outdoor planter -> null",
  pickGuideForProduct({category: "Pottery & Ceramics", description: "outdoor planter for the garden"}),
  null
);

// 5) Wall Art plasma steel => should NOT be outdoor-mounting-guide
const r5 = pickGuideForProduct({category: "Wall Art", technique: "Plasma", description: "steel"});
console.log("Wall Art plasma steel result:", JSON.stringify(r5));
if (r5 && r5.slug === "outdoor-mounting-guide") { console.log("FAIL: Wall Art returned outdoor-mounting-guide"); fail++; }
else { console.log("PASS: Wall Art does NOT return outdoor-mounting-guide"); pass++; }

// 6) pickGuidesForProduct returns array of matching
const all = pickGuidesForProduct({category: "Outdoor Art", title: "Steel garden flag", technique: "Plasma", description: "outdoor weatherproof"});
console.log("All matching guides for outdoor steel plasma:", JSON.stringify(all.map(g=>g.slug)));
if (Array.isArray(all) && all.length >= 2) { console.log(`PASS: pickGuidesForProduct returned ${all.length} guides`); pass++; }
else { console.log("FAIL: expected multiple matches"); fail++; }

// 7) Registry shape
console.log(`Registry length: ${PRODUCT_GUIDES.length}`);

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
