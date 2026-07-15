const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("admin policy management exposes required lifecycle controls", () => {
  const src = read("components/admin/PolicyManagementTab.jsx");
  expect(src).toContain("Policy Management");
  expect(src).toContain("Create Draft");
  expect(src).toContain("Generate AI Summary");
  expect(src).toContain("Schedule");
  expect(src).toContain("Publish Now");
  expect(src).toContain("policy-notice-warning");
  expect(src).toContain("policy-diff-view");
  expect(src).toContain("policy-notification-preview");
});

test("maker policy banner supports review and acknowledgement actions", () => {
  const src = read("components/PolicyUpdateBanner.jsx");
  expect(src).toContain("policy-update-banner");
  expect(src).toContain("View Changes");
  expect(src).toContain("View Full Policy");
  expect(src).toContain("Acknowledge");
  expect(src).toContain("Mark Reviewed");
  expect(src).toContain("acknowledgePolicyNotice");
  expect(src).toContain("reviewPolicyNotice");
});

test("public policy route and page support historical versions", () => {
  const app = read("App.js");
  const page = read("pages/PolicyDetailPage.jsx");
  expect(app).toContain('/policies/:slug/versions/:version');
  expect(page).toContain("historical-policy-notice");
  expect(page).toContain("policy-version-history");
  expect(page).toContain("upcoming-policy-notice");
  expect(page).toContain("fetchPublicPolicyHistoricalVersion");
});

test("frontend api exposes policy lifecycle endpoints", () => {
  const api = read("lib/api.js");
  [
    "fetchAdminPolicies",
    "createPolicyDraft",
    "fetchPolicyDiff",
    "generatePolicyAiSummary",
    "schedulePolicyVersion",
    "publishPolicyVersion",
    "fetchMakerPolicyNotices",
    "acknowledgePolicyNotice",
  ].forEach((name) => expect(api).toContain(name));
});
