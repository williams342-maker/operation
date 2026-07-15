const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

describe("Returns & Dispute Center frontend contract", () => {
  test("buyer purchase cards expose case creation with policy snapshot review", () => {
    const purchases = read("pages/PurchasesPage.jsx");
    const buyer = read("components/BuyerOrderHelp.jsx");
    expect(purchases).toContain("BuyerOrderHelp");
    expect(buyer).toContain("Get Help With This Order");
    expect(buyer).toContain("Applicable policy snapshot");
    expect(buyer).toContain("case-reason-select");
    expect(buyer).toContain("submit-return-case");
  });

  test("maker dashboard includes Returns Cases tab and resolution actions", () => {
    const dashboard = read("pages/MakerDashboard.jsx");
    const nav = read("pages/MakerDashboard/ShopManagerLayout.jsx");
    const tab = read("pages/MakerDashboard/ReturnsCasesTab.jsx");
    expect(dashboard).toContain("ReturnsCasesTab");
    expect(nav).toContain("returns-cases");
    expect(tab).toContain("Approve return");
    expect(tab).toContain("Offer partial refund");
    expect(tab).toContain("Approve replacement");
    expect(tab).toContain("return-authorization");
  });

  test("admin dashboard includes Resolution Center controls", () => {
    const dashboard = read("pages/AdminDashboard.jsx");
    const tab = read("components/admin/ReturnsDisputesTab.jsx");
    expect(dashboard).toContain("ReturnsDisputesTab");
    expect(tab).toContain("admin-resolution-center");
    expect(tab).toContain("Provider dispute link");
    expect(tab).toContain("Execute refund");
    expect(tab).toContain("Internal note");
  });
});
