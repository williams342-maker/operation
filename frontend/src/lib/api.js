import axios from "axios";
const BASE = process.env.REACT_APP_BACKEND_URL;
export const API = `${BASE}/api`;
export const http = axios.create({ baseURL: API });

// Global response interceptor — FastAPI returns 422 with `detail` as an array
// of {type, loc, msg, ...} objects. Components that do
// `setErr(e?.response?.data?.detail || "fallback")` would then try to render
// an array of objects as a React child and crash with "Objects are not valid
// as a React child". Flatten it to a readable string here so every consumer
// gets a string regardless of status code.
http.interceptors.response.use(
  (r) => r,
  (error) => {
    const d = error?.response?.data?.detail;
    if (Array.isArray(d)) {
      error.response.data.detail = d
        .map((x) => (x && typeof x === "object" ? (x.msg || JSON.stringify(x)) : String(x)))
        .join("; ");
    } else if (d && typeof d === "object") {
      // iter413k — Preserve the original structured detail on a sidecar
      // field BEFORE stringifying. Some consumers (e.g. PlusAnalytics)
      // gate their UI on a structured `code` field like `plus_required`
      // and need the object back. Default consumers still read
      // `detail` as a string and stay crash-safe.
      error.response.data.detail_raw = d;
      error.response.data.detail = d.msg || d.message || JSON.stringify(d);
    }

    // iter285 — Auto-purge stale tokens on 401. The Studio (and several
    // other gated flows) checks `!!localStorage.getItem("cm_*_jwt")` to
    // decide whether to show a sign-in callout. If the token is present
    // but expired/invalid the UI looks signed-in, the action fires, and
    // backend returns 401 → user gets a confusing "Invalid session"
    // toast with no path forward. Clearing the bad token here flips the
    // UI back to signed-out so the user sees the sign-in CTA on the
    // next render and knows what to do.
    const status = error?.response?.status;
    if (status === 401) {
      const detail = error?.response?.data?.detail || "";
      const looksExpired = /session|sign in|expired|invalid|missing/i.test(detail);
      if (looksExpired) {
        try {
          // Don't touch admin JWT — admin session lives elsewhere and
          // their 401 path is the admin login redirect.
          localStorage.removeItem("cm_maker_jwt");
          localStorage.removeItem("cm_maker_slug");
          localStorage.removeItem("cm_maker_jwt_exp");
          localStorage.removeItem("cm_buyer_jwt");
        } catch { /* private mode — silent */ }
      }
    }
    return Promise.reject(error);
  },
);

// ────────────── Maker session expiry enforcement ──────────────
// If the user unchecked "Keep me signed in" on the login page,
// MakerVerify stores `cm_maker_jwt_exp` (ms-epoch). Whenever this
// module loads — and on every authed request — we check whether
// that deadline has passed and, if so, purge the token so the
// next protected call 401s and the user is bounced back to login.
// If the key is absent, the session is treated as persistent.
const purgeMakerSessionIfExpired = () => {
  try {
    const exp = localStorage.getItem("cm_maker_jwt_exp");
    if (!exp) return;
    if (Date.now() > Number(exp)) {
      localStorage.removeItem("cm_maker_jwt");
      localStorage.removeItem("cm_maker_slug");
      localStorage.removeItem("cm_maker_jwt_exp");
    }
  } catch (_) {
    // localStorage can throw in private-mode / quota edge cases — ignore.
  }
};
purgeMakerSessionIfExpired();

export const fetchProducts = (params) => http.get("/products", { params }).then((r) => r.data);
// iter360 — Trending strip on the homepage. Defaults to mosaic-source
// product_view events over the last 24 h.
export const fetchTrendingProducts = (params) =>
  http.get("/products/trending", { params }).then((r) => r.data);
export const fetchProduct = (slug) => http.get(`/products/${slug}`).then((r) => r.data);
export const fetchMakers = () => http.get("/makers").then((r) => r.data);
export const fetchMaker = (slug) => http.get(`/makers/${slug}`).then((r) => r.data);
export const fetchReviews = (params) => http.get("/reviews", { params }).then((r) => r.data);
export const submitReview = (payload) => http.post("/reviews", payload).then((r) => r.data);
export const fetchPosts = () => http.get("/blog").then((r) => r.data);
export const fetchPost = (slug) => http.get(`/blog/${slug}`).then((r) => r.data);
// Top-clicked journal posts in the last N days. Powers the homepage
// Trending Journal rail. Falls back to recency on a fresh deploy.
export const fetchTrendingPosts = (limit = 4, days = 14) =>
  http.get("/blog-trending", { params: { limit, days } }).then((r) => r.data);
// Best-effort view counter — silenced on failure (analytics shouldn't
// surface as a UX error).
export const recordPostView = (slug) =>
  http.post(`/blog/${encodeURIComponent(slug)}/view`).then((r) => r.data).catch(() => null);
export const fetchActivity = (limit = 10) => http.get("/activity", { params: { limit } }).then((r) => r.data);
export const fetchShopOfTheWeek = () => http.get("/shop-of-the-week").then((r) => r.data);
export const submitCustomOrder = (payload) => http.post("/custom-orders", payload).then((r) => r.data);
export const uploadCustomOrderDesign = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http
    .post("/custom-orders/upload-design", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};
export const submitMakerApplication = (payload) => http.post("/maker-applications", payload).then((r) => r.data);
export const fetchFeePolicy = () => http.get("/policy/fee-policy").then((r) => r.data);

// ───────────────────── unified password auth ─────────────────────
export const fetchAuthFlags = () => http.get("/auth/password/flags").then((r) => r.data);
export const passwordLogin = (email, password, role) =>
  http.post("/auth/password/login", { email, password, role }).then((r) => r.data);
export const passwordSet = (role, new_password, current_password, token) =>
  http.post(`/auth/password/set/${role}`, { new_password, current_password },
    token ? { headers: { Authorization: `Bearer ${token}` } } : {}).then((r) => r.data);
export const passwordForgot = (email, role, origin_url) =>
  http.post("/auth/password/forgot", { email, role, origin_url }).then((r) => r.data);
export const passwordReset = (token, nonce, new_password) =>
  http.post("/auth/password/reset", { token, nonce, new_password }).then((r) => r.data);
