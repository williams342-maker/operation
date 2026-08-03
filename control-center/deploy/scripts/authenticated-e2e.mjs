/* global console, fetch, localStorage, process */
import assert from "node:assert/strict";
import path from "node:path";
import { URL } from "node:url";
import { chromium } from "playwright";
import { MongoClient, ObjectId } from "mongodb";
import { createBrowserErrorTracker } from "./e2e-browser-errors.mjs";

const baseUrl = (process.env.E2E_BASE_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
const apiUrl = (process.env.E2E_API_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const mongoUrl = process.env.MONGO_URL_TEST || "mongodb://127.0.0.1:27017/control_center_e2e";
const organizationSlug = "e2e";
const email = "owner@example.test";
const password = "e2e-password-long-enough";

const client = new MongoClient(mongoUrl);
await client.connect();
const db = client.db();
await db.dropDatabase();
assert.equal(await db.collection("organizations").countDocuments(), 0, "disposable E2E database starts without an organization");

const initialBootstrapStatus = await fetch(`${apiUrl}/api/auth/bootstrap`);
assert.equal(initialBootstrapStatus.status, 200, "bootstrap status is available");
assert.equal((await initialBootstrapStatus.json()).available, true, "manual bootstrap is available for the empty disposable database");

const bootstrap = await fetch(`${apiUrl}/api/auth/bootstrap`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ organizationName: "E2E Organization", organizationSlug, ownerEmail: email, ownerName: "E2E Owner", password })
});
assert.equal(bootstrap.status, 201, "bootstrap succeeds");
assert.equal(await db.collection("organizations").countDocuments(), 1, "bootstrap creates exactly one organization");
assert.equal(await db.collection("users").countDocuments(), 1, "bootstrap creates exactly one owner");
const completedBootstrapStatus = await fetch(`${apiUrl}/api/auth/bootstrap`);
assert.equal(completedBootstrapStatus.status, 200, "completed bootstrap status is available");
assert.equal((await completedBootstrapStatus.json()).available, false, "bootstrap closes after the owner is created");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const navigationHistory = [];
const consoleErrors = [];
const failedRequests = [];
const browserErrors = createBrowserErrorTracker([
  { phase: "recent-auth enrollment", method: "POST", path: "/api/admin/enrollment/generate", status: 403, count: 1 },
  { phase: "expired session", method: "GET", path: "/api/me", status: 401, count: 1 },
  { phase: "expired session", method: "GET", path: "/api/overview", status: 401, count: 1 },
]);
page.on("console", (message) => {
  browserErrors.console({ type: message.type(), text: message.text() });
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => {
  browserErrors.console({ type: "error", text: error.message });
  consoleErrors.push(error.message);
});
page.on("response", (response) => browserErrors.response({ method: response.request().method(), url: response.url(), status: response.status() }));
page.on("requestfailed", (request) => failedRequests.push({ method: request.method(), url: request.url(), error: request.failure()?.errorText || "unknown" }));
page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigationHistory.push(frame.url()); });

async function reportBrowserFailure(error) {
  const screenshotPath = path.join(process.env.RUNNER_TEMP || process.cwd(), "authenticated-e2e-failure.png");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  const [apiHealth, frontendHealth] = await Promise.all([
    fetch(`${apiUrl}/healthz`).then((response) => response.status).catch(() => "unreachable"),
    fetch(baseUrl).then((response) => response.status).catch(() => "unreachable"),
  ]);
  console.error(JSON.stringify({
    message: error instanceof Error ? error.message : String(error),
    url: page.url(),
    title: await page.title().catch(() => "unavailable"),
    headings: await page.getByRole("heading").allTextContents().catch(() => []),
    apiHealth,
    frontendHealth,
    navigationHistory,
    consoleErrors,
    failedRequests,
    screenshotPath,
  }));
}

async function login() {
  try {
    const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200, "login page loads successfully");
    assert.equal(new URL(page.url()).pathname, "/", "browser reaches the supported login route");
    await page.locator('input[autocomplete="username"]').fill(email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Overview" }).waitFor();
  } catch (error) {
    await reportBrowserFailure(error);
    throw error;
  }
}

async function authenticatedApi(path, method = "GET", body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      credentials: "include",
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(method === "GET" ? {} : { "x-csrf-token": localStorage.getItem("cc.csrf") || "" })
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  }, { path: `${baseUrl}/api${path}`, method, body });
}

async function currentSessionId() {
  // The session cookie is now an opaque random token (only its hash is stored), so the id can no
  // longer be parsed from the cookie. Resolve the browser's current session as the most recent one
  // for the owner in the disposable E2E database.
  const cookie = (await context.cookies()).find((item) => item.name === "cc_session");
  assert.ok(cookie?.value, "session cookie exists");
  const user = await db.collection("users").findOne({ email });
  assert.ok(user?._id, "owner user exists");
  const [session] = await db.collection("sessions").find({ userId: user._id }).sort({ createdAt: -1 }).limit(1).toArray();
  assert.ok(session?._id, "session persisted for owner");
  return session._id;
}

await login();
assert.equal((await authenticatedApi("/me")).status, 200, "authenticated browser session works");

