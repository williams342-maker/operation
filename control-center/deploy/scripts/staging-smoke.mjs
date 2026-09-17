/* global console, document, fetch, process, window */
import { chromium } from "playwright";
import { fetchEndpointJson, parseEndpointJson } from "./staging-smoke-response.mjs";

const baseUrl = (process.argv[2] || process.env.STAGING_BASE_URL || "").replace(/\/$/, "");
const email = process.env.STAGING_ADMIN_EMAIL || ""; const password = process.env.STAGING_ADMIN_PASSWORD || "";
// No organization slug is involved: the sign-in form takes an email and a password and
// nothing else. The only "Organization slug" field in the application belongs to the
// Create Owner screen, which is a different page entirely.
if (!baseUrl || !email || !password) throw new Error("Usage: STAGING_ADMIN_EMAIL, STAGING_ADMIN_PASSWORD and a base URL are required. No credential values are logged.");
// The operations shell hides its page header on Overview, so there is no visible level-1
// "Overview" heading to wait for -- there has not been one since 25 July. Overview renders
// its own "Welcome back" heading instead, which is a better signal anyway: it appears only
// once the session is established and the overview payload has loaded.
const overviewReady = (page) => page.getByRole("heading", { name: /^Welcome back/ }).waitFor({ state: "visible" });
const checks = []; const check = (name, passed, detail) => { checks.push({ name, passed, detail }); if (!passed) throw new Error(`${name} failed${detail ? `: ${detail}` : ""}`); };
async function json(path) { return fetchEndpointJson((endpoint) => fetch(`${baseUrl}${endpoint}`, { redirect: "manual" }), path); }
const homepage = await fetch(baseUrl); check("Homepage", homepage.ok, `HTTP ${homepage.status}`);
const live = await json("/healthz"); check("API liveness", live.ok === true && live.status === "alive");
const ready = await json("/readyz"); check("MongoDB readiness", ready.status === "ready" && ready.mongo?.connected === true); check("AI globally disabled", ready.ai?.status === "disabled" && ready.ai?.globalEnabled === false); check("Audit subsystem", ready.audit?.status === "ready"); check("Rate limiting", ready.rateLimiting?.status === "ready"); check("Cache", ready.cache?.status === "ready");

const browser = await chromium.launch({ headless: true });
async function browserPass(label, viewport) {
  const context = await browser.newContext({ viewport }); const page = await context.newPage(); const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); }); page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  // Assert we are on the sign-in form before typing into it. The Create Owner screen also
  // has a password box, so filling blindly turns "this deployment has no owner yet" into a
  // confusing timeout further down. That screen is also the only one carrying an
  // "Organization slug" field, which is what an earlier version of this script mistook for
  // an organization-scoped login.
  const signInPresent = (await page.getByRole("button", { name: "Sign in" }).count()) > 0;
  check(`${label} sign-in form`, signInPresent, signInPresent ? ""
    : (await page.getByPlaceholder("Organization slug").count()) > 0
      ? "showing Create Owner: this deployment has not been bootstrapped"
      : "no Sign in control found");
  await page.getByPlaceholder("Email").fill(email); await page.getByPlaceholder("Password").fill(password); await page.getByRole("button", { name: "Sign in" }).click();
  await overviewReady(page);
  const mobile = viewport.width < 768;
  const openNavigation = async () => {
    if (!mobile) return;
    const trigger = page.getByRole("button", { name: "Open navigation" });
    await trigger.click();
    check(`${label} navigation expanded`, await page.getByRole("button", { name: "Close navigation", exact: true }).getAttribute("aria-expanded") === "true");
  };
  const navigate = async (name) => { await openNavigation(); await page.getByRole("button", { name, exact: true }).click(); };
  if (mobile) {
    await openNavigation();
    await page.keyboard.press("Escape");
    const trigger = page.getByRole("button", { name: "Open navigation" });
    check(`${label} Escape closes navigation`, await trigger.getAttribute("aria-expanded") === "false");
    check(`${label} navigation trigger regains focus`, await trigger.evaluate((element) => document.activeElement === element));
  }
  const historyLength = await page.evaluate(() => window.history.length);
  const api = async (path) => {
    const response = await page.evaluate(async (url) => { const result = await fetch(url, { credentials: "include" }); return { status: result.status, contentType: result.headers.get("content-type") || "", text: await result.text() }; }, `${baseUrl}${path}`);
    return { status: response.status, body: parseEndpointJson(path, response, { authenticated: true }) };
  };
  const overview = await api("/api/overview"); check(`${label} authentication`, overview.status === 200); check(`${label} audit logging`, overview.body.recentAudit?.some((event) => event.action === "auth.login"));
  const servers = await api("/api/servers"); check(`${label} agent connectivity payload`, servers.status === 200 && Array.isArray(servers.body.servers)); check(`${label} discovery payload`, servers.body.servers.every((server) => !server.currentState?.discovery || typeof server.currentState.discovery === "object"));
  const projects = await api("/api/projects"); check(`${label} application listing`, projects.status === 200 && Array.isArray(projects.body.projects));
  const ai = await api("/api/ai-assistant/status"); check(`${label} AI disabled state`, ai.status === 200 && ai.body.enabled === false && ai.body.globalEnabled === false);
  const diagnostics = await api("/api/system/diagnostics"); check(`${label} diagnostics`, diagnostics.status === 200 && diagnostics.body.environment?.valid === true);
  await navigate("Projects"); await page.getByRole("heading", { name: "Projects", level: 1 }).waitFor({ state: "visible" });
  await navigate("Servers"); await page.getByRole("heading", { name: "Servers", level: 1 }).waitFor({ state: "visible" });
  await navigate("Overview"); await overviewReady(page);
  await navigate("Health"); await page.getByRole("heading", { name: "Health Checks" }).waitFor({ state: "visible" });
  check(`${label} browser history preserved`, await page.evaluate(() => window.history.length) >= historyLength);
  const resized = mobile ? { width: 1024, height: 768 } : { width: 390, height: 844 };
  await page.setViewportSize(resized);
  await page.getByRole("heading", { name: "Health", level: 1 }).waitFor({ state: "visible" });
  if (resized.width < 768) {
    const trigger = page.getByRole("button", { name: "Open navigation" }); await trigger.click(); await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  } else await page.getByRole("button", { name: "Overview", exact: true }).waitFor({ state: "visible" });
  await page.setViewportSize(viewport);
  await page.reload({ waitUntil: "networkidle" });
  await overviewReady(page);
  check(`${label} session persistence`, (await api("/api/me")).status === 200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); check(`${label} horizontal overflow`, !overflow); check(`${label} console errors`, errors.length === 0, errors.slice(0, 3).join("; "));
  await navigate("Sign out"); await page.getByRole("button", { name: "Sign in" }).waitFor({ state: "visible" });
  await context.close();
}
await browserPass("Desktop", { width: 1280, height: 900 });
await browserPass("Tablet", { width: 768, height: 1024 });
await browserPass("Mobile portrait", { width: 390, height: 844 });
await browserPass("Mobile landscape", { width: 667, height: 375 });
await browser.close();
console.log(JSON.stringify({ ok: true, baseUrl, checks, credentialsLogged: false }, null, 2));
