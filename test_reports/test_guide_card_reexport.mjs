// Confirm backwards-compat re-export from GuideCrossLinkCard.
// We can't import the JSX file directly with Node, so just grep for the export.
import { readFileSync } from "node:fs";
const src = readFileSync("/app/frontend/src/components/GuideCrossLinkCard.jsx", "utf8");
if (/export const pickGuideForProduct\s*=\s*_pickFromRegistry/.test(src)) {
  console.log("PASS: GuideCrossLinkCard re-exports pickGuideForProduct from registry");
} else {
  console.log("FAIL: backwards-compat named export missing");
  process.exit(1);
}
if (/import\s*\{\s*pickGuideForProduct as _pickFromRegistry\s*\}\s*from\s*"\.\.\/lib\/productGuides"/.test(src)) {
  console.log("PASS: import path correct");
} else {
  console.log("FAIL: import path wrong");
}
