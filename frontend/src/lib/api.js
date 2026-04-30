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
      error.response.data.detail = d.msg || JSON.stringify(d);
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
export const fetchProduct = (slug) => http.get(`/products/${slug}`).then((r) => r.data);
export const fetchMakers = () => http.get("/makers").then((r) => r.data);
export const fetchMaker = (slug) => http.get(`/makers/${slug}`).then((r) => r.data);
export const fetchReviews = (params) => http.get("/reviews", { params }).then((r) => r.data);
export const submitReview = (payload) => http.post("/reviews", payload).then((r) => r.data);
export const fetchPosts = () => http.get("/blog").then((r) => r.data);
export const fetchPost = (slug) => http.get(`/blog/${slug}`).then((r) => r.data);
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
export const replyMakerThread = (id, body) =>
  http.post(`/messages/maker/threads/${id}/reply`, { body }, { headers: authHeaders() }).then((r) => r.data);
export const patchMakerThread = (id, patch) =>
  http.patch(`/messages/maker/threads/${id}`, patch, { headers: authHeaders() }).then((r) => r.data);
export const bulkPatchMakerThreads = (thread_ids, patch) =>
  http.post("/messages/maker/threads/bulk", { thread_ids, ...patch }, { headers: authHeaders() }).then((r) => r.data);

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
export const renewMakerProduct = (slug) =>
  http.post(`/maker/products/${slug}/renew`, {}, { headers: authHeaders() }).then((r) => r.data);
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
export const startMakerSubscription = () =>
  http.post("/maker/subscription/start", {}, { headers: authHeaders() }).then((r) => r.data);
export const cancelMakerSubscription = () =>
  http.post("/maker/subscription/cancel", {}, { headers: authHeaders() }).then((r) => r.data);
export const openMakerSubscriptionPortal = () =>
  http.post("/maker/subscription/portal", {}, { headers: authHeaders() }).then((r) => r.data);
export const uploadMakerBanner = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/maker/uploads/banner", fd, {
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
export const fetchAdminWebAnalytics = () =>
  http.get("/admin/analytics/web", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminLiveNow = () =>
  http.get("/admin/analytics/live", { headers: adminAuthHeaders() }).then((r) => r.data);
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
export const makerShareListingToBuffer = (slug) =>
  http
    .post(`/maker/buffer/share-listing/${slug}`, {}, { headers: authHeaders() })
    .then((r) => r.data);

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

// Video upload (R2)
export const uploadMakerVideo = (file, onProgress) => {
  const fd = new FormData();
  fd.append("file", file);
  return http.post("/maker/uploads/video", fd, {
    headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
    onUploadProgress: onProgress,
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
export const toggleMakerBeta = (slug, enabled) =>
  http.post(`/admin/makers/${slug}/beta`, { enabled }, { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminApprovedMakers = () =>
  http.get("/admin/makers/approved", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminRejectedApplications = () =>
  http.get("/admin/makers/rejected", { headers: adminAuthHeaders() }).then((r) => r.data);
export const fetchAdminPlusMembers = () =>
  http.get("/admin/makers/plus", { headers: adminAuthHeaders() }).then((r) => r.data);
export const emailMakerApplicant = (id, payload) =>
  http.post(`/admin/maker-applications/${id}/email`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const previewAdminBroadcast = (payload) =>
  http.post("/admin/broadcast/preview", payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const sendAdminBroadcast = (payload) =>
  http.post("/admin/broadcast/send", payload, { headers: adminAuthHeaders() }).then((r) => r.data);
export const quoteCustomOrder = (id, payload) =>
  http.patch(`/admin/custom-orders/${id}`, payload, { headers: adminAuthHeaders() }).then((r) => r.data);


// ---------- AI Assistant ----------
export const aiChat = (payload) => http.post("/ai/chat", payload).then((r) => r.data);
export const aiSubmitBrief = (brief) => http.post("/ai/submit-brief", brief).then((r) => r.data);

// ---------- Community ----------
const buyerAuthHeaders = () => {
  const t = localStorage.getItem("cm_buyer_jwt");
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
export const replyBuyerThread = (id, body) =>
  http.post(`/messages/buyer/threads/${id}/reply`, { body }, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const patchBuyerThread = (id, patch) =>
  http.patch(`/messages/buyer/threads/${id}`, patch, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const bulkPatchBuyerThreads = (thread_ids, patch) =>
  http.post("/messages/buyer/threads/bulk", { thread_ids, ...patch }, { headers: buyerAuthHeaders() }).then((r) => r.data);

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
  http.post("/community/showcase", payload, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const likeShowcase = (id) =>
  http.post(`/community/showcase/${id}/like`, {}, { headers: buyerAuthHeaders() }).then((r) => r.data);

export const fetchDesignFiles = () => http.get("/community/files").then((r) => r.data);
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
export const uploadDesignFileDirect = (
  { file, title, description, thumbnail_url = "" },
  { onProgress } = {},
) => {
  const form = new FormData();
  form.append("file", file);
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

export const fetchForumThreads = (category = "") =>
  http.get("/community/forum", { params: category ? { category } : {} }).then((r) => r.data);
export const fetchForumCategories = () =>
  http.get("/community/forum/categories").then((r) => r.data);
export const fetchForumThread = (id) => http.get(`/community/forum/${id}`).then((r) => r.data);
export const createForumThread = (payload) =>
  http.post("/community/forum", payload, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const replyForumThread = (id, payload) =>
  http.post(`/community/forum/${id}/reply`, payload, { headers: buyerAuthHeaders() }).then((r) => r.data);
export const uploadForumAttachment = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http
    .post("/community/forum/upload", fd, {
      headers: { ...buyerAuthHeaders(), "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

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
