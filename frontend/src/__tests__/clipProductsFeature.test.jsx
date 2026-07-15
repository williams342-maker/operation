import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ClipsPanel from "../pages/MakerDashboard/Settings/ClipsPanel";
import ClipFeedPage from "../pages/ClipFeedPage";
import * as api from "../lib/api";
import * as storeEvents from "../lib/storeEvents";

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => <a href={typeof to === "string" ? to : "#"} {...props}>{children}</a>,
    useParams: () => ({}),
    useNavigate: () => jest.fn(),
  };
});

jest.mock("../lib/api");
jest.mock("../lib/storeEvents");

global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

function mount(ui) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  act(() => { root.render(ui); });
  return { div, root, unmount: () => act(() => root.unmount()) };
}

async function waitFor(fn) {
  const start = Date.now();
  let last;
  while (Date.now() - start < 3000) {
    try { return fn(); } catch (e) { last = e; }
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
  throw last;
}

beforeEach(() => {
  jest.resetAllMocks();
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ isIntersecting: true, intersectionRatio: 0.7, target: el }]); }
    disconnect() {}
  };
  HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = jest.fn();
  api.fetchClipCategories.mockResolvedValue({ total: 1, categories: [{ id: "workshop", label: "Workshop", emoji: "*" }] });
  api.fetchClipsIncentiveStatus.mockResolvedValue({ slots_remaining: 10, claimed: false });
  api.recordClipView.mockResolvedValue({ ok: true });
  api.recordClipShare.mockResolvedValue({ ok: true });
  api.toggleClipLike.mockResolvedValue({ on: true, count: 1 });
  api.toggleClipSave.mockResolvedValue({ on: true, count: 1 });
  storeEvents.trackStoreEvent.mockImplementation(() => {});
});

test("maker clip list shows edit control only in owner management surface", async () => {
  api.fetchMyClips.mockResolvedValue({ items: [{
    id: "clip-1", slug: "clip-one", title: "Clip One", category: "workshop",
    source_type: "r2", views: 3, likes: 0, saves: 0, linked_products: [],
    metrics: { views: 3, product_clicks: 1, store_visits: 1, click_through_rate: 33.33 },
  }] });
  const view = mount(<ClipsPanel />);
  await waitFor(() => expect(view.div.querySelector('[data-testid="clips-my-edit-clip-1"]')).toBeTruthy());
  expect(view.div.textContent).toContain("1 product clicks");
  view.unmount();
});

test("product selector searches eligible products and adds a selected product", async () => {
  const clip = { id: "clip-2", slug: "clip-two", title: "Clip Two", category: "workshop", tags: [], linked_products: [] };
  const product = { slug: "walnut-bowl", title: "Walnut Bowl", price: 48, image: "https://example.test/p.jpg", stock_status: "In stock", in_stock: 4 };
  api.fetchMyClips.mockResolvedValue({ items: [clip] });
  api.fetchClipEditDetails.mockResolvedValue({ clip });
  api.searchMyClipProducts.mockResolvedValue({ items: [product] });
  api.updateMyClip.mockResolvedValue({ ok: true, clip });
  api.setClipProducts.mockResolvedValue({ ok: true, linked_products: [product] });

  const view = mount(<ClipsPanel />);
  await waitFor(() => expect(view.div.querySelector('[data-testid="clips-my-edit-clip-2"]')).toBeTruthy());
  act(() => { view.div.querySelector('[data-testid="clips-my-edit-clip-2"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await waitFor(() => expect(view.div.querySelector('[data-testid="clip-product-add-walnut-bowl"]')).toBeTruthy());
  act(() => { view.div.querySelector('[data-testid="clip-product-add-walnut-bowl"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await waitFor(() => expect(view.div.querySelector('[data-testid="clip-selected-product-walnut-bowl"]')).toBeTruthy());
  view.unmount();
});

test("public linked-product drawer opens and links to product and maker pages", async () => {
  api.fetchClipFeed.mockResolvedValue({ items: [{
    id: "clip-3", slug: "clip-three", title: "Clip Three", category: "workshop",
    maker_slug: "maker-one", maker_name: "Maker One", source_type: "r2",
    video_url: "https://example.test/video.mp4", poster_url: null,
    likes: 0, saves: 0, shares: 0, tags: [], linked_products: [{
      slug: "walnut-bowl", title: "Walnut Bowl", price: 48, price_min: 48,
      price_max: 48, image: "https://example.test/p.jpg", maker_slug: "maker-one",
      maker_name: "Maker One", in_stock: 0, stock_status: "Out of stock",
    }],
  }], next_cursor: null });
  const view = mount(<ClipFeedPage />);
  await waitFor(() => expect(view.div.querySelector('[data-testid="clip-shop-clip-three"]')).toBeTruthy());
  act(() => { view.div.querySelector('[data-testid="clip-shop-clip-three"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await waitFor(() => expect(view.div.querySelector('[data-testid="clip-products-drawer-clip-three"]')).toBeTruthy());
  expect(view.div.querySelector('[data-testid="clip-product-link-walnut-bowl"]').getAttribute("href")).toBe("/shop/walnut-bowl");
  expect(view.div.querySelector('[data-testid="clip-store-link-clip-three"]').getAttribute("href")).toBe("/makers/maker-one");
  expect(view.div.textContent).toContain("Out of stock");
  view.unmount();
});

test("clips without linked products do not render an empty product drawer", async () => {
  api.fetchClipFeed.mockResolvedValue({ items: [{
    id: "clip-4", slug: "clip-four", title: "Clip Four", category: "workshop",
    maker_slug: "maker-one", maker_name: "Maker One", source_type: "r2",
    video_url: "https://example.test/video.mp4", likes: 0, saves: 0, shares: 0,
    tags: [], linked_products: [],
  }], next_cursor: null });
  const view = mount(<ClipFeedPage />);
  await waitFor(() => expect(view.div.querySelector('[data-testid="clip-clip-four"]')).toBeTruthy());
  expect(view.div.querySelector('[data-testid="clip-products-drawer-clip-four"]')).toBeFalsy();
  view.unmount();
});
