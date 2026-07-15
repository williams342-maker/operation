const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("admin dashboard exposes digital product generator under content", () => {
  const src = read("pages/AdminDashboard.jsx");
  expect(src).toContain("DigitalProductGeneratorTab");
  expect(src).toContain('id: "digital-product-generator"');
  expect(src).toContain('label: "Digital Product Generator"');
  expect(src).toContain('caps: ["content"]');
});

test("generator tab includes required controls and draft review workflow", () => {
  const src = read("components/admin/DigitalProductGeneratorTab.jsx");
  [
    "Product Type",
    "Theme",
    "Difficulty",
    "Intended Machine",
    "License",
    "Number of products",
    "Beginner Laser Bundle",
    "Beginner Laser Pack",
    "Holiday Ornament Pack",
    "Address Sign Collection",
    "Quality Score",
    "Preview",
    "Edit",
    "Replace preview",
    "Replace files",
    "Approve",
    "Publish",
    "Bulk publish approved",
    "Approve Selected",
    "Reject Selected",
    "Archive Selected",
    "Delete Selected",
    "Large Preview",
    "Previous Product",
    "Next Product",
    "Package Files",
    "Download ZIP",
    "View SVG",
    "Reviewer Notes",
    "Rejection Reason",
    "Approve With Validation Override",
  ].forEach((text) => expect(src).toContain(text));
  expect(src).toContain("Every product is saved as a draft");
});

test("generator api wrappers use admin endpoints", () => {
  const src = read("lib/api.js");
  [
    "generateAdminDigitalProducts",
    "fetchAdminGeneratedDigitalProducts",
    "updateAdminGeneratedDigitalProduct",
    "replaceAdminGeneratedDigitalPreview",
    "replaceAdminGeneratedDigitalFiles",
    "approveAdminGeneratedDigitalProduct",
    "publishAdminGeneratedDigitalProduct",
    "bulkPublishAdminGeneratedDigitalProducts",
    "deleteAdminGeneratedDigitalProduct",
    "/admin/digital-product-generator/generate",
    "fetchAdminDigitalStarterPacks",
    "fetchAdminDigitalReviewQueue",
    "bulkApproveAdminGeneratedDigitalProducts",
    "bulkRejectAdminGeneratedDigitalProducts",
    "bulkArchiveAdminGeneratedDigitalProducts",
    "bulkDeleteAdminGeneratedDigitalProducts",
    "fetchAdminGeneratedDigitalProductFiles",
    "fetchAdminGeneratedDigitalProductFileBlob",
    "validateAdminGeneratedDigitalProductFiles",
    "saveAdminGeneratedDigitalReviewNote",
    "/admin/digital-product-generator/starter-packs",
  ].forEach((text) => expect(src).toContain(text));
});