// Recent-authentication browser flow: stale the real session, trigger a protected
// enrollment action, confirm the password, and verify the action is retried.
await db.collection("sessions").updateOne({ _id: await currentSessionId() }, { $set: { authenticatedAt: new Date(0) } });
await page.getByRole("button", { name: "Enrollment" }).click();
await page.getByRole("button", { name: "Generate Enrollment Token" }).click();
await page.getByPlaceholder("Production web server").fill("E2E staging agent");
browserErrors.setPhase("recent-auth enrollment");
await page.getByRole("button", { name: "Generate", exact: true }).click();
await page.getByRole("heading", { name: "Confirm your password" }).waitFor();
browserErrors.setPhase("normal");
await page.locator('input[type="password"]').last().fill(password);
await page.getByRole("button", { name: "Confirm", exact: true }).click();
const enrollmentSuccess = page.getByRole("heading", { name: "Enrollment token generated" });
await enrollmentSuccess.waitFor();
await page.getByRole("button", { name: "Close permanently", exact: true }).click();
await enrollmentSuccess.waitFor({ state: "hidden" });

// Active-session logout.
await page.getByRole("button", { name: /sign out/i }).click();
await page.getByRole("button", { name: "Sign in" }).waitFor();

// Expired-session handling must return the browser to the login screen.
await login();
await db.collection("sessions").updateOne({ _id: await currentSessionId() }, { $set: { expiresAt: new Date(0) } });
browserErrors.setPhase("expired session");
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "Sign in" }).waitFor();
browserErrors.setPhase("normal");

// Authenticated configuration workflow using real API, MongoDB, and browser UI.
await login();
const org = await db.collection("organizations").findOne({ slug: organizationSlug });
assert.ok(org?._id);
const now = new Date();
const serverId = new ObjectId();
const projectId = new ObjectId();
await db.collection("servers").insertOne({
  _id: serverId, orgId: org._id, name: "E2E server", slug: "e2e-server", hostname: "e2e-host",
  agentStatus: "online", enrollmentStatus: "connected", allowedRoots: ["/srv/e2e"],
  agentVersion: "0.1.0", agentCapabilities: ["environmentFileWrite", "dockerComposeActivation", "healthValidation"],
  createdAt: now, updatedAt: now
});
await db.collection("projects").insertOne({
  _id: projectId, orgId: org._id, name: "E2E application", slug: "e2e-application",
  primaryServerId: serverId, repoPath: "/srv/e2e", composePath: "compose.yml",
  branch: "main", adapter: "docker-compose", serviceNames: ["web"],
  healthCheckIds: [], mongoCheckIds: [], createdAt: now, updatedAt: now
});
const environment = await authenticatedApi("/configuration/environments", "POST", { projectId: projectId.toHexString(), name: "Private staging", kind: "staging", protected: false });
assert.equal(environment.status, 201);
const definition = await authenticatedApi("/configuration/definitions", "POST", {
  projectId: projectId.toHexString(),
  name: "E2E_FEATURE_FLAG",
  description: "Boolean feature flag used by the authenticated E2E workflow",
  type: "boolean",
  secret: false,
  required: false,
  usage: "runtime",
  services: ["web"],
  applicableEnvironments: ["development", "staging"],
  validation: { type: "boolean" },
  restartRequirement: "restart",
  removalPermitted: true,
  browserDisplayPermitted: true,
  risk: "low"
});
assert.equal(definition.status, 201, `definition creation failed: ${definition.body?.error || "unexpected response"}`);
const storedDefinition = await db.collection("configuration_definitions").findOne({ _id: new ObjectId(definition.body.id) });
assert.equal(storedDefinition?.orgId.toHexString(), org._id.toHexString(), "definition remains organization scoped");
assert.equal(storedDefinition?.projectId.toHexString(), projectId.toHexString(), "definition remains project scoped");
assert.equal(storedDefinition?.secret, false, "definition remains non-secret");
assert.equal("envelope" in (storedDefinition || {}), false, "definition stores no secret envelope");
const definitionAudit = await db.collection("audit_events").findOne({ orgId: org._id, action: "configuration.definition.create", targetId: storedDefinition?._id });
assert.equal(definitionAudit?.result, "success", "definition creation is audited");
assert.deepEqual(definitionAudit?.metadata, { variable: "E2E_FEATURE_FLAG" }, "definition audit contains only value-free metadata");

await page.getByRole("button", { name: "Configuration" }).click();
await page.getByText("Production deployment unavailable").waitFor();
await page.getByLabel("Configuration project").selectOption(projectId.toHexString());
await page.getByLabel("Configuration environment").selectOption(environment.body.id);
await page.getByRole("button", { name: "E2E_FEATURE_FLAG" }).waitFor();
await page.getByRole("heading", { name: "Controlled configuration deployment" }).waitFor();
await page.getByText("Independent approval", { exact: false }).waitFor();
await page.getByText("Backup and apply", { exact: false }).waitFor();
await page.getByText("Success or rollback", { exact: false }).waitFor();
assert.equal(await page.getByRole("button", { name: "Create immutable plan" }).isEnabled(), true, "non-production deployment workflow is available");
assert.deepEqual(browserErrors.result(), { unmet: [], unexpectedResponses: [], unexpectedConsoleErrors: [] }, "browser responses and console errors match narrow expectations");

await context.close();
await browser.close();
await db.dropDatabase();
await client.close();
console.log(JSON.stringify({ ok: true, checks: ["login", "recent authentication", "active logout", "session expiry", "configuration workflow"], credentialsLogged: false }));