export const adminSendPasswordReset = (token, payload) =>
  http.post("/admin/users/send-password-reset", payload,
    { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);
export const adminForceSignout = (token, payload) =>
  http.post("/admin/users/force-signout", payload,
    { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);
export const createCheckout = (payload) => http.post("/checkout/session", payload).then((r) => r.data);
export const getCheckoutStatus = (sid) => http.get(`/checkout/status/${sid}`).then((r) => r.data);
export const fetchCartQuote = (items, discount_code = null) =>
  http.post("/cart/quote", {
    items,
    origin_url: window.location.origin,
    discount_code: discount_code || null,
  }).then((r) => r.data);

// ---------- Maker portal (magic-link auth) ----------
export const requestMakerLink = (email, origin_url) =>
  http.post("/maker/auth/request", { email, origin_url }).then((r) => r.data);
export const verifyMakerToken = (token) =>
  http.post("/maker/auth/verify", { token }).then((r) => r.data);

const authHeaders = () => {
  purgeMakerSessionIfExpired();
  const t = localStorage.getItem("cm_maker_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
export const fetchMakerMe = () =>
  http.get("/maker/me", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerOrders = () =>
  http.get("/maker/orders", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerOrderDetail = (sessionId) =>
  http.get(`/maker/orders/${sessionId}`, { headers: authHeaders() }).then((r) => r.data);
export const markOrderShipped = (sessionId, payload) =>
  http.post(`/maker/orders/${sessionId}/ship`, payload || {}, { headers: authHeaders() }).then((r) => r.data);
export const resendTrackingEmail = (sessionId) =>
  http.post(`/maker/orders/${sessionId}/resend-tracking-email`, {}, { headers: authHeaders() }).then((r) => r.data);

// ──────────── Shippo shipping labels ────────────
export const fetchShipFromAddress = () =>
  http.get("/maker/shipping/from-address", { headers: authHeaders() }).then((r) => r.data);
export const saveShipFromAddress = (payload) =>
  http.patch("/maker/shipping/from-address", payload, { headers: authHeaders() }).then((r) => r.data);
export const fetchShippingDefaults = (sessionId) =>
  http.get(`/maker/orders/${sessionId}/shipping-defaults`, { headers: authHeaders() }).then((r) => r.data);
export const fetchShippingRates = (sessionId, payload) =>
  http.post(`/maker/orders/${sessionId}/shipping/rates`, payload, { headers: authHeaders() }).then((r) => r.data);
export const buyShippingLabel = (sessionId, payload) =>
  http.post(`/maker/orders/${sessionId}/shipping/buy-label`, payload, { headers: authHeaders() }).then((r) => r.data);
export const refreshShippingTracking = (sessionId) =>
  http.post(`/maker/orders/${sessionId}/shipping/refresh-tracking`, {}, { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerShippingLedger = () =>
  http.get("/maker/shipping/ledger", { headers: authHeaders() }).then((r) => r.data);
export const setMakerShippingCadence = (cadence) =>
  http.patch("/maker/shipping/cadence", { cadence }, { headers: authHeaders() }).then((r) => r.data);
export const setMakerShippingCap = (monthlyCapUsd) =>
  http.patch("/maker/shipping/cap", { monthly_cap_usd: monthlyCapUsd }, { headers: authHeaders() }).then((r) => r.data);
export const validateShippingAddress = (addr) =>
  http.post("/maker/shipping/validate-address", addr, { headers: authHeaders() }).then((r) => r.data);
export const fetchShippingAnalytics = (days = 30) =>
  http.get("/maker/shipping/analytics", { params: { days }, headers: authHeaders() }).then((r) => r.data);

// iter334 — Live Shippo rates for the listing-editor preset picker
// `parcel` is optional and overrides the preset's canonical packaging when
// the maker has filled in their own packed_* dims + weight on the listing.
export const fetchPresetShippingRates = (preset_id, to_zip = null, parcel = null) =>
  http.post("/maker/shipping/preset-rates",
    { preset_id, to_zip, ...(parcel || {}) },
    { headers: authHeaders() }
  ).then((r) => r.data);

// iter334 — AI Price Comparison companion (Jina Reader + Claude)
export const fetchListingPriceCompare = (slug, force_refresh = false) =>
  http.post(`/maker/listings/${slug}/price-compare`, { force_refresh }, { headers: authHeaders() }).then((r) => r.data);

// Admin · shipping ledger
export const adminFetchShippingLedger = (token, params = {}) =>
  http.get("/admin/shipping-ledger", { params, headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);
export const adminFetchShippingRollup = (token) =>
  http.get("/admin/shipping-ledger/rollup", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);
export const adminMarkShippingBilled = (token, ledgerId, payload) =>
  http.post(`/admin/shipping-ledger/${ledgerId}/mark-billed`, payload, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);
export const adminRunShippingInvoices = (token, dryRun = true) =>
  http.post("/admin/shipping-ledger/run-invoices", { dry_run: dryRun }, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);
export const adminShippingLedgerCsvUrl = (token, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  // NOTE: the caller appends the token via fetch w/ Authorization — CSV
  // download uses a blob fetch rather than a direct <a href>.
  return `${API}/admin/shipping-ledger/export.csv${qs ? `?${qs}` : ""}`;
};
export const fetchMakerStats = () =>
  http.get("/maker/stats", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerViolations = () =>
  http.get("/maker/violations", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerTransactions = () =>
  http.get("/maker/transactions", { headers: authHeaders() }).then((r) => r.data);

// AI Marketing Companion
export const aiListingCopy = (payload) =>
  http.post("/maker/ai/listing-copy", payload, { headers: authHeaders() }).then((r) => r.data);

// iter334l — Title refresh tied to a price change.
export const aiTitleRefresh = (slug, old_price, new_price) =>
  http.post("/maker/ai/title-refresh",
    { slug, old_price, new_price },
    { headers: authHeaders() },
  ).then((r) => r.data);
export const aiSeoTags = (payload) =>
  http.post("/maker/ai/seo-tags", payload, { headers: authHeaders() }).then((r) => r.data);
export const aiSeoBulk = (payload) =>
  http.post("/maker/ai/seo-bulk", payload, { headers: authHeaders() }).then((r) => r.data);
export const aiSeoAudit = () =>
  http.get("/maker/ai/seo-audit", { headers: authHeaders() }).then((r) => r.data);
export const aiPricingSuggest = (productSlug) =>
  http.get(`/maker/ai/pricing-suggest/${productSlug}`, { headers: authHeaders() }).then((r) => r.data);

// Discount Codes
export const fetchDiscountCodes = () =>
  http.get("/maker/discount-codes", { headers: authHeaders() }).then((r) => r.data);
export const createDiscountCode = (payload) =>
  http.post("/maker/discount-codes", payload, { headers: authHeaders() }).then((r) => r.data);
export const toggleDiscountCode = (id, active) =>
  http.patch(`/maker/discount-codes/${id}`, { active }, { headers: authHeaders() }).then((r) => r.data);
export const deleteDiscountCode = (id) =>
  http.delete(`/maker/discount-codes/${id}`, { headers: authHeaders() }).then((r) => r.data);

// Messages — buyer ↔ maker DMs
// Public — guests can start a thread without signing in.
export const startMessageThread = (payload) =>
  http.post("/messages/start", payload).then((r) => r.data);

// Maker side
export const fetchMakerThreads = (folder = "inbox", q = "") =>
  http.get("/messages/maker/threads", {
    headers: authHeaders(), params: { folder, q },
  }).then((r) => r.data);
export const fetchMakerThread = (id) =>
  http.get(`/messages/maker/threads/${id}`, { headers: authHeaders() }).then((r) => r.data);
export const replyMakerThread = (id, body, attachment_ids = []) =>
  http.post(`/messages/maker/threads/${id}/reply`, { body, attachment_ids }, { headers: authHeaders() }).then((r) => r.data);
export const uploadMakerDmAttachment = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/messages/attachments", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};
export const patchMakerThread = (id, patch) =>
  http.patch(`/messages/maker/threads/${id}`, patch, { headers: authHeaders() }).then((r) => r.data);
export const bulkPatchMakerThreads = (thread_ids, patch) =>
  http.post("/messages/maker/threads/bulk", { thread_ids, ...patch }, { headers: authHeaders() }).then((r) => r.data);
export const emptyMakerTrash = () =>
  http.post("/messages/maker/threads/empty-trash", {}, { headers: authHeaders() }).then((r) => r.data);

// CSV Import
export const csvImportPreview = (file, source = "etsy") => {
  const fd = new FormData();
  fd.append("file", file); fd.append("source", source);
  return http.post("/maker/csv-import/preview", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};
export const csvImportCommit = (rows, publish_status = "draft", source = "etsy") =>
  http.post("/maker/csv-import/commit", { rows, publish_status, source },
    { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerProducts = () =>
  http.get("/maker/products", { headers: authHeaders() }).then((r) => r.data);
export const updateMakerProduct = (slug, payload) =>
  http.patch(`/maker/products/${slug}`, payload, { headers: authHeaders() }).then((r) => r.data);
export const previewMerchantFeed = (payload) =>
  http.post("/maker/merchant/preview", payload, { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerFeedQuality = () =>
  http.get("/maker/merchant/feed-quality", { headers: authHeaders() }).then((r) => r.data);
export const autofixMakerFeedQuality = () =>
  http.post("/maker/merchant/feed-quality/autofix", {}, { headers: authHeaders(), timeout: 120000 }).then((r) => r.data);
export const createMakerProduct = (payload) =>
  http.post("/maker/products", payload, { headers: authHeaders() }).then((r) => r.data);
export const deleteMakerProduct = (slug) =>
  http.delete(`/maker/products/${slug}`, { headers: authHeaders() }).then((r) => r.data);
export const restoreMakerProduct = (slug) =>
  http.post(`/maker/products/${slug}/restore`, {}, { headers: authHeaders() }).then((r) => r.data);
export const purgeMakerProduct = (slug) =>
  http.delete(`/maker/products/${slug}/purge`, { headers: authHeaders() }).then((r) => r.data);
export const publishMakerProduct = (slug) =>
  http.post(`/maker/products/${slug}/publish`, {}, { headers: authHeaders() }).then((r) => r.data);
export const unpublishMakerProduct = (slug) =>
  http.post(`/maker/products/${slug}/unpublish`, {}, { headers: authHeaders() }).then((r) => r.data);
export const uploadMakerModel = (file, onProgress) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/maker/uploads/model", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    onUploadProgress: onProgress,
  }).then((r) => r.data);
};
export const promoteMakerProduct = (slug, weeks = 1) =>
  http.post(`/maker/products/${slug}/promote?weeks=${weeks}`, {}, { headers: authHeaders() }).then((r) => r.data);
export const setAutoRenewPromotion = (slug, enabled) =>
  http.post(`/maker/products/${slug}/auto-renew-promotion`, { enabled }, { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerBoostCredits = () =>
  http.get("/maker/boost-credits", { headers: authHeaders() }).then((r) => r.data);
export const redeemBoostCredit = (creditId, productSlug) =>
  http.post(`/maker/boost-credits/${creditId}/redeem`, { product_slug: productSlug }, { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerPushStats = () =>
  http.get("/maker/push/stats", { headers: authHeaders() }).then((r) => r.data);
export const setMakerPushOnShipOptout = (optout) =>
  http.post("/maker/push/on-ship", { optout }, { headers: authHeaders() }).then((r) => r.data);

// iter334f — Weekly AI pricing digest opt-out
export const fetchPricingDigestPreference = () =>
  http.get("/maker/pricing-digest/preference", { headers: authHeaders() }).then((r) => r.data);
export const setPricingDigestPreference = (opt_out) =>
  http.post("/maker/pricing-digest/preference", { opt_out }, { headers: authHeaders() }).then((r) => r.data);

// iter334i — Inline pricing-verdict badges on the maker dashboard
export const fetchLatestPriceComparisons = (max_age_days = 60) =>
  http.get("/maker/pricing-comparisons/latest", {
    params: { max_age_days }, headers: authHeaders(),
  }).then((r) => r.data);

// iter334j — Batch AI Price Check across all maker listings
export const startBatchPriceCompare = () =>
  http.post("/maker/price-compare/batch", {}, { headers: authHeaders() }).then((r) => r.data);
export const fetchBatchPriceCompareJob = (job_id) =>
  http.get(`/maker/price-compare/jobs/${job_id}`, { headers: authHeaders() }).then((r) => r.data);

// iter373 — Admin SEO health monitor
export const fetchSeoHealthLatest = () =>
  http.get("/admin/seo-health/latest", { headers: adminAuthHeaders() }).then((r) => r.data);
export const runSeoHealthCheck = () =>
  http.post("/admin/seo-health/run", {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const runSeoHealthAutofix = () =>
  http.post("/admin/seo-health/autofix", {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchSeoWins = () =>
  http.get("/admin/seo-health/wins", { headers: adminAuthHeaders() }).then((r) => r.data);

// iter334l — Microsoft Ads ROAS tile (admin)
export const fetchMsftRoas = (days = 7) =>
  http.get("/admin/ads/msft-roas", { params: { days }, headers: adminAuthHeaders() }).then((r) => r.data);
export const recordMsftAdSpend = (amount_usd, period_days = 7, note = null) =>
  http.post("/admin/ads/msft-spend", { amount_usd, period_days, note }, { headers: adminAuthHeaders() }).then((r) => r.data);
// iter334u — Google Ads ROAS tile (admin) — live spend from synced ad_spend rows.
export const fetchGoogleRoas = (days = 7) =>
  http.get("/admin/ads/google-roas", { params: { days }, headers: adminAuthHeaders() }).then((r) => r.data);
// iter334v — Combined "All Ads ROAS" (Microsoft + Google + Meta).
export const fetchAllAdsRoas = (days = 7) =>
  http.get("/admin/ads/all-roas", { params: { days }, headers: adminAuthHeaders() }).then((r) => r.data);
// iter334x — Meta Ads ROAS tile (admin) — live spend from synced ad_spend rows.
export const fetchMetaRoas = (days = 7) =>
  http.get("/admin/ads/meta-roas", { params: { days }, headers: adminAuthHeaders() }).then((r) => r.data);
export const renewMakerProduct = (slug) =>
  http.post(`/maker/products/${slug}/renew`, {}, { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerProductsStats = () =>
  http.get("/maker/products/stats", { headers: authHeaders() }).then((r) => r.data);
// iter381 — most-picked variation options per listing (paid orders).
export const fetchMakerOptionStats = () =>
  http.get("/maker/products/option-stats", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerProductsIndexingStatus = () =>
  http.get("/maker/products/indexing-status", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerRenewalsSummary = () =>
  http.get("/maker/renewals/summary", { headers: authHeaders() }).then((r) => r.data);
export const bulkRenewMakerProducts = (slugs) =>
  http.post("/maker/products/bulk-renew", { slugs }, { headers: authHeaders() }).then((r) => r.data);
export const bulkSetRenewalOption = (slugs, renewal_option) =>
  http.post("/maker/products/bulk-renewal-option", { slugs, renewal_option }, { headers: authHeaders() }).then((r) => r.data);
export const bulkPauseMakerProducts = (slugs) =>
  http.post("/maker/products/bulk-pause", { slugs }, { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerBilling = () =>
  http.get("/maker/billing", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerPlusRoi = () =>
  http.get("/maker/plus/roi", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerCreditPacks = () =>
  http.get("/maker/credits/packs", { headers: authHeaders() }).then((r) => r.data);
export const startMakerCreditCheckout = (pack) =>
  http.post(`/maker/credits/checkout?pack=${encodeURIComponent(pack)}`, null, { headers: authHeaders() }).then((r) => r.data);
export const finalizeMakerCreditPurchase = (sessionId) =>
  http.post(`/maker/credits/finalize?session_id=${encodeURIComponent(sessionId)}`, null, { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerSubscription = () =>
  http.get("/maker/subscription", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerPlusAnalytics = () =>
  http.get("/maker/analytics/plus", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerCustomUrl = () =>
  http.get("/maker/custom-url", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerReferrals = () =>
  http.get("/maker/referrals", { headers: authHeaders() }).then((r) => r.data);
export const regenerateMakerReferralCode = () =>
  http.post("/maker/referrals/regenerate", {}, { headers: authHeaders() }).then((r) => r.data);
export const checkMakerCustomUrl = (candidate) =>
  http
    .get(`/maker/custom-url/check/${encodeURIComponent(candidate)}`, { headers: authHeaders() })
    .then((r) => r.data);
export const claimMakerCustomUrl = (custom_url) =>
  http
    .post("/maker/custom-url", { custom_url }, { headers: authHeaders() })
    .then((r) => r.data);
export const startMakerSubscription = () =>
  http.post("/maker/subscription/start", {}, { headers: authHeaders() }).then((r) => r.data);
export const cancelMakerSubscription = () =>
  http.post("/maker/subscription/cancel", {}, { headers: authHeaders() }).then((r) => r.data);
export const openMakerSubscriptionPortal = () =>
  http.post("/maker/subscription/portal", {}, { headers: authHeaders() }).then((r) => r.data);
export const settleMakerLedgerNow = () =>
  http.post("/maker/billing/settle-now", {}, { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerPayoutSchedule = () =>
  http.get("/maker/payout-schedule", { headers: authHeaders() }).then((r) => r.data);
export const uploadMakerBanner = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/maker/uploads/banner", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};
export const uploadMakerPortrait = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/maker/uploads/portrait", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};
export const uploadMakerCover = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/maker/uploads/cover", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};
export const updateMakerExternalAdsOptOut = (opt_out) =>
  http.patch("/maker/profile", { external_ads_opt_out: opt_out }, { headers: authHeaders() }).then((r) => r.data);
export const updateMakerProfile = (payload) =>
  http.patch("/maker/profile", payload, { headers: authHeaders() }).then((r) => r.data);

// ---------- Stripe Connect (Express) ----------
export const stripeConnectOnboard = (origin_url) =>
  http.post("/maker/stripe/connect/onboard", { origin_url },
    { headers: authHeaders() }).then((r) => r.data);
export const stripeConnectStatus = () =>
  http.get("/maker/stripe/connect/status",
    { headers: authHeaders() }).then((r) => r.data);
export const stripeConnectDashboardLink = () =>
  http.post("/maker/stripe/connect/dashboard-link", {},
    { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerPayouts = () =>
  http.get("/maker/payouts", { headers: authHeaders() }).then((r) => r.data);

// ---------- Admin Console ----------
const adminAuthHeaders = () => {
  const t = localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
export const fetchAdminAnalytics = () =>
  http.get("/admin/analytics", { headers: adminAuthHeaders() }).then((r) => r.data);

// ---------- Backorders ----------
export const fetchBackorderPolicy = (slug) =>
  http.get(`/products/${slug}/backorder-policy`).then((r) => r.data);
export const submitBackorderRequest = (slug, payload) =>
  http.post(`/products/${slug}/backorder-request`, payload).then((r) => r.data);
export const fetchMakerBackorderRequests = () =>
  http.get("/maker/backorder-requests", { headers: authHeaders() }).then((r) => r.data);
export const acceptBackorderRequest = (id) =>
  http.post(`/maker/backorder-requests/${id}/accept`, {}, { headers: authHeaders() }).then((r) => r.data);
export const declineBackorderRequest = (id, decline_reason = "") =>
  http.post(`/maker/backorder-requests/${id}/decline`, { decline_reason }, { headers: authHeaders() }).then((r) => r.data);
export const fulfillBackorderRequest = (id) =>
  http.post(`/maker/backorder-requests/${id}/fulfill`, {}, { headers: authHeaders() }).then((r) => r.data);

// ---------- Restock waitlist (lighter-weight than backorders) ----------
export const joinRestockWaitlist = (slug, payload) =>
  http.post(`/products/${slug}/restock-waitlist`, payload).then((r) => r.data);
export const fetchMakerRestockWaitlist = () =>
  http.get("/maker/restock-waitlist", { headers: authHeaders() }).then((r) => r.data);

// ---------- Workshop Analytics Dashboard (isolated namespace) ----------
const fetchWorkshop = (path) =>
  http.get(`/workshop-analytics${path}`, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchWorkshopOverview = (range_days) =>
  http.get(`/workshop-analytics/overview`, {
    headers: adminAuthHeaders(),
    params: range_days ? { range_days } : {},
  }).then((r) => r.data);
export const fetchWorkshopSales = () => fetchWorkshop("/sales");
export const fetchWorkshopSellers = () => fetchWorkshop("/sellers");
export const fetchWorkshopUsers = () => fetchWorkshop("/users");
export const fetchWorkshopLive = () => fetchWorkshop("/live");
export const fetchWorkshopTraffic = () => fetchWorkshop("/traffic");
export const fetchWorkshopPageviews = () => fetchWorkshop("/pageviews");
export const fetchAdminWebAnalytics = () =>
  http.get("/admin/analytics/web", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminLiveNow = () =>
  http.get("/admin/analytics/live", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminSeoLandingAnalytics = (days = 30) =>
  http
    .get("/admin/analytics/seo-landing", { params: { days }, headers: adminAuthHeaders() })
    .then((r) => r.data);
export const fetchAdminMakerAnalytics = (slug) =>
  http.get(`/admin/maker-analytics/${slug}`, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminCommunityUsers = () =>
  http.get("/admin/community-users", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminModerationUsers = ({ q, status, limit = 100 } = {}) =>
  http
    .get("/admin/users", { params: { q, status, limit }, headers: adminAuthHeaders() })
    .then((r) => r.data);
export const adminModerateUser = (user_id, status, reason = "") =>
  http
    .post(`/admin/users/${user_id}/moderate`, { status, reason }, { headers: adminAuthHeaders() })
    .then((r) => r.data);
export const adminDeleteUser = (user_id) =>
  http.delete(`/admin/users/${user_id}`, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminPatchProduct = (slug, payload) =>
  http.patch(`/admin/products/${slug}`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminDeleteProduct = (slug) =>
  http.delete(`/admin/products/${slug}`, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminCreateReview = (payload) =>
  http.post("/admin/reviews", payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminDeleteReview = (id) =>
  http.delete(`/admin/reviews/${id}`, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminRefireOrderEmails = (session_id) =>
  http
    .post(`/admin/orders/${session_id}/refire-emails`, {}, { headers: adminAuthHeaders() })
    .then((r) => r.data);
export const adminRunPlusRoiDigest = (apply = false) =>
  http
    .post(`/admin/digests/plus-roi`, {}, { params: { apply }, headers: adminAuthHeaders() })
    .then((r) => r.data);

// iter334h — Pricing digest admin tooling
export const adminRunPricingDigest = (dry_run = true, only_maker = null) =>
  http.post("/admin/pricing-digest/run", { dry_run, only_maker }, { headers: adminAuthHeaders() })
    .then((r) => r.data);
export const fetchPricingDigestHistory = (weeks = 8) =>
  http.get("/admin/pricing-digest/history", { params: { weeks }, headers: adminAuthHeaders() })
    .then((r) => r.data);

// ---------- Site settings (public + admin) ----------
export const fetchSiteSettings = () => http.get("/settings").then((r) => r.data);
export const submitBetaFeedback = (payload) =>
  http.post("/feedback", payload).then((r) => r.data);
export const fetchAdminSettings = () =>
  http.get("/admin/settings", { headers: adminAuthHeaders() }).then((r) => r.data);
export const patchAdminSettings = (payload) =>
  http.patch("/admin/settings", payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminClearAllChat = () =>
  http.post("/admin/chat/clear-all", {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminClearIdleChat = (minutes) =>
  http
    .post("/admin/chat/clear-idle", {}, { params: minutes ? { minutes } : {}, headers: adminAuthHeaders() })
    .then((r) => r.data);
export const fetchAdminFeedback = (resolved) =>
  http
    .get("/admin/feedback", { params: resolved !== undefined ? { resolved } : {}, headers: adminAuthHeaders() })
    .then((r) => r.data);
export const adminResolveFeedback = (id) =>
  http.post(`/admin/feedback/${id}/resolve`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);

// ---------- Maker reviews + disputes ----------
export const fetchMakerReviews = () =>
  http.get("/maker/reviews", { headers: authHeaders() }).then((r) => r.data);
export const postMakerReviewResponse = (reviewId, response) =>
  http.post(`/maker/reviews/${reviewId}/response`, { response }, { headers: authHeaders() }).then((r) => r.data);
export const createReviewDispute = (reviewId, payload) =>
  http.post(`/maker/reviews/${reviewId}/dispute`, payload, { headers: authHeaders() }).then((r) => r.data);

// ---------- Maker review CSV imports (iter183) ----------
export const importMakerReviewsCsv = (file, { source = "csv", publishedPublicly = true } = {}) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("source", source);
  fd.append("published_publicly", publishedPublicly ? "true" : "false");
  return http
    .post("/maker/reviews/import", fd, {
      headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};
export const previewMakerReviewsImport = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http
    .post("/maker/reviews/import/preview", fd, {
      headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};
export const listMakerReviewImports = () =>
  http.get("/maker/reviews/imports", { headers: authHeaders() }).then((r) => r.data);
export const patchMakerReviewImport = (batchId, publishedPublicly) =>
  http
    .patch(`/maker/reviews/imports/${batchId}`, { published_publicly: publishedPublicly }, { headers: authHeaders() })
    .then((r) => r.data);
export const deleteMakerReviewImport = (batchId) =>
  http
    .delete(`/maker/reviews/imports/${batchId}`, { headers: authHeaders() })
    .then((r) => r.data);
export const sendReviewCsvToSupport = (file, note = "") => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("note", note || "");
  return http
    .post("/maker/reviews/import/send-to-support", fd, {
      headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

// ---------- Maker workshop videos (iter186) ----------
export const fetchMakerWorkshopVideos = () =>
  http.get("/maker/workshop-videos", { headers: authHeaders() }).then((r) => r.data);
export const addMakerWorkshopVideo = (url, title = "") =>
  http
    .post("/maker/workshop-videos", { url, title: title || null }, { headers: authHeaders() })
    .then((r) => r.data);
export const deleteMakerWorkshopVideo = (videoRowId) =>
  http
    .delete(`/maker/workshop-videos/${videoRowId}`, { headers: authHeaders() })
    .then((r) => r.data);
export const reorderMakerWorkshopVideos = (videoIds) =>
  http
    .patch("/maker/workshop-videos/reorder", { video_ids: videoIds }, { headers: authHeaders() })
    .then((r) => r.data);

// ---------- Admin review disputes ----------
export const fetchAdminReviewDisputes = (status) =>
  http.get("/admin/review-disputes", {
    params: status ? { status } : {},
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
export const adminResolveReviewDispute = (id, payload) =>
  http.post(`/admin/review-disputes/${id}/resolve`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);

// ---------- Prod health watchdog (iter93) ----------
export const fetchAdminProdHealth = () =>
  http.get("/admin/prod-health", { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminProdHealthCheckNow = () =>
  http.post("/admin/prod-health/check-now", {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminCacheStats = () =>
  http.get("/admin/cache/stats", { headers: adminAuthHeaders() }).then((r) => r.data);
export const clearAdminCache = () =>
  http.post("/admin/cache/clear", {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminPricingLabelStats = (days = 14) =>
  http.get("/admin/experiments/pricing-label/stats", { params: { days }, headers: adminAuthHeaders() }).then((r) => r.data);

// ---------- Updates digest subscription (iter96) ----------
export const subscribeToUpdates = (email, name) =>
  http.post("/updates/subscribe", { email, name }).then((r) => r.data);

// ---------- Admin updates digest controls (iter97) ----------
export const fetchAdminUpdatesPreview = () =>
  http.get("/admin/updates/preview", { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminUpdatesDispatch = ({ dry_run = false, force = false } = {}) =>
  http.post("/admin/updates/dispatch", null, {
    headers: adminAuthHeaders(),
    params: { dry_run, force },
  }).then((r) => r.data);

// ---------- Admin growth stats (iter100) ----------
export const fetchAdminGrowthStats = () =>
  http.get("/admin/growth-stats", { headers: adminAuthHeaders() }).then((r) => r.data);

// ---------- Public Contact form + admin inbox ----------
export const sendContactMessage = (payload) =>
  http.post("/contact-messages", payload).then((r) => r.data);
export const fetchAdminContactMessages = (resolved, topic) =>
  http
    .get("/admin/contact-messages", {
      params: {
        ...(resolved !== undefined ? { resolved } : {}),
        ...(topic ? { topic } : {}),
      },
      headers: adminAuthHeaders(),
    })
    .then((r) => r.data);
export const adminResolveContactMessage = (id) =>
  http.post(`/admin/contact-messages/${id}/resolve`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminReplyContactMessage = (id, payload) =>
  http.post(`/admin/contact-messages/${id}/reply`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchFollowStatus = (maker_slug, jwt) => {
  const headers = jwt ? { Authorization: `Bearer ${jwt}` } : {};
  return http.get(`/makers/${maker_slug}/follow-status`, { headers }).then((r) => r.data);
};
export const fetchFollowersList = (maker_slug, limit = 24) =>
  http.get(`/makers/${maker_slug}/followers`, { params: { limit } }).then((r) => r.data);
export const followMaker = (maker_slug, jwt) =>
  http
    .post(`/makers/${maker_slug}/follow`, {}, { headers: { Authorization: `Bearer ${jwt}` } })
    .then((r) => r.data);
export const unfollowMaker = (maker_slug, jwt) =>
  http
    .delete(`/makers/${maker_slug}/follow`, { headers: { Authorization: `Bearer ${jwt}` } })
    .then((r) => r.data);

export const fetchAdminAuditLog = (limit = 200) =>
  http.get("/admin/audit-log", { params: { limit }, headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminAIModLog = (limit = 100) =>
  http.get("/admin/ai-mod-log", { params: { limit }, headers: adminAuthHeaders() }).then((r) => r.data);

// ---------- Ad spend (Google + Meta) ----------
export const fetchAdsMetrics = (params = {}) =>
  http.get("/admin/ads/metrics", { params, headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdsPerformance = (days = 30) =>
  http.get("/admin/ads/performance", { params: { days }, headers: adminAuthHeaders() }).then((r) => r.data);
export const adminSeedAdsDemo = (days = 14) =>
  http.post("/admin/ads/seed-demo", {}, { params: { days }, headers: adminAuthHeaders() }).then((r) => r.data);
export const adminClearAdsDemo = () =>
  http.delete("/admin/ads/clear-demo", { headers: adminAuthHeaders() }).then((r) => r.data);

// ---------- Buffer (social media) ----------
export const fetchBufferStatus = () =>
  http.get("/admin/buffer/status", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchBufferPosts = (limit = 50) =>
  http.get("/admin/buffer/posts", { params: { limit }, headers: adminAuthHeaders() }).then((r) => r.data);
export const adminBufferPost = (payload) =>
  http.post("/admin/buffer/post", payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminBufferBackfill5star = (payload) =>
  http.post("/admin/buffer/backfill-5star-reviews", payload || {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const makerShareListingToBuffer = (slug) =>
  http
    .post(`/maker/buffer/share-listing/${slug}`, {}, { headers: authHeaders() })
    .then((r) => r.data);

// 9:16 Instagram/TikTok story PNG. The endpoint returns a binary
// `image/png` stream so we don't go through the JSON-aware `http`
// instance — we just expose the URL and let the browser handle the
// download via an anchor tag (preserves Content-Disposition filename).
export const productStoryCardUrl = (slug) =>
  `${API}/products/${encodeURIComponent(slug)}/story-card.png`;
export const downloadProductStoryCard = (slug) => {
  const url = productStoryCardUrl(slug);
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  // The server already sets Content-Disposition with the slug-based
  // filename; this is the fallback for browsers that ignore it on
  // same-origin downloads.
  a.download = `${slug}-story.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// ---------- Maker journal authoring ----------
// Lets a vetted maker author a journal post directly. Posts land in
// the same /api/blog feed buyers browse on /journal — no admin queue,
// makers wear their own reputation.
export const createMakerJournalPost = (payload) =>
  http.post("/maker/journal", payload, { headers: authHeaders() }).then((r) => r.data);
export const fetchMyMakerJournalPosts = () =>
  http.get("/maker/journal/mine", { headers: authHeaders() }).then((r) => r.data);
export const deleteMakerJournalPost = (slug) =>
  http.delete(`/maker/journal/${encodeURIComponent(slug)}`, { headers: authHeaders() })
    .then((r) => r.data);

// Public list of one maker's journal posts — no auth, surfaced on
// /makers/<slug> as a "More from this maker" rail.
export const fetchMakerJournalPosts = (makerSlug, limit = 6) =>
  http.get(`/makers/${encodeURIComponent(makerSlug)}/blog`,
    { params: { limit } }
  ).then((r) => r.data);

// Upload an image attached to a journal post — multipart/form-data, R2-
// backed. Returns `{ url }`. Editor inlines the URL as a markdown
// image tag (`![](url)`) at the cursor position.
export const uploadMakerJournalImage = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/maker/journal/upload-image", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};
// Single live integration the admin connects through OAuth from the
// Ads tab. Backend writes synced rows into the same `ad_spend`
// collection that the existing tab already renders.
// ---------- Google Ads integration ----------
// Single live integration the admin connects through OAuth from the
// Ads tab. Backend writes synced rows into the same `ad_spend`
// collection that the existing tab already renders.
export const fetchGoogleAdsStatus = () =>
  http.get("/admin/integrations/google-ads/status",
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const startGoogleAdsOauth = () =>
  http.get("/admin/integrations/google-ads/oauth/start",
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const disconnectGoogleAds = () =>
  http.post("/admin/integrations/google-ads/disconnect", {},
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const triggerGoogleAdsSync = (date) =>
  http.post("/admin/integrations/google-ads/sync",
    {},
    { params: date ? { date } : {}, headers: adminAuthHeaders() }
  ).then((r) => r.data);
export const backfillGoogleAds = (days = 30) =>
  http.post("/admin/integrations/google-ads/backfill",
    {},
    { params: { days }, headers: adminAuthHeaders(), timeout: 600000 }
  ).then((r) => r.data);

// iter334w — Microsoft Ads (Bing) integration. Same shape as Google.
export const fetchMicrosoftAdsStatus = () =>
  http.get("/admin/integrations/microsoft-ads/status",
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const startMicrosoftAdsOauth = () =>
  http.get("/admin/integrations/microsoft-ads/oauth/start",
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const disconnectMicrosoftAds = () =>
  http.post("/admin/integrations/microsoft-ads/disconnect", {},
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const triggerMicrosoftAdsSync = (date) =>
  http.post("/admin/integrations/microsoft-ads/sync",
    {},
    { params: date ? { date } : {}, headers: adminAuthHeaders() }
  ).then((r) => r.data);
export const backfillMicrosoftAds = (days = 30) =>
  http.post("/admin/integrations/microsoft-ads/backfill",
    {},
    { params: { days }, headers: adminAuthHeaders(), timeout: 600000 }
  ).then((r) => r.data);

// ---------- Meta Ads integration ----------
// Same shape as Google Ads — separate provider, separate token, but
// rows land in the same `ad_spend` ledger so the AdsTab dashboard
// renders both side-by-side automatically.
export const fetchMetaAdsStatus = () =>
  http.get("/admin/integrations/meta-ads/status",
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const startMetaAdsOauth = () =>
  http.get("/admin/integrations/meta-ads/oauth/start",
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const disconnectMetaAds = () =>
  http.post("/admin/integrations/meta-ads/disconnect", {},
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const triggerMetaAdsSync = (date) =>
  http.post("/admin/integrations/meta-ads/sync",
    {},
    { params: date ? { date } : {}, headers: adminAuthHeaders() }
  ).then((r) => r.data);
export const backfillMetaAds = (days = 30) =>
  http.post("/admin/integrations/meta-ads/backfill",
    {},
    { params: { days }, headers: adminAuthHeaders(), timeout: 600000 }
  ).then((r) => r.data);
export const fetchAdAttributionHealth = () =>
  http.get("/admin/ads/attribution-health",
    { headers: adminAuthHeaders() }
  ).then((r) => r.data);

// ---------- Newsletter (Kit.com) ----------
export const subscribeNewsletter = (email, source = "homepage") =>
  http.post("/newsletter/subscribe", { email, source }).then((r) => r.data);
export const fetchNewsletterSubscribers = (limit = 200) =>
  http
    .get("/admin/newsletter/subscribers", { params: { limit }, headers: adminAuthHeaders() })
    .then((r) => r.data);

// ---------- Admin: cohort retention ----------
export const fetchAdminCohorts = (weeks = 12) =>
  http.get("/admin/analytics/cohorts", { params: { weeks }, headers: adminAuthHeaders() })
    .then((r) => r.data);

// ---------- Admin: drop saves ----------
export const fetchAdminDropSaves = (maker_slug, limit = 200) =>
  http.get("/admin/drop-saves", {
    params: { maker_slug: maker_slug || undefined, limit },
    headers: adminAuthHeaders(),
  }).then((r) => r.data);

// ---------- Admin: per-channel chat moderation ----------
export const fetchAdminChatMessages = (channel, limit = 100) =>
  http
    .get("/admin/chat/messages", {
      params: { channel, limit }, headers: adminAuthHeaders(),
    })
    .then((r) => r.data);
export const adminChatDeleteMessage = (id) =>
  http
    .delete(`/admin/chat/messages/${id}`, { headers: adminAuthHeaders() })
    .then((r) => r.data);
export const fetchAdminChatMutes = () =>
  http.get("/admin/chat/mutes", { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminChatMute = (payload) =>
  http.post("/admin/chat/mute", payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminChatUnmute = (email, channel) =>
  http
    .delete(`/admin/chat/mute/${encodeURIComponent(email)}/${encodeURIComponent(channel)}`, {
      headers: adminAuthHeaders(),
    })
    .then((r) => r.data);
export const requestAdminLink = (email, origin_url) =>
  http.post("/admin/auth/request", { email, origin_url }).then((r) => r.data);
export const verifyAdminToken = (token) =>
  http.post("/admin/auth/verify", { token }).then((r) => r.data);
export const fetchAdminMe = () =>
  http.get("/admin/me", { headers: adminAuthHeaders() }).then((r) => r.data);

// Admin team / RBAC
export const fetchAdminTeam = () =>
  http.get("/admin/team", { headers: adminAuthHeaders() }).then((r) => r.data);
export const inviteAdmin = (email, capabilities, note) =>
  http.post("/admin/team", { email, capabilities, note }, { headers: adminAuthHeaders() }).then((r) => r.data);
export const updateAdminCaps = (email, patch) =>
  http.patch(`/admin/team/${encodeURIComponent(email)}`, patch, { headers: adminAuthHeaders() }).then((r) => r.data);
export const revokeAdmin = (email) =>
  http.delete(`/admin/team/${encodeURIComponent(email)}`, { headers: adminAuthHeaders() }).then((r) => r.data);

// Featured-example (platform seed) management. Used by the "Purge featured
// content" card under Admin → Settings once organic listings fill the
// catalogue and the seeded examples are no longer needed.
export const fetchFeaturedSeedStatus = () =>
  http.get("/admin/seed/featured-content/status", { headers: adminAuthHeaders() }).then((r) => r.data);
export const purgeFeaturedSeed = () =>
  http.post("/admin/seed/featured-content/purge", null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const attributeWorkshopTeam = () =>
  http.post("/admin/seed/featured-content/attribute-workshop-team", null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const runWeeklyForumThread = () =>
  http.post("/admin/seed/featured-content/run-weekly-thread", null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const installFeaturedSeedFixture = () =>
  http.post("/admin/seed/featured-content/install-fixture", null, { headers: adminAuthHeaders() }).then((r) => r.data);

// Community-design seed (the AI-generated Workshop Team design library
// that lands in the existing `design_files` collection). Mirrors the
// featured-content seed APIs so the admin UI can offer a one-click
// install / status / purge flow.
export const fetchCommunityDesignsSeedStatus = () =>
  http.get("/admin/seed/community-designs/status", { headers: adminAuthHeaders() }).then((r) => r.data);
export const installCommunityDesignsSeed = () =>
  http.post("/admin/seed/community-designs/install-fixture", null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const purgeCommunityDesignsSeed = () =>
  http.post("/admin/seed/community-designs/purge", null, { headers: adminAuthHeaders() }).then((r) => r.data);
// iter221 — orphan-only cleanup (preserves verified seeds + organic uploads).
export const purgeOrphanCommunityDesignsSeed = () =>
  http.post("/admin/seed/community-designs/purge-orphans", null, { headers: adminAuthHeaders() }).then((r) => r.data);

// iter262 — Re-upload local seed design files to R2 so they survive pod restarts.
// Returns {migrated, orphaned_marked, failed[]}.
export const migrateCommunityDesignsToR2 = () =>
  http.post("/admin/seed/community-designs/migrate-to-r2", null, { headers: adminAuthHeaders() }).then((r) => r.data);

// iter222 — Stripe Connect health probe.
export const fetchStripeDiag = () =>
  http.get("/admin/stripe/diag", { headers: adminAuthHeaders() }).then((r) => r.data);

// iter231 — Admin showcase curation (pin / hide / reorder / shuffle). The
// admin list includes hidden posts; the public /community/showcase route
// already filters them out.
export const fetchAdminShowcase = () =>
  http.get("/admin/showcase", { headers: adminAuthHeaders() }).then((r) => r.data);
export const toggleShowcasePin = (id) =>
  http.post(`/admin/showcase/${id}/pin`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const toggleShowcaseHide = (id) =>
  http.post(`/admin/showcase/${id}/hide`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const moveShowcaseUp = (id) =>
  http.post(`/admin/showcase/${id}/move-up`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const moveShowcaseDown = (id) =>
  http.post(`/admin/showcase/${id}/move-down`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const shuffleShowcase = () =>
  http.post("/admin/showcase/shuffle", {}, { headers: adminAuthHeaders() }).then((r) => r.data);

// iter251 — push a showcase post or clip to Buffer's social queue.
export const shareShowcaseToBuffer = (postId) =>
  http.post(`/admin/buffer/share-showcase/${postId}`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const shareClipToBuffer = (slug) =>
  http.post(`/admin/buffer/share-clip/${slug}`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);

// iter226 — Integration diagnostics (Shippo / Mailgun / R2 — same friendly-error pattern).
export const fetchShippoDiag = () =>
  http.get("/admin/shippo/diag", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchMailgunDiag = () =>
  http.get("/admin/mailgun/diag", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchR2Diag = () =>
  http.get("/admin/r2/diag", { headers: adminAuthHeaders() }).then((r) => r.data);

// iter226 — GA4 Live Analytics. All endpoints are admin-only, push the
// gRPC GA4 client through a threadpool on the backend. The frontend
// polls realtime on a short interval; summary/top-* are refreshed on
// an explicit "↻" click since GA4 quota is shared per-property.
export const fetchGa4Diag = () =>
  http.get("/admin/ga4/diag", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchGa4Realtime = () =>
  http.get("/admin/ga4/realtime", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchGa4Summary7d = () =>
  http.get("/admin/ga4/summary-7d", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchGa4TopPages7d = (limit = 10) =>
  http.get("/admin/ga4/top-pages-7d", { params: { limit }, headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchGa4TopSources7d = (limit = 10) =>
  http.get("/admin/ga4/top-sources-7d", { params: { limit }, headers: adminAuthHeaders() }).then((r) => r.data);

// ─── Clip Feed (TikTok-for-makers) ──────────────────────────────────────
// Public feed + engagement helpers. Auth headers attach the buyer/maker
// JWT when present so the i_liked / i_saved flags resolve correctly.
const _anyAuth = () => {
  const t = localStorage.getItem("cm_buyer_jwt")
    || localStorage.getItem("cm_maker_jwt")
    || localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
export const fetchClipCategories = () =>
  http.get("/clips/categories").then((r) => r.data);
export const fetchClipsIncentiveStatus = () =>
  http.get("/clips/incentive-status").then((r) => r.data);
export const fetchClipFeed = ({ category, cursor, limit = 12 } = {}) =>
  http.get("/clips/feed", {
    params: { category, cursor, limit },
    headers: _anyAuth(),
  }).then((r) => r.data);
export const recordClipView = (clipId) =>
  http.post(`/clips/${clipId}/view`).then((r) => r.data);
export const recordClipShare = (clipId) =>
  http.post(`/clips/${clipId}/share`).then((r) => r.data);
export const toggleClipLike = (clipId) =>
  http.post(`/clips/${clipId}/like`, null, { headers: _anyAuth() }).then((r) => r.data);
export const toggleClipSave = (clipId) =>
  http.post(`/clips/${clipId}/save`, null, { headers: _anyAuth() }).then((r) => r.data);
export const fetchMySavedClips = () =>
  http.get("/clips/me/saved", { headers: _anyAuth() }).then((r) => r.data);
// Maker side
const _makerAuth = () => ({ Authorization: `Bearer ${localStorage.getItem("cm_maker_jwt") || ""}` });
export const fetchMyClips = () =>
  http.get("/maker/clips/mine", { headers: _makerAuth() }).then((r) => r.data);
export const createClipFromUrl = (payload) =>
  http.post("/maker/clips", payload, { headers: _makerAuth() }).then((r) => r.data);
export const uploadClipFile = (file, fields, onUploadProgress) => {
  // Native file upload to R2 via the backend. `fields` =
  // { title, description, category, tags, product_slug }. Backend handles
  // the multipart body + extracts a poster frame with ffmpeg.
  const fd = new FormData();
  fd.append("file", file);
  Object.entries(fields || {}).forEach(([k, v]) => fd.append(k, v ?? ""));
  return http.post("/maker/clips/upload", fd, {
    headers: { ..._makerAuth(), "Content-Type": "multipart/form-data" },
    timeout: 300000,
    onUploadProgress,
  }).then((r) => r.data);
};
export const deleteMyClip = (clipId) =>
  http.delete(`/maker/clips/${clipId}`, { headers: _makerAuth() }).then((r) => r.data);
// Admin seed
export const fetchClipsSeedStatus = () =>
  http.get("/admin/seed/clips/status", { headers: adminAuthHeaders() }).then((r) => r.data);
// iter310 — generate-one now enqueues a background job + returns {job_id}.
// Long-running Sora-2 renders no longer block the HTTP request, which
// dies behind Cloudflare's ~100s edge timeout on craftersmarket.org.
export const generateOneClipSeed = (model = "sora-2") =>
  http.post(`/admin/seed/clips/generate-one?model=${encodeURIComponent(model)}`, null, {
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
export const fetchClipSeedJob = (jobId) =>
  http.get(`/admin/seed/clips/job/${encodeURIComponent(jobId)}`, {
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
export const fetchRecentClipSeedJobs = (limit = 5) =>
  http.get(`/admin/seed/clips/jobs/recent?limit=${limit}`, {
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
export const purgeClipsSeed = () =>
  http.post("/admin/seed/clips/purge", null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const purgeOrphanClipsSeed = () =>
  http.post("/admin/seed/clips/purge-orphans", null, { headers: adminAuthHeaders() }).then((r) => r.data);

// iter220 — Rotating hero headlines.
export const fetchHeroHeadlines = () => http.get("/hero/headlines").then((r) => r.data);
export const adminListHeroHeadlines = () =>
  http.get("/admin/hero/headlines/list", { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminRefreshHeroHeadlines = () =>
  http.post("/admin/hero/headlines/refresh", null, {
    headers: adminAuthHeaders(),
    timeout: 60000,
  }).then((r) => r.data);
export const adminPinHeroHeadline = (id) =>
  http.post(`/admin/hero/headlines/pin/${id}`, null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminUnpinHeroHeadlines = () =>
  http.post("/admin/hero/headlines/unpin", null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminArchiveHeroHeadline = (id) =>
  http.post(`/admin/hero/headlines/archive/${id}`, null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminRestoreHeroHeadline = (id) =>
  http.post(`/admin/hero/headlines/restore/${id}`, null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminCreateHeroHeadline = (body) =>
  http.post("/admin/hero/headlines/create", body, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminDeleteHeroHeadline = (id) =>
  http.delete(`/admin/hero/headlines/${id}`, { headers: adminAuthHeaders() }).then((r) => r.data);

// Operator ops checklist helpers
export const fetchOgDiag = () => http.get("/og/diag").then((r) => r.data);
export const fetchSeoDiag = () => http.get("/seo/diag").then((r) => r.data);
export const adminPingIndexNow = () =>
  http.post("/admin/seo/ping", null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const generateOneCommunityDesign = () =>
  http.post("/admin/seed/community-designs/generate-one", null, { headers: adminAuthHeaders(), timeout: 120000 }).then((r) => r.data);
export const generateBatchCommunityDesigns = (count = 5) =>
  http.post(`/admin/seed/community-designs/generate-batch?count=${count}`, null, { headers: adminAuthHeaders(), timeout: 600000 }).then((r) => r.data);

// AI Discovery — "describe what you want" natural-language search.
// Returns matched products w/ a per-result `match_reason`. Public
// endpoint — no auth headers needed.
export const aiDiscoverySearch = (q) =>
  http.post("/ai/discovery/search", { q }).then((r) => r.data);
// AI Maker Matching — given a custom-order brief, returns the top 3
// makers most likely to deliver well. Used on /custom-order step 2.
export const aiMatchMakers = (payload) =>
  http.post("/ai/discovery/match-makers", payload).then((r) => r.data);
// AI Similar Products — drives the "More like this" rail on product
// detail pages.
export const aiSimilarProducts = (slug) =>
  http.get(`/ai/discovery/similar-products/${encodeURIComponent(slug)}`).then((r) => r.data);

// Video upload (R2)
export const uploadMakerVideo = (file, onProgress) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/maker/uploads/video", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    onUploadProgress: onProgress,
  }).then((r) => r.data);
};

// Listing photo upload (R2) — eager upload so listing save/publish payloads
// stay small. Returns { url, size }. Accepts a Blob OR File.
export const uploadMakerListingImage = (blob, onProgress) => {
  const fd = new FormData();
  // R2 endpoint reads `file.content_type`; FormData uses the Blob's `type`
  // for that, so callers must pass a typed Blob (image/jpeg, image/png, …).
  fd.append("file", blob, blob?.name || "photo.jpg");
  return http.post("/maker/uploads/listing-image", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    onUploadProgress: onProgress,
    // Generous timeout — watermarking large photos can take a few seconds.
    timeout: 60_000,
  }).then((r) => r.data);
};

// iter413cx — Listing Video · Phase 1. Single MP4/MOV per listing.
// Returns {url, duration, size, content_type}. Server validates MIME +
// size (≤100MB) + duration (≤60s via ffprobe).
export const uploadMakerListingVideo = (file, onProgress) => {
  const fd = new FormData();
  fd.append("file", file, file?.name || "video.mp4");
  return http.post("/maker/uploads/video", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    onUploadProgress: onProgress,
    timeout: 180_000, // 3 min — large videos may take a while
  }).then((r) => r.data);
};

// Clone listing
export const duplicateMakerProduct = (slug) =>
  http.post(`/maker/products/${slug}/duplicate`, null, { headers: authHeaders() }).then((r) => r.data);

// Refund approvals (two-person rule)
export const fetchRefundApprovals = (status = "pending") =>
  http.get(`/admin/refund-approvals?status=${status}`, { headers: adminAuthHeaders() }).then((r) => r.data);
export const approveRefund = (id) =>
  http.post(`/admin/refund-approvals/${id}/approve`, null, { headers: adminAuthHeaders() }).then((r) => r.data);
export const denyRefund = (id) =>
  http.post(`/admin/refund-approvals/${id}/deny`, null, { headers: adminAuthHeaders() }).then((r) => r.data);
// Refund: now returns either {requires_approval, approval_id} or final result
export const adminRefundOrder = (sessionId, approvalId = null) => {
  const url = approvalId
    ? `/admin/orders/${sessionId}/refund?approval_id=${encodeURIComponent(approvalId)}`
    : `/admin/orders/${sessionId}/refund`;
  return http.post(url, null, { headers: adminAuthHeaders() }).then((r) => r.data);
};
export const fetchDormantBuyers = (days = 60, limit = 200) =>
  http.get(`/admin/retention/dormant?days=${days}&limit=${limit}`, { headers: adminAuthHeaders() }).then((r) => r.data);
export const reengageDormantBuyers = (payload) =>
  http.post("/admin/retention/reengage", payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminApplications = () =>
  http.get("/admin/maker-applications", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminCustomOrders = () =>
  http.get("/admin/custom-orders", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminOrders = () =>
  http.get("/admin/orders", { headers: adminAuthHeaders() }).then((r) => r.data);
export const decideMakerApplication = (id, payload) =>
  http.patch(`/admin/maker-applications/${id}`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const deleteMakerApplication = (id) =>
  http.delete(`/admin/maker-applications/${id}`, { headers: adminAuthHeaders() }).then((r) => r.data);
// iter327 — Resend the applicant's confirm-email link. Idempotent: if
// the applicant is already verified, backend returns
// `{ok: true, already_verified: true}` without emailing anything.
export const resendApplicationVerification = (id) =>
  http.post(`/admin/maker-applications/${id}/resend-verification`, null,
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const toggleMakerBeta = (slug, enabled) =>
  http.post(`/admin/makers/${slug}/beta`, { enabled }, { headers: adminAuthHeaders() }).then((r) => r.data);
// iter413bv — Promote a Founding Access maker to permanent Founding
// Seller. Reuses the existing /admin/founders/promote endpoint. The
// `force_status: "inaugural"` flag grants the lifetime tier (no expiry).
export const promoteToFounder = (slug, { inaugural = true } = {}) =>
  http.post("/admin/founders/promote",
    { slug, force_status: inaugural ? "inaugural" : "regular" },
    { headers: adminAuthHeaders() }
  ).then((r) => r.data);

// iter413dg — Seller Success Dashboard ("Coach" tab). All three
// endpoints share the same payload shape Compass consumes — one
// source of truth between Compass, the dashboard, and future emails.
export const fetchListingsCoachingRollup = () =>
  http.get("/maker/listings-coaching/rollup", { headers: authHeaders() }).then((r) => r.data);

export const fetchListingCoaching = (slug) =>
  http.get(`/maker/listings/${slug}/coaching`, { headers: authHeaders() }).then((r) => r.data);

export const fetchListingCoachingTimeline = (slug, limit = 10) =>
  http.get(`/maker/listings/${slug}/coaching/timeline`, {
    headers: authHeaders(), params: { limit },
  }).then((r) => r.data);

// iter413dd — One-time Founder welcome modal ack. Called when the maker
// dismisses the celebration modal. Backend flips `founder_welcome_seen=true`
// so the modal never re-appears.
export const ackFounderWelcome = () =>
  http.post("/maker/founder-welcome/ack", {}, { headers: authHeaders() }).then((r) => r.data);

// iter413bw — Maker Brand Kit (Garage Builders identity).
export const applyBrandKit = () =>
  http.post("/maker/brand-kit/apply", {}, { headers: authHeaders() }).then((r) => r.data);
export const dismissBrandKit = () =>
  http.post("/maker/brand-kit/dismiss", {}, { headers: authHeaders() }).then((r) => r.data);
export const fetchAdminApprovedMakers = () =>
  http.get("/admin/makers/approved", { headers: adminAuthHeaders() }).then((r) => r.data);
// iter413az — Hard-purge an approved maker (super-admin only).
// Soft-deletes their listings + tags their payouts. Audit-logged.
export const purgeApprovedMaker = (slug) =>
  http.delete(`/admin/makers/${slug}`, { headers: adminAuthHeaders() }).then((r) => r.data);
// iter413az — Build the CSV download URL for the approved-maker
// directory. We can't just hit it with fetch + Authorization because
// the browser needs to handle the file download UX; the component
// adds a one-shot token query param via the JWT it already has.
export const approvedMakersCsvUrl = () => `${API}/admin/makers/approved.csv`;
// iter413bo — Enrich Labs weekly export (no PII) — manual trigger + status.
export const sendEnrichlabsExportNow = () =>
  http.post("/admin/makers/approved/enrichlabs-send", {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchEnrichlabsExportStatus = () =>
  http.get("/admin/makers/approved/enrichlabs-status", { headers: adminAuthHeaders() }).then((r) => r.data);

// iter413ca — Admin impersonation. Returns { token, target_type, target_sub,
// target_email, target_name, imp_by, expires_in_seconds }. The frontend
// caller is responsible for stashing the token + meta in localStorage and
// opening the target dashboard in a new tab.
export const adminImpersonateMaker = (slug) =>
  http.post("/admin/impersonate",
    { target_type: "maker", target_slug: slug },
    { headers: adminAuthHeaders() }
  ).then((r) => r.data);
export const adminImpersonateUser = (user_id) =>
  http.post("/admin/impersonate",
    { target_type: "buyer", target_user_id: user_id },
    { headers: adminAuthHeaders() }
  ).then((r) => r.data);

// iter413cb — File a bug observed mid-impersonation. Reads the admin's
// own JWT from localStorage (shared across tabs) because the active
// session in the impersonation tab is the target's JWT, not the admin's.
export const filImpersonationBugReport = (payload) =>
  http.post("/admin/impersonation-bug-report", payload, {
    headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
  }).then((r) => r.data);

// iter413bp — Operations Dashboard aggregator (admin landing page).
export const fetchOpsDashboardOverview = () =>
  http.get("/admin/ops-dashboard/overview", { headers: adminAuthHeaders() }).then((r) => r.data);
// iter413bz — Top stale-link surface for the Ops Dashboard.
export const fetchNotFoundRecent = () =>
  http.get("/admin/not-found/recent", { headers: adminAuthHeaders() }).then((r) => r.data);
// iter413cr — AI Operations Center: Top AI-diagnosed issues (card 1 of N).
export const fetchAiOpsIssues = (window_days = 7, limit = 12) =>
  http.get(`/admin/ops/ai-issues?window_days=${window_days}&limit=${limit}`, {
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
// iter413cs — Deployment Watch Window + cards 2 & 6 + Release Timeline.
export const fetchDeployWatchCurrent = () =>
  http.get("/admin/ops/deploy-watch/current", { headers: adminAuthHeaders() }).then((r) => r.data);
export const startDeployWatch = (build_id, ttl_hours = 48) =>
  http.post("/admin/ops/deploy-watch/start", { build_id, ttl_hours }, { headers: adminAuthHeaders() }).then((r) => r.data);
export const closeDeployWatch = (watch_id, notes) =>
  http.post("/admin/ops/deploy-watch/close", { watch_id, notes }, { headers: adminAuthHeaders() }).then((r) => r.data);
export const annotateDeployWatch = (watch_id, payload) =>
  http.post(`/admin/ops/deploy-watch/${encodeURIComponent(watch_id)}/annotate`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAiEmerging = (limit = 12) =>
  http.get(`/admin/ops/ai-emerging?limit=${limit}`, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchDeployHealth = () =>
  http.get("/admin/ops/deploy-health", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchReleaseTimeline = (q = "", limit = 25) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q && q.trim()) params.set("q", q.trim());
  return http.get(`/admin/ops/release-timeline?${params.toString()}`, {
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
};
// iter413bq — Dismiss / restore action-queue items per-admin.
export const dismissOpsItem = (item_id, mode = "24h", status_signature = null) =>
  http.post("/admin/ops-dashboard/dismiss",
    { item_id, mode, status_signature },
    { headers: adminAuthHeaders() }
  ).then((r) => r.data);
export const restoreOpsItem = (item_id) =>
  http.post("/admin/ops-dashboard/restore",
    { item_id },
    { headers: adminAuthHeaders() }
  ).then((r) => r.data);
export const fetchAdminRejectedApplications = () =>
  http.get("/admin/makers/rejected", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminPlusMembers = () =>
  http.get("/admin/makers/plus", { headers: adminAuthHeaders() }).then((r) => r.data);
export const emailMakerApplicant = (id, payload) =>
  http.post(`/admin/maker-applications/${id}/email`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const previewApplicationDecisionEmail = (id, { approved = true, note = "" } = {}) =>
  http.get(`/admin/maker-applications/${id}/preview-email`, {
    headers: adminAuthHeaders(),
    params: { approved, note },
  }).then((r) => r.data);
export const previewAdminBroadcast = (payload) =>
  http.post("/admin/broadcast/preview", payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const sendAdminBroadcast = (payload) =>
  http.post("/admin/broadcast/send", payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const quoteCustomOrder = (id, payload) =>
  http.patch(`/admin/custom-orders/${id}`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);


// ---------- AI Assistant ----------
export const aiChat = (payload) => http.post("/ai/chat", payload).then((r) => r.data);
export const aiSubmitBrief = (brief) => http.post("/ai/submit-brief", brief).then((r) => r.data);

// ---------- Help & Support (iter312, iter413cq) ----------
export const helpChat = (payload) => http.post("/help/chat", payload).then((r) => r.data);
export const fetchTopHelpQuestions = (days = 7, limit = 20) =>
  http.get(`/help/analytics/top-questions?days=${days}&limit=${limit}`).then((r) => r.data);
export const helpReportIssue = (payload) =>
  http.post("/help/report-issue", payload).then((r) => r.data);
export const fetchPlatformCapabilities = () =>
  http.get("/platform/capabilities").then((r) => r.data);

// ---------- Per-listing marketing budgets (iter315) ----------
export const fetchListingBudgets = () =>
  http.get("/maker/listing-budgets", { headers: _makerAuth() }).then((r) => r.data);
export const upsertListingBudget = (productSlug, body) =>
  http.put(`/maker/listing-budgets/${encodeURIComponent(productSlug)}`, body, {
    headers: _makerAuth(),
  }).then((r) => r.data);
export const deleteListingBudget = (productSlug) =>
  http.delete(`/maker/listing-budgets/${encodeURIComponent(productSlug)}`, {
    headers: _makerAuth(),
  }).then((r) => r.data);

// ---------- Admin lead-magnet inbox + drip (iter316) ----------
export const fetchAdminLeadMagnetSummary = () =>
  http.get("/admin/lead-magnet/summary", {
    headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
  }).then((r) => r.data);
export const fetchAdminLeadMagnetSubscribers = (limit = 200, skip = 0) =>
  http.get(`/admin/lead-magnet/subscribers?limit=${limit}&skip=${skip}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
  }).then((r) => r.data);
export const adminLeadMagnetExportCsvUrl = () => {
  // Direct download URL — appends the bearer via a one-shot auth header is
  // not possible with <a href>, so the operator clicks the button and the
  // axios client downloads the body for them, then we trigger a save.
  return "/admin/lead-magnet/export.csv";
};
export const downloadAdminLeadMagnetCsv = async () => {
  const r = await http.get("/admin/lead-magnet/export.csv", {
    headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
    responseType: "blob",
  });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lead-magnet-subscribers-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const adminLeadMagnetDripRun = (dryRun = true) =>
  http.post(`/admin/lead-magnet/drip/run-now?dry_run=${dryRun}`, null, {
    headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
  }).then((r) => r.data);

// ---------- Admin feed health (iter316c) ----------
export const fetchAdminFeedHealth = () =>
  http.get("/admin/feeds/health", {
    headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
  }).then((r) => r.data);

// ---------- Community ----------
const buyerAuthHeaders = () => {
  const t = localStorage.getItem("cm_buyer_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
// Either-role headers for the community surface — used by endpoints that
// accept both buyer and maker JWTs (showcase create + video upload).
// Prefers the buyer JWT so existing buyer flows keep working untouched;
// makers logged in only via the maker portal still get authed.
const communityAnyAuthHeaders = () => {
  const t = localStorage.getItem("cm_buyer_jwt") || localStorage.getItem("cm_maker_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
// Same surface, but prefers the MAKER JWT first — used by maker-only
// endpoints (video upload) and by showcase posts that include a video
// clip. Without this preference, a maker who also has a stale buyer JWT
// in localStorage from a prior Google sign-in would hit a confusing
// 403 because the buyer token would be sent to a maker-only endpoint.
const communityMakerFirstHeaders = () => {
  const t = localStorage.getItem("cm_maker_jwt") || localStorage.getItem("cm_buyer_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
export const communityGoogleExchange = (session_id, eua_version = "") =>
  http.post("/community/auth/google",
            { session_id, accept_eua: !!eua_version, eua_version }).then((r) => r.data);
export const communityRequestMagic = (email, origin_url, eua_version = "") =>
  http.post("/community/auth/magic/request",
            { email, origin_url, accept_eua: !!eua_version, eua_version }).then((r) => r.data);
export const communityVerifyMagic = (token, eua_version = "") =>
  http.post("/community/auth/magic/verify",
            { token, accept_eua: !!eua_version, eua_version }).then((r) => r.data);
export const fetchCommunityEua = () =>
  http.get("/community/eua").then((r) => r.data);
export const communityMe = () =>
  http.get("/community/me", { headers: buyerAuthHeaders() }).then((r) => r.data);

// Buyer-side DM helpers (require community JWT)
export const fetchBuyerThreads = (folder = "inbox", q = "") =>
  http.get("/messages/buyer/threads", {
    headers: buyerAuthHeaders(), params: { folder, q },
  }).then((r) => r.data);
export const fetchBuyerThread = (id) =>
  http.get(`/messages/buyer/threads/${id}`, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const replyBuyerThread = (id, body, attachment_ids = []) =>
  http.post(`/messages/buyer/threads/${id}/reply`, { body, attachment_ids }, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const uploadBuyerDmAttachment = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/messages/attachments", fd, {
    headers: { ...buyerAuthHeaders(), "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};
export const patchBuyerThread = (id, patch) =>
  http.patch(`/messages/buyer/threads/${id}`, patch, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const bulkPatchBuyerThreads = (thread_ids, patch) =>
  http.post("/messages/buyer/threads/bulk", { thread_ids, ...patch }, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const emptyBuyerTrash = () =>
  http.post("/messages/buyer/threads/empty-trash", {}, { headers: buyerAuthHeaders() }).then((r) => r.data);

export const uploadAvatar = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http
    .post("/community/me/avatar", fd, {
      headers: { ...buyerAuthHeaders(), "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

export const fetchShowcase = () => http.get("/community/showcase").then((r) => r.data);
export const createShowcase = (payload) =>
  // If the post includes a video, route auth through the maker-first
  // helper so we don't accidentally send a stale buyer JWT to what is
  // effectively a maker-only post. Photo-only posts keep buyer-first
  // so existing buyer flows are untouched.
  http.post("/community/showcase", payload, {
    headers: payload?.video_url ? communityMakerFirstHeaders() : communityAnyAuthHeaders(),
  }).then((r) => r.data);
export const likeShowcase = (id) =>
  http.post(`/community/showcase/${id}/like`, {}, { headers: buyerAuthHeaders() }).then((r) => r.data);

// Public view-tracker — anyone can hit it, deduped server-side by
// (post_id, visitor_id) within 24h. The `client_id` is a stable random
// uuid kept in localStorage so refreshing the page doesn't inflate views.
export const markShowcaseViewed = (id, clientId) =>
  http.post(`/community/showcase/${id}/view`, { client_id: clientId }).then((r) => r.data);

// Top-viewed showcase pieces over the last 7 days. Powers the homepage
// "Trending in the community" strip. Same `items` shape as
// /community/showcase/recent so we can pass it through the existing
// RecentShowcaseStrip-style renderer.
export const fetchTopWeekShowcase = (limit = 6) =>
  http.get(`/community/showcase/top-week?limit=${limit}`).then((r) => r.data);

// Hottest maker over the last 7 days (lifetime fallback when quiet).
// Powers the "Maker of the Week" spotlight on the homepage.
export const fetchMakerOfTheWeek = () =>
  http.get("/community/maker-of-the-week").then((r) => r.data);

// Marketplace velocity stats — powers the homepage "is this place alive?"
// proof strip. Public, cached at the edge.
export const fetchSiteVelocity = () =>
  http.get("/site/velocity").then((r) => r.data);

// Owner-only edit (patch) and delete. Maker JWT preferred when the
// caller is a maker — same logic as createShowcase.
export const editShowcase = (id, patch) =>
  http.patch(`/community/showcase/${id}`, patch, {
    headers: communityMakerFirstHeaders(),
  }).then((r) => r.data);

export const deleteShowcase = (id) =>
  http.delete(`/community/showcase/${id}`, {
    headers: communityMakerFirstHeaders(),
  }).then((r) => r.data);

// Open a community abuse-report on a showcase post.
export const fetchShowcaseReportReasons = () =>
  http.get("/community/showcase/report-reasons").then((r) => r.data);
export const reportShowcase = (id, { reason, details = "" }) =>
  http.post(`/community/showcase/${id}/report`, { reason, details }, {
    headers: communityMakerFirstHeaders(),
  }).then((r) => r.data);

// ---- Admin showcase moderation ----
export const adminListShowcase = (params = {}) =>
  http.get("/admin/community/showcase", {
    params, headers: adminAuthHeaders(),
  }).then((r) => r.data);
export const adminEditShowcase = (id, patch) =>
  http.patch(`/admin/community/showcase/${id}`, patch, {
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
export const adminApproveShowcase = (id, { featured = false } = {}) =>
  http.post(`/admin/community/showcase/${id}/approve`, { featured }, {
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
export const adminDeleteShowcase = (id) =>
  http.delete(`/admin/community/showcase/${id}`, {
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
export const adminShowcaseModStats = () =>
  http.get("/admin/community/showcase/mod-stats", {
    headers: adminAuthHeaders(),
  }).then((r) => r.data);
// ---- GSC OAuth admin connection ----
export const adminGscStatus = () =>
  http.get("/admin/gsc/status", { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminGscOauthStart = () =>
  http.get("/admin/gsc/oauth-start", { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminGscDisconnect = () =>
  http.post("/admin/gsc/disconnect", {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminGscTestInspect = (slug = "") =>
  http.post("/admin/gsc/test-inspect", { slug }, { headers: adminAuthHeaders() }).then((r) => r.data);
// iter276 — Force re-check this listing now (persists tier + checked_at).
export const adminGscRecheck = (slug) =>
  http.post(`/admin/gsc/recheck/${slug}`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);

// Maker-only — upload a ≤50MB / ≤60s video clip to attach to a showcase post.
export const uploadShowcaseVideo = (file, opts = {}) => {
  const fd = new FormData();
  fd.append("file", file);
  return http
    .post("/community/showcase/upload-video", fd, {
      // Always prefer the maker JWT — this endpoint is maker-gated and
      // sending a buyer JWT here would return 403 with no useful
      // recovery path for the user.
      headers: { ...communityMakerFirstHeaders(), "Content-Type": "multipart/form-data" },
      // Videos are larger than the default — give the upload plenty of time.
      timeout: 120000,
      onUploadProgress: opts.onProgress
        ? (e) => opts.onProgress(e.total ? Math.round((e.loaded / e.total) * 100) : 0)
        : undefined,
    })
    .then((r) => r.data);
};

export const fetchDesignFiles = () => http.get("/community/files").then((r) => r.data);
export const fetchTrendingDesignFiles = (days = 7, limit = 6) =>
  http.get("/community/files/trending", { params: { days, limit } }).then((r) => r.data);
export const fetchDesignFilesLeaderboard = (limit = 10) =>
  http.get("/community/files/leaderboard", { params: { limit } }).then((r) => r.data);
export const downloadDesignFile = (id) =>
  http.get(`/community/files/${id}/download`, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const unlockDownloadsCheckout = () =>
  http.post(`/community/files/unlock-checkout`, {}, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const reportDesignFile = (fileId, payload) => {
  const mkr = localStorage.getItem("cm_maker_jwt");
  const byr = localStorage.getItem("cm_buyer_jwt");
  const token = mkr || byr;
  return http.post(
    `/community/files/${fileId}/report`,
    payload,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  ).then((r) => r.data);
};
export const uploadDesignFile = (payload) =>
  http.post("/community/files", payload, { headers: authHeaders() }).then((r) => r.data); // maker auth (legacy URL-paste path)
export const fetchAdminDesignFileReports = (status = "open") =>
  http.get(`/admin/design-files/reports?status=${status}`, { headers: adminAuthHeaders() }).then((r) => r.data);
export const resolveDesignFileReport = (id, payload) =>
  http.post(`/admin/design-files/reports/${id}/resolve`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const unquarantineDesignFile = (id) =>
  http.post(`/admin/design-files/${id}/unquarantine`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminDesignFiles = (params = {}) =>
  http.get("/admin/design-files", { params, headers: adminAuthHeaders() }).then((r) => r.data);
export const adminQuarantineDesignFile = (id, note = "") =>
  http.post(`/admin/design-files/reports/${id}/resolve`, {}, { headers: adminAuthHeaders() }).then((r) => r.data);
export const adminDeleteDesignFile = (id) =>
  http.delete(`/admin/design-files/${id}`, { headers: adminAuthHeaders() }).then((r) => r.data);

// Maker account lifecycle — close / reopen shop + 30-day grace deletion.
export const makerCloseShop = () =>
  http.post("/maker/account/close", {}, { headers: authHeaders() }).then((r) => r.data);
export const makerReopenShop = () =>
  http.post("/maker/account/reopen", {}, { headers: authHeaders() }).then((r) => r.data);
export const makerRequestDeletion = () =>
  http.post("/maker/account/request-deletion", {}, { headers: authHeaders() }).then((r) => r.data);
export const makerCancelDeletion = () =>
  http.post("/maker/account/cancel-deletion", {}, { headers: authHeaders() }).then((r) => r.data);
export const replyToFeedback = (id, payload) =>
  http.post(`/admin/feedback/${id}/reply`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAutoBoostStatus = () =>
  http.get("/maker/auto-boost/status", { headers: authHeaders() }).then((r) => r.data);
export const updateAutoBoost = (payload) =>
  http.patch("/maker/auto-boost", payload, { headers: authHeaders() }).then((r) => r.data);

// Custom-order routing (admin) + maker brief inbox
export const pushBriefToMaker = (orderId, payload) =>
  http.post(`/admin/custom-orders/${orderId}/push-to-maker`, payload,
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const pushBriefToReddit = (orderId, payload) =>
  http.post(`/admin/custom-orders/${orderId}/push-to-reddit`, payload,
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchBriefMakerSuggestions = (orderId) =>
  http.get(`/admin/custom-orders/${orderId}/maker-suggestions`,
    { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchRedditFeedStatus = () =>
  http.get("/community/reddit/status").then((r) => r.data);
export const fetchMakerBriefs = () =>
  http.get("/maker/briefs", { headers: authHeaders() }).then((r) => r.data);
export const fetchMakerBrief = (briefId) =>
  http.get(`/maker/briefs/${briefId}`, { headers: authHeaders() }).then((r) => r.data);
export const updateMakerBrief = (briefId, payload) =>
  http.patch(`/maker/briefs/${briefId}`, payload, { headers: authHeaders() }).then((r) => r.data);


// Direct multipart upload — works for any signed-in community user (buyer OR maker).
// Passes the freshest Bearer token (maker JWT wins over buyer JWT for attribution).
//
// Multi-format bundles: pass either `file` (single) OR `files` (array).
// First file becomes the primary; the rest land in the variants[] array.
export const uploadDesignFileDirect = (
  { file, files, title, description, thumbnail_url = "" },
  { onProgress } = {},
) => {
  const form = new FormData();
  // Bundle multi-format support — accept either shape.
  const list = Array.isArray(files) && files.length > 0 ? files : (file ? [file] : []);
  for (const f of list) form.append("files", f);
  form.append("title", title);
  form.append("description", description);
  if (thumbnail_url) form.append("thumbnail_url", thumbnail_url);
  const mkr = localStorage.getItem("cm_maker_jwt");
  const byr = localStorage.getItem("cm_buyer_jwt");
  const token = mkr || byr;
  return http.post("/community/files/upload", form, {
    headers: {
      "Content-Type": "multipart/form-data",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    onUploadProgress: (ev) => {
      if (onProgress && ev.total) onProgress(Math.round((ev.loaded * 100) / ev.total));
    },
  }).then((r) => r.data);
};

// Append additional format variants to an existing bundle (uploader-only).
export const addDesignFileVariants = (fileId, files, { onProgress } = {}) => {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  const mkr = localStorage.getItem("cm_maker_jwt");
  const byr = localStorage.getItem("cm_buyer_jwt");
  const token = mkr || byr;
  return http.post(`/community/files/${fileId}/variants`, form, {
    headers: {
      "Content-Type": "multipart/form-data",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    onUploadProgress: (ev) => {
      if (onProgress && ev.total) onProgress(Math.round((ev.loaded * 100) / ev.total));
    },
  }).then((r) => r.data);
};

// Owner-only metadata edit (title, description, thumbnail_url). Files
// themselves are immutable — use the variants endpoints to add/remove.
// Admin JWT is also accepted server-side for moderation edits.
export const updateDesignFile = (fileId, payload) => {
  const adm = localStorage.getItem("cm_admin_jwt");
  const mkr = localStorage.getItem("cm_maker_jwt");
  const byr = localStorage.getItem("cm_buyer_jwt");
  const token = adm || mkr || byr;
  return http.patch(`/community/files/${fileId}`, payload, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).then((r) => r.data);
};

// Remove a single format variant (uploader-only). Primary file is locked.
export const deleteDesignFileVariant = (fileId, fmt) => {
  const mkr = localStorage.getItem("cm_maker_jwt");
  const byr = localStorage.getItem("cm_buyer_jwt");
  const token = mkr || byr;
  return http.delete(`/community/files/${fileId}/variants/${fmt}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).then((r) => r.data);
};

// Auto-generate an SVG preview variant from a DXF in this bundle.
// Backend uses ezdxf to render and uploads the result as a new variant.
// Returns 409 if the bundle already has an SVG.
export const convertDxfToSvg = (fileId) => {
  const mkr = localStorage.getItem("cm_maker_jwt");
  const byr = localStorage.getItem("cm_buyer_jwt");
  const token = mkr || byr;
  return http.post(`/community/files/${fileId}/convert/dxf-to-svg`, null, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).then((r) => r.data);
};

// Render an STL in this bundle to a PNG thumbnail and stamp it on
// thumbnail_url. Owner-only, idempotent (409 if thumbnail already set).
export const renderStlThumbnail = (fileId) => {
  const mkr = localStorage.getItem("cm_maker_jwt");
  const byr = localStorage.getItem("cm_buyer_jwt");
  const token = mkr || byr;
  return http.post(`/community/files/${fileId}/render/stl-thumbnail`, null, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).then((r) => r.data);
};

export const fetchForumThreads = (category = "") =>
  http.get("/community/forum", { params: category ? { category } : {} }).then((r) => r.data);
export const fetchTrendingForumThreads = (days = 30, limit = 3) =>
  http.get("/community/forum/trending", { params: { days, limit } }).then((r) => r.data);
export const fetchForumCategories = () =>
  http.get("/community/forum/categories").then((r) => r.data);
export const fetchForumThread = (id) => http.get(`/community/forum/${id}`).then((r) => r.data);
export const createForumThread = (payload) =>
  http.post("/community/forum", payload, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const replyForumThread = (id, payload) =>
  http.post(`/community/forum/${id}/reply`, payload, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const adminTeamReplyForumThread = (id, payload) =>
  http.post(`/admin/forum/threads/${id}/team-reply`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const uploadForumAttachment = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http
    .post("/community/forum/upload", fd, {
      headers: { ...buyerAuthHeaders(), "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

export const fetchRecentShowcase = (params = {}) =>
  http
    .get("/community/showcase/recent", { params })
    .then((r) => r.data);

// iter117 — Showcase analytics: surface-tagged view + click events.
// Public endpoints (no auth) since the strip renders for guests too.
// Both fail-silent — analytics must never break the host page render.
export const recordShowcaseView = (postId, source) =>
  http
    .post(`/community/showcase/${postId}/view`, { source })
    .then((r) => r.data)
    .catch(() => ({ ok: false }));
export const recordShowcaseClick = (postId, source) =>
  http
    .post(`/community/showcase/${postId}/click`, { source })
    .then((r) => r.data)
    .catch(() => ({ ok: false }));
export const fetchShowcaseAnalytics = (params = {}) =>
  http
    .get("/admin/community/showcase/analytics", {
      params, headers: adminAuthHeaders(),
    })
    .then((r) => r.data);

// iter114 — Showcase form: multi-image upload + AI description help.
export const uploadShowcaseImage = (file, opts = {}) => {
  const fd = new FormData();
  fd.append("file", file);
  return http
    .post("/community/showcase/upload", fd, {
      headers: { ...buyerAuthHeaders(), "Content-Type": "multipart/form-data" },
      onUploadProgress: opts.onProgress
        ? (e) => opts.onProgress(e.total ? Math.round((e.loaded / e.total) * 100) : 0)
        : undefined,
    })
    .then((r) => r.data);
};
export const aiDescribeShowcase = (payload) =>
  http
    .post("/community/showcase/ai-describe", payload, { headers: buyerAuthHeaders() })
    .then((r) => r.data);

// Moderator deletes — accepts admin OR maker JWT (backend checks role).
const modAuthHeaders = () => {
  const t = localStorage.getItem("cm_admin_jwt") || localStorage.getItem("cm_maker_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
export const deleteChatMessage = (id) =>
  http.delete(`/admin/chat-messages/${id}`, { headers: modAuthHeaders() }).then((r) => r.data);
export const deleteForumThread = (id) =>
  http.delete(`/admin/forum-threads/${id}`, { headers: modAuthHeaders() }).then((r) => r.data);
export const deleteForumReply = (id) =>
  http.delete(`/admin/forum-replies/${id}`, { headers: modAuthHeaders() }).then((r) => r.data);

export const fetchChatHistory = (channel) =>
  http.get(`/community/chat/${channel}/history`).then((r) => r.data);

export const wsChatUrl = (channel, token) => {
  const wsBase = BASE.replace(/^http/, "ws");
  return `${wsBase}/api/ws/chat/${channel}?token=${encodeURIComponent(token || "")}`;
};


// ---------- Web Push (VAPID) ----------
export const fetchVapidPublicKey = () =>
  http.get("/push/vapid-public-key").then((r) => r.data);

export const registerPushSubscription = (payload) =>
  http.post("/push/register", payload, { headers: authHeaders() }).then((r) => r.data);

export const unregisterPushSubscription = (endpoint) =>
  http.post("/push/unregister", { endpoint }).then((r) => r.data);

export const fetchFeedsHealth = () => http.get("/feeds/health").then((r) => r.data);

export const fetchAdminPushStats = () =>
  http.get("/admin/push/stats", { headers: adminAuthHeaders() }).then((r) => r.data);

export const broadcastAdminPush = (payload) =>
  http.post("/admin/push/broadcast", payload, { headers: adminAuthHeaders() }).then((r) => r.data);

export const fetchAdminPushHistory = (limit = 50) =>
  http.get("/admin/push/history", { params: { limit }, headers: adminAuthHeaders() }).then((r) => r.data);

export const sendAdminPushTest = () =>
  http.post("/admin/push/test", {}, { headers: adminAuthHeaders() }).then((r) => r.data);

// ---------- Abandoned cart ----------
// Best-effort sync for re-engagement push. Sends the buyer's current cart
// to /api/cart/track. Server resolves the buyer's email from the
// `cm_buyer_jwt` (when signed-in) or from a registered Web Push
// endpoint we attach via X-Push-Endpoint header. Self-noops otherwise.
//
// iter267 — Optional `contact` arg lets the CartPage push phone +
// receipts/shipping consents BEFORE checkout submit, so abandoned-cart
// SMS fallback has the buyer's phone even if they bounce mid-form.
export const trackCart = async (items, contact = null) => {
  let pushEndpoint = "";
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      pushEndpoint = sub?.endpoint || "";
    }
  } catch { /* no-op — fall through with empty endpoint */ }
  const buyerJwt = localStorage.getItem("cm_buyer_jwt");
  const headers = {};
  if (buyerJwt) headers.Authorization = `Bearer ${buyerJwt}`;
  if (pushEndpoint) headers["X-Push-Endpoint"] = pushEndpoint;
  // Skip the network call entirely when we have no email path
  if (!buyerJwt && !pushEndpoint) return { ok: true, tracked: false, reason: "no_auth" };
  const body = { items: items || [] };
  if (contact && typeof contact === "object") {
    if (contact.phone) body.phone = contact.phone;
    if (contact.sms_consent_receipts_at) body.sms_consent_receipts_at = contact.sms_consent_receipts_at;
    if (contact.sms_consent_shipping_at) body.sms_consent_shipping_at = contact.sms_consent_shipping_at;
  }
  return http
    .post("/cart/track", body, { headers })
    .then((r) => r.data)
    .catch(() => ({ ok: false }));
};


// ── iter335 — Unified Promote Engine ───────────────────────────────────
export const fetchPromoteWallet = () =>
  http.get("/promote/wallet", { headers: authHeaders() }).then((r) => r.data);

export const topupPromoteWallet = (amountCents) =>
  http.post("/promote/wallet/topup", { amount_cents: amountCents },
    { headers: authHeaders() }).then((r) => r.data);

export const subscribePromoteWallet = (monthlyCents) =>
  http.post("/promote/wallet/subscribe", { monthly_cents: monthlyCents },
    { headers: authHeaders() }).then((r) => r.data);

export const cancelPromoteSubscription = () =>
  http.delete("/promote/wallet/subscribe", { headers: authHeaders() }).then((r) => r.data);

export const fetchPromoteCampaign = () =>
  http.get("/promote/campaign", { headers: authHeaders() }).then((r) => r.data);

export const upsertPromoteCampaign = (payload) =>
  http.post("/promote/campaign", payload, { headers: authHeaders() }).then((r) => r.data);

export const previewPromoteCampaign = (payload) =>
  http.post("/promote/campaign/preview", payload, { headers: authHeaders() }).then((r) => r.data);

export const pausePromoteCampaign = () =>
  http.post("/promote/campaign/pause", {}, { headers: authHeaders() }).then((r) => r.data);

export const resumePromoteCampaign = () =>
  http.post("/promote/campaign/resume", {}, { headers: authHeaders() }).then((r) => r.data);

export const applyPromoteCampaign = () =>
  http.post("/promote/campaign/apply", {}, { headers: authHeaders() }).then((r) => r.data);


// iter335.5 — External ad channel adapters
export const fetchPromoteChannels = () =>
  http.get("/promote/channels", { headers: authHeaders() }).then((r) => r.data);

export const fetchExternalCampaigns = () =>
  http.get("/promote/external", { headers: authHeaders() }).then((r) => r.data);

export const launchExternalCampaign = (channel, listing_slug) =>
  http.post("/promote/external/launch", { channel, listing_slug },
    { headers: authHeaders() }).then((r) => r.data);

export const pauseExternalCampaign = (channel, externalId) =>
  http.post(`/promote/external/${channel}/${externalId}/pause`, {},
    { headers: authHeaders() }).then((r) => r.data);

export const resumeExternalCampaign = (channel, externalId) =>
  http.post(`/promote/external/${channel}/${externalId}/resume`, {},
    { headers: authHeaders() }).then((r) => r.data);

export const fetchPromoteAnalytics = () =>
  http.get("/promote/analytics", { headers: authHeaders() }).then((r) => r.data);

// iter335.13 — AI Recommend Budget + Active Theme campaigns
export const recommendPromoteBudget = (goal = "sales") =>
  http.post("/promote/budget/recommend", { goal },
    { headers: authHeaders() }).then((r) => r.data);

export const fetchActivePromoteThemes = () =>
  http.get("/promote/themes/active", { headers: authHeaders() }).then((r) => r.data);

// iter335.16 — Maker-facing channel-split hint
export const fetchPromoteChannelSplit = () =>
  http.get("/promote/channel-split", { headers: authHeaders() }).then((r) => r.data);

// iter335.13 — Admin: theme campaign CRUD
export const adminFetchPromoteThemes = () =>
  http.get("/admin/promote/themes", { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminCreatePromoteTheme = (payload) =>
  http.post("/admin/promote/themes", payload,
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminSetPromoteThemeStatus = (themeId, status) =>
  http.post(`/admin/promote/themes/${themeId}/status?status=${encodeURIComponent(status)}`,
    {}, { headers: adminAuthHeaders() }).then((r) => r.data);

// iter335.14 — Phase 4: Channel attribution weights + theme suggestions
export const adminFetchChannelWeights = () =>
  http.get("/admin/ads/channel-weights",
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminRecomputeChannelWeights = () =>
  http.post("/admin/ads/channel-weights/recompute", {},
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminSuggestPromoteThemes = () =>
  http.get("/admin/promote/themes/suggest",
    { headers: adminAuthHeaders() }).then((r) => r.data);

// iter335.15 — Maker Leaderboard (public; widget hides if disabled)
export const fetchMakerLeaderboard = (params = {}) =>
  http.get("/leaderboard/makers", { params }).then((r) => r.data);

// iter335.17 — Maker rank widget (closes the leaderboard feedback loop)
export const fetchMakerLeaderboardRank = () =>
  http.get("/maker/leaderboard-rank",
    { headers: authHeaders() }).then((r) => r.data);

// iter346 — Site promos (on-site banner CMS)
export const fetchActiveSitePromo = (placement) =>
  http.get(`/site-promos?placement=${encodeURIComponent(placement)}`)
    .then((r) => r.data);

export const adminFetchSitePromos = () =>
  http.get("/admin/site-promos", { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminCreateSitePromo = (payload) =>
  http.post("/admin/site-promos", payload,
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminUpdateSitePromo = (promoId, patch) =>
  http.patch(`/admin/site-promos/${promoId}`, patch,
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminDeleteSitePromo = (promoId) =>
  http.delete(`/admin/site-promos/${promoId}`,
    { headers: adminAuthHeaders() }).then((r) => r.data);

// iter347 — AI Ad-Creative Workshop (Phase 3 of admin-creates-ads roadmap)
export const adminSearchAdSubjects = (q = "", limit = 12) =>
  http.get(`/admin/ad-creative/subjects?q=${encodeURIComponent(q)}&limit=${limit}`,
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminGenerateAdCreative = (payload) =>
  http.post("/admin/ad-creative/generate", payload, {
    headers: adminAuthHeaders(),
    timeout: 120000,  // image gen can take 30-60s, copy alone ~10s
  }).then((r) => r.data);

export const adminListAdCreativeDrafts = (limit = 20) =>
  http.get(`/admin/ad-creative/drafts?limit=${limit}`,
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminGetAdCreativeDraft = (draftId) =>
  http.get(`/admin/ad-creative/drafts/${draftId}`,
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminDeleteAdCreativeDraft = (draftId) =>
  http.delete(`/admin/ad-creative/drafts/${draftId}`,
    { headers: adminAuthHeaders() }).then((r) => r.data);

// iter348 — Phase 4a — Google Ads campaign push
export const adminAdCreativeGooglePreflight = () =>
  http.get("/admin/ad-creative/push/google/preflight",
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminPushDraftToGoogle = (draftId, payload) =>
  http.post(`/admin/ad-creative/drafts/${draftId}/push/google`, payload,
    { headers: adminAuthHeaders(), timeout: 60000 }).then((r) => r.data);

// iter349 — Phase 4b — Meta Ads campaign push
export const adminAdCreativeMetaPreflight = () =>
  http.get("/admin/ad-creative/push/meta/preflight",
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminPushDraftToMeta = (draftId, payload) =>
  http.post(`/admin/ad-creative/drafts/${draftId}/push/meta`, payload,
    { headers: adminAuthHeaders(), timeout: 240000 }).then((r) => r.data);

// iter349 — Phase 4c — Microsoft (Bing) Ads campaign push
export const adminAdCreativeMicrosoftPreflight = () =>
  http.get("/admin/ad-creative/push/microsoft/preflight",
    { headers: adminAuthHeaders() }).then((r) => r.data);

export const adminPushDraftToMicrosoft = (draftId, payload) =>
  http.post(`/admin/ad-creative/drafts/${draftId}/push/microsoft`, payload,
    { headers: adminAuthHeaders(), timeout: 60000 }).then((r) => r.data);

export const adminListAdCreativePushes = (limit = 30) =>
  http.get(`/admin/ad-creative/pushes?limit=${limit}`,
    { headers: adminAuthHeaders() }).then((r) => r.data);
