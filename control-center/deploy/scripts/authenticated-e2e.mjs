/* global console, fetch, localStorage, process */
import assert from "node:assert/strict";
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

const bootstrap = await fetch(`${apiUrl}/api/auth/bootstrap`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ organizationName: "E2E Organization", organizationSlug, ownerEmail: email, ownerName: "E2E Owner", password })
});
assert.equal(bootstrap.status, 201, "bootstrap succeeds");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const browserErrors = createBrowserErrorTracker([
  { phase: "recent-auth enrollment", method: "POST", path: "/api/admin/enrollment/generate", status: 403, count: 1 },
  { phase: "expired session", method: "GET", path: "/api/me", status: 401, count: 1 },
  { phase: "expired session", method: "GET", path: "/api/overview", status: 401, count: 1 },
]);
page.on("console", (message) => browserErrors.console({ type: message.type(), text: message.text() }));
page.on("pageerror", (error) => browserErrors.console({ type: "error", text: error.message }));
page.on("response", (response) => browserErrors.response({ method: response.request().method(), url: response.url(), status: response.status() }));

async function login() {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Organization slug").fill(organizationSlug);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Overview" }).waitFor();
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
  const cookie = (await context.cookies()).find((item) => item.name === "cc_session");
  assert.ok(cookie?.value, "session cookie exists");
  return new ObjectId(cookie.value);
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
const definition = await authenticatedApi("/configuration/definitions", "POST", { projectId: projectId.toHexString(), name: "E2E_FEATURE_FLAG", type: "boolean", secret: false, required: false, usage: "runtime", services: ["web"] });
assert.equal(definition.status, 201);

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
