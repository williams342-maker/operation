/* global console, document, fetch, process, window */
import { chromium } from "playwright";
import { fetchEndpointJson, parseEndpointJson } from "./staging-smoke-response.mjs";

const baseUrl = (process.argv[2] || process.env.STAGING_BASE_URL || "").replace(/\/$/, "");
const organizationSlug = process.env.STAGING_ORG_SLUG || ""; const email = process.env.STAGING_ADMIN_EMAIL || ""; const password = process.env.STAGING_ADMIN_PASSWORD || "";
if (!baseUrl || !organizationSlug || !email || !password) throw new Error("Usage: STAGING_ORG_SLUG, STAGING_ADMIN_EMAIL, STAGING_ADMIN_PASSWORD and a base URL are required. No credential values are logged.");
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
  await page.getByPlaceholder("Organization slug").fill(organizationSlug); await page.getByPlaceholder("Email").fill(email); await page.getByPlaceholder("Password").fill(password); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Overview" }).waitFor({ state: "visible" });
  const api = async (path) => {
    const response = await page.evaluate(async (url) => { const result = await fetch(url, { credentials: "include" }); return { status: result.status, contentType: result.headers.get("content-type") || "", text: await result.text() }; }, `${baseUrl}${path}`);
    return { status: response.status, body: parseEndpointJson(path, response, { authenticated: true }) };
  };
  const overview = await api("/api/overview"); check(`${label} authentication`, overview.status === 200); check(`${label} audit logging`, overview.body.recentAudit?.some((event) => event.action === "auth.login"));
  const servers = await api("/api/servers"); check(`${label} agent connectivity payload`, servers.status === 200 && Array.isArray(servers.body.servers)); check(`${label} discovery payload`, servers.body.servers.every((server) => !server.currentState?.discovery || typeof server.currentState.discovery === "object"));
  const projects = await api("/api/projects"); check(`${label} application listing`, projects.status === 200 && Array.isArray(projects.body.projects));
  const ai = await api("/api/ai-assistant/status"); check(`${label} AI disabled state`, ai.status === 200 && ai.body.enabled === false && ai.body.globalEnabled === false);
  const diagnostics = await api("/api/system/diagnostics"); check(`${label} diagnostics`, diagnostics.status === 200 && diagnostics.body.environment?.valid === true);
  await page.getByRole("button", { name: "Projects" }).click(); await page.getByRole("heading", { name: "Projects", level: 1 }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Health" }).click(); await page.getByRole("heading", { name: "Health Checks" }).waitFor({ state: "visible" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); check(`${label} horizontal overflow`, !overflow); check(`${label} console errors`, errors.length === 0, errors.slice(0, 3).join("; "));
  await context.close();
}
await browserPass("Desktop", { width: 1280, height: 900 }); await browserPass("Mobile 390px", { width: 390, height: 844 }); await browser.close();
console.log(JSON.stringify({ ok: true, baseUrl, checks, credentialsLogged: false }, null, 2));
