const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("digital downloads page exposes upgraded hero search and autocomplete states", () => {
  const src = read("pages/DigitalDownloadsPage.jsx");
  expect(src).toContain("Digital Downloads");
  expect(src).toContain("Professional files, plans, patterns, and resources from independent makers.");
  expect(src).toContain("Search SVGs, laser files, plans, patterns, and more");
  expect(src).toContain("role=\"combobox\"");
  expect(src).toContain("digital-search-empty");
  expect(src).toContain("/digital-downloads/search");
});

test("digital downloads page renders live categories catalog filters and empty states", () => {
  const src = read("pages/DigitalDownloadsPage.jsx");
  expect(src).toContain("digital-groups-grid");
  expect(src).toContain("new_7d");
  expect(src).toContain("Be the first to upload");
  expect(src).toContain("/digital-downloads/catalog");
  expect(src).toContain("All formats");
  expect(src).toContain("Commercial use");
  expect(src).toContain("digital-catalog-empty");
});

test("digital downloads page reuses product cards and dynamic product sections", () => {
  const src = read("pages/DigitalDownloadsPage.jsx");
  expect(src).toContain("import ProductCard");
  expect(src).toContain("Trending Digital Downloads");
  expect(src).toContain("New This Week");
  expect(src).toContain("Popular Laser & CNC Files");
  expect(src).toContain("Printable Projects");
  expect(src).toContain("Featured Digital Creator");
});

test("digital routes include category view and existing landing route", () => {
  const app = read("App.js");
  expect(app).toContain('path="/digital-downloads"');
  expect(app).toContain('path="/digital-downloads/category/:categorySlug"');
});

test("digital page uses consent gated analytics events and seller cta", () => {
  const src = read("pages/DigitalDownloadsPage.jsx");
  expect(src).toContain("readConsent");
  expect(src).toContain("/analytics/events");
  [
    "digital_landing_view",
    "digital_search",
    "digital_search_result_click",
    "digital_category_view",
    "digital_filter_used",
    "digital_product_click",
    "digital_seller_cta_click",
  ].forEach((eventName) => expect(src).toContain(eventName));
  expect(src).toContain("Sell Your Digital Creations");
  expect(src).toContain("Start Selling Digital Products");
});

test("digital product pages reserve disabled made-with gallery hook", () => {
  const src = read("pages/ProductDetail.jsx");
  expect(src).toContain("digital-made-with-gallery-hook");
  expect(src).toContain("digital-made-with-gallery");
});
