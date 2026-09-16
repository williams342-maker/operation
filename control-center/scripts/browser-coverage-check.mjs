/* global document, location, window */
// Second real-browser check for the control-center UI.
//
// foundry-browser-check.mjs drives the happy path of one authenticated Foundry journey. It never
// renders the sign-in screen (it obtains a session by POSTing to the auth API and writing the CSRF
// token into localStorage), never visits the operations shell, and runs axe only over the Foundry
// surfaces. This check covers what that one leaves out:
//
//   * an unauthenticated visitor hitting a protected route
//   * a failed sign-in through the actual form
//   * a surface reached by typing its URL rather than by clicking through the app
//   * behaviour at a ~400px viewport, including the operations shell's mobile navigation
//   * an axe sweep of every surface this check can reach, at desktop and mobile width
//
// Configuration comes from foundry-check-config.mjs, so the same rule applies: the built-in
// disposable credentials are never sent to a non-loopback origin.
//
// Each check declares the minimum number of assertions it must make. A check that returns early --
// because a selector silently matched nothing, or because a branch was skipped -- fails on the
// assertion count instead of reporting a pass for work it did not do.
//
// Run one check while proving it can go red:  BROWSER_CHECK_ONLY=failed-login node scripts/browser-coverage-check.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { resolveFoundryCheckConfig } from './foundry-check-config.mjs';

const { origin, email, password } = resolveFoundryCheckConfig(process.env);
const out = path.resolve(process.env.FOUNDRY_EVIDENCE_DIR || '../../browser-evidence');
const MOBILE_WIDTH = 390;
const DESKTOP_WIDTH = 1440;
const WRONG_PASSWORD = 'not-the-password';
const UNKNOWN_PROJECT = '000000000000000000000000';
const LANDING_HEADING = 'Describe it. Watch Foundry build it.';

// Every operations-shell page reachable from the primary navigation, plus the admin-only one.
const OPS_PAGES = ['Overview', 'AI Website Builder', 'SEO Optimizer', 'AI Workforce', 'Credits & Providers',
  'Organization', 'Users', 'Servers', 'Agent Upgrades', 'Projects', 'Configuration', 'Health', 'Mongo',
  'Tasks', 'Audit', 'Enrollment'];
const ANON_PROTECTED = ['/foundry/new', '/foundry/projects', `/foundry/projects/${UNKNOWN_PROJECT}`];

class CheckFailure extends Error {}

// The API applies a global limiter of 180 requests per minute, and in the local preview harness the
// static assets are served behind it too. A sweep of every surface at two widths goes well past that,
// and the first symptom is not an obvious error: the limiter answers the DOCUMENT request, so the
// browser renders "Too many requests, please try again later." and the check times out waiting for a
// heading that was never going to appear. Pace the whole run under the limit rather than raising it.
// Requests are COUNTED in the route handler but WAITED FOR between steps. Sleeping inside the
// handler stalls the request the browser is already waiting on, so a pause reads as a navigation
// timeout instead of a pause. The budget is well under the server's so a burst cannot overshoot it.
const REQUEST_BUDGET_PER_MINUTE = 120;
let windowStartedAt = Date.now();
let requestsInWindow = 0;
let totalRequests = 0;
let pauses = 0;
function countRequest() {
  if (Date.now() - windowStartedAt >= 60_000) { windowStartedAt = Date.now(); requestsInWindow = 0; }
  requestsInWindow += 1;
  totalRequests += 1;
}
async function awaitRequestBudget() {
  const now = Date.now();
  if (now - windowStartedAt >= 60_000) { windowStartedAt = now; requestsInWindow = 0; return; }
  if (requestsInWindow < REQUEST_BUDGET_PER_MINUTE) return;
  pauses += 1;
  await new Promise((resolve) => setTimeout(resolve, 60_000 - (now - windowStartedAt) + 500));
  windowStartedAt = Date.now();
  requestsInWindow = 0;
}

// Backstop for the pacing above: if the limiter answers a navigation anyway, that is an artifact of
// the harness, not the behaviour under test, so wait out the window and ask again rather than
// reporting a failure the application did not cause.
let rateLimitedNavigations = 0;
async function navigate(page, pathname) {
  await awaitRequestBudget();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await page.goto(origin + pathname);
    if (response?.status() !== 429) return response;
    rateLimitedNavigations += 1;
    windowStartedAt = Date.now();
    requestsInWindow = 0;
    await new Promise((resolve) => setTimeout(resolve, 61_000));
  }
  throw new CheckFailure(`${pathname}: still rate limited after three attempts`);
}

let assertions = 0;
function check(condition, message) {
  assertions += 1;
  if (!condition) throw new CheckFailure(message);
}
function checkEqual(actual, expected, message) {
  check(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

async function signInForm(page) {
  return {
    email: page.getByPlaceholder('Email', { exact: true }),
    password: page.getByPlaceholder('Password', { exact: true }),
    submit: page.getByRole('button', { name: 'Sign in', exact: true }),
  };
}

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

async function axeViolations(page) {
  const result = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target),
  }));
}

// A surface is a URL plus, for the operations shell, the navigation button that reveals it. The
// shell keeps its page in component state rather than the URL, so it cannot be addressed by path.
async function visitAnon(page, pathname) {
  await navigate(page, pathname);
  // Wait for the app to render SOMETHING, not for a heading. Waiting on an <h1> makes every failure
  // arrive as an anonymous 20-second timeout: when the guard breaks, the workspace renders an error
  // state with no heading at all, and the check would report "timed out" instead of naming the
  // assertion that failed. The assertions below say what was expected.
  await page.waitForFunction(() => (document.getElementById('root')?.innerText || '').trim().length > 0);
}

async function signIn(page) {
  await awaitRequestBudget();
  await navigate(page, '/');
  const form = await signInForm(page);
  await form.submit.waitFor();
  await form.email.fill(email);
  await form.password.fill(password);
  await form.submit.click();
  // Wait on the form detaching and the shell's navigation landmark attaching, not on a visible nav
  // item: below the md breakpoint the navigation is collapsed, and the Overview page's own <h1> is
  // inside a container the shell hides on that page, so neither is visible at every width.
  await form.submit.waitFor({ state: 'detached' });
  await page.locator('#primary-navigation').waitFor({ state: 'attached' });
}

async function openOpsPage(page, label) {
  await awaitRequestBudget();
  const item = page.getByRole('button', { name: label, exact: true }).first();
  await item.click();
  // Wait on the navigation item marking itself current. The shell's <h1> is not a usable signal:
  // on Overview the element that holds it is hidden, so it is absent from the accessibility tree.
  await page.locator(`#primary-navigation [aria-current="page"]`).filter({ hasText: label }).waitFor();
  // The body fills from queries after the page switches. Wait for the loading skeletons to go so
  // axe scans the loaded page. Bounded and tolerant: several pages poll on an interval and so never
  // reach network idle, and a page with no skeleton has nothing to wait for.
  await page.locator('[role="status"][aria-label="Loading"]').first()
    .waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
}

const checks = [
  {
    name: 'anon-protected-route',
    minAssertions: 12,
    // An unauthenticated visitor asking for a workspace URL must get the sign-in screen, must not
    // see any workspace content, and must keep the URL so the post-login return lands where they asked.
    async run(page) {
      for (const pathname of ANON_PROTECTED) {
        await visitAnon(page, pathname);
        const form = await signInForm(page);
        check(await form.password.isVisible(), `${pathname}: no sign-in form for an anonymous visitor`);
        checkEqual(new URL(page.url()).pathname, pathname, `${pathname}: URL not preserved`);
        checkEqual(await page.getByRole('textbox', { name: 'Describe what you want to build' }).count(), 0,
          `${pathname}: workspace composer rendered without a session`);
        checkEqual(await page.getByRole('heading', { name: 'Your projects' }).count(), 0,
          `${pathname}: project list rendered without a session`);
      }
    },
  },
  {
    name: 'anon-public-landing',
    minAssertions: 3,
    // The counterpart to anon-protected-route: without this, that check would still pass if the app
    // put every single path behind the sign-in screen. The marketing landing is deliberately public.
    async run(page) {
      await visitAnon(page, '/foundry');
      const form = await signInForm(page);
      // The landing has its own "Sign in" control, so the sign-in SCREEN is identified by its
      // password box, not by the presence of a button with that label.
      checkEqual(await form.password.count(), 0, '/foundry: public landing is behind the sign-in screen');
      checkEqual(await page.getByRole('heading', { level: 1 }).first().innerText(),
        LANDING_HEADING, '/foundry: landing heading not rendered anonymously');
      checkEqual(new URL(page.url()).pathname, '/foundry', '/foundry: URL not preserved');
    },
  },
  {
    name: 'failed-login',
    minAssertions: 6,
    // A rejected sign-in has to say so, keep the user on the form, grant nothing, and not echo back
    // what was typed into the password box.
    async run(page) {
      await navigate(page, '/');
      const form = await signInForm(page);
      await form.submit.waitFor();
      await form.email.fill(email);
      await form.password.fill(WRONG_PASSWORD);
      await form.submit.click();
      // Bounded wait, then an assertion: if no alert ever appears the failure should name the
      // missing error message, not read as an anonymous timeout.
      const alert = page.getByRole('alert').first();
      const announced = await alert.waitFor({ timeout: 10000 }).then(() => true, () => false);
      checkEqual(announced, true, 'a rejected sign-in announced no error at all');
      const message = (await alert.innerText().catch(() => '')).trim();
      check(message.length > 0, 'failed sign-in produced an empty alert');
      check(!message.includes(WRONG_PASSWORD), 'the error message echoes the submitted password');
      check(await form.submit.isVisible(), 'the sign-in form disappeared after a failed attempt');
      checkEqual(await page.evaluate(() => localStorage.getItem('cc.csrf')), null,
        'a failed sign-in left a CSRF token behind');
      checkEqual(await page.getByRole('button', { name: 'Overview', exact: true }).count(), 0,
        'a failed sign-in reached the operations shell');
    },
  },
  {
    name: 'direct-url-entry',
    minAssertions: 8,
    // Every authenticated Foundry surface must render from a cold page load at its own URL, not only
    // when reached by clicking through the app. A route that only works after in-app navigation
    // breaks bookmarks, refreshes and shared links.
    async run(page) {
      await signIn(page);
      const surfaces = [
        ['/foundry/projects', 'Your projects'],
        ['/foundry/new', 'What would you like to build today?'],
      ];
      for (const [pathname, heading] of surfaces) {
        await navigate(page, pathname);
        await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
        checkEqual(new URL(page.url()).pathname, pathname, `${pathname}: URL changed on direct entry`);
        // The FIRST level-1 heading, not merely the presence of one. The authenticated landing also
        // renders a "Your projects" section, so "the projects heading exists somewhere on the page"
        // cannot tell the projects surface apart from the landing -- an earlier version of this
        // check passed with the route deliberately broken to resolve /foundry/projects to landing.
        checkEqual(await page.getByRole('heading', { level: 1 }).first().innerText(), heading,
          `${pathname}: direct entry did not open this surface`);
        checkEqual(await page.getByRole('heading', { name: LANDING_HEADING, level: 1 }).count(), 0,
          `${pathname}: direct entry fell back to the landing page`);
        checkEqual(await (await signInForm(page)).password.count(), 0,
          `${pathname}: direct entry bounced an authenticated session to sign-in`);
      }
    },
  },
  {
    name: 'mobile-viewport',
    minAssertions: 8,
    // Nothing may scroll sideways at a phone width. The sign-in screen did: its card was a
    // shrink-to-fit flex item wrapping fixed-width content, so it measured 418px in a 390px viewport.
    async run(page) {
      await page.setViewportSize({ width: MOBILE_WIDTH, height: 900 });
      for (const pathname of ['/', ...ANON_PROTECTED, '/foundry']) {
        await visitAnon(page, pathname);
        checkEqual(await horizontalOverflow(page), false, `${pathname} scrolls horizontally at ${MOBILE_WIDTH}px`);
      }
      await signIn(page);
      for (const pathname of ['/foundry/projects', '/foundry/new']) {
        await navigate(page, pathname);
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        checkEqual(await horizontalOverflow(page), false, `${pathname} scrolls horizontally at ${MOBILE_WIDTH}px (signed in)`);
      }
      await navigate(page, '/');
      await page.getByRole('button', { name: 'Open navigation' }).waitFor();
      checkEqual(await horizontalOverflow(page), false, `the operations shell scrolls horizontally at ${MOBILE_WIDTH}px`);
    },
  },
  {
    name: 'mobile-navigation',
    minAssertions: 8,
    // At phone width the operations shell's navigation is a disclosure. It must be closed and hidden
    // to start, announce its state, move focus into the panel, close on Escape and hand focus back.
    async run(page) {
      await page.setViewportSize({ width: MOBILE_WIDTH, height: 900 });
      await signIn(page);
      const trigger = page.getByRole('button', { name: 'Open navigation' });
      const panel = page.locator('#primary-navigation');
      await trigger.waitFor();
      checkEqual(await panel.isVisible(), false, 'the navigation panel is visible before it is opened');
      checkEqual(await trigger.getAttribute('aria-expanded'), 'false', 'the closed trigger does not report aria-expanded=false');
      checkEqual(await trigger.getAttribute('aria-controls'), 'primary-navigation', 'the trigger does not point at the panel');
      await trigger.click();
      await panel.waitFor({ state: 'visible' });
      const openTrigger = page.getByRole('button', { name: 'Close navigation' });
      checkEqual(await openTrigger.getAttribute('aria-expanded'), 'true', 'the open trigger does not report aria-expanded=true');
      checkEqual(await page.evaluate(() => document.getElementById('primary-navigation')?.contains(document.activeElement) ?? false),
        true, 'opening the navigation did not move focus into it');
      await page.keyboard.press('Escape');
      const closed = await panel.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false);
      checkEqual(closed, true, 'Escape did not close the navigation');
      await page.getByRole('button', { name: 'Open navigation' }).waitFor();
      // Focus restoration is deferred to a task after the close, so poll for it with a bounded
      // timeout rather than reading document.activeElement once and racing that task.
      const focusRestored = await page
        .waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open navigation', null, { timeout: 5000 })
        .then(() => true, () => false);
      checkEqual(focusRestored, true, 'closing the navigation did not restore focus to its trigger');
      checkEqual(await horizontalOverflow(page), false, `the open navigation makes the shell scroll horizontally at ${MOBILE_WIDTH}px`);
    },
  },
  {
    name: 'accessibility-sweep',
    minAssertions: 2,
    // axe over every surface this check can reach, at both widths. Recorded as evidence and asserted
    // to be empty: the operations shell is not covered by the Foundry check's scans at all.
    async run(page) {
      const scans = [];
      const sweep = async (label, width) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        scans.push({ surface: label, width, violations: await axeViolations(page) });
      };
      for (const pathname of ['/', '/foundry', ...ANON_PROTECTED]) {
        await visitAnon(page, pathname);
        await sweep('anon ' + pathname, DESKTOP_WIDTH);
        await sweep('anon ' + pathname, MOBILE_WIDTH);
      }
      await page.setViewportSize({ width: DESKTOP_WIDTH, height: 1000 });
      await signIn(page);
      for (const label of OPS_PAGES) {
        await page.setViewportSize({ width: DESKTOP_WIDTH, height: 1000 });
        await openOpsPage(page, label);
        await sweep('ops ' + label, DESKTOP_WIDTH);
        await sweep('ops ' + label, MOBILE_WIDTH);
      }
      await page.setViewportSize({ width: MOBILE_WIDTH, height: 900 });
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.locator('#primary-navigation').waitFor({ state: 'visible' });
      await sweep('ops mobile navigation open', MOBILE_WIDTH);
      await page.keyboard.press('Escape');
      for (const pathname of ['/foundry/projects', '/foundry/new', '/foundry']) {
        await navigate(page, pathname);
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        await sweep('authed ' + pathname, DESKTOP_WIDTH);
        await sweep('authed ' + pathname, MOBILE_WIDTH);
      }
      await fs.writeFile(path.join(out, 'coverage-a11y.json'), JSON.stringify(scans, null, 2));

      // The sweep must be able to see a violation before its emptiness means anything: assert it
      // actually scanned the surfaces it was asked to, not that it found nothing having scanned none.
      const expectedScans = (2 + ANON_PROTECTED.length) * 2 + OPS_PAGES.length * 2 + 1 + 3 * 2;
      checkEqual(scans.length, expectedScans, 'the accessibility sweep did not scan every surface');
      const failures = scans.filter((scan) => scan.violations.length > 0)
        .map((scan) => `${scan.surface} @${scan.width}px: ` +
          scan.violations.map((v) => `[${v.impact}] ${v.id} ${JSON.stringify(v.nodes)}`).join('; '));
      checkEqual(failures.join('\n'), '', 'accessibility violations');
    },
  },
];

const only = (process.env.BROWSER_CHECK_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const selected = only.length ? checks.filter((c) => only.includes(c.name)) : checks;
if (only.length && selected.length !== only.length) {
  throw new Error(`BROWSER_CHECK_ONLY names a check that does not exist: ${only.join(',')}`);
}

await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.FOUNDRY_BROWSER_CHANNEL || 'msedge', headless: true });
const results = [];
try {
  for (const definition of selected) {
    const context = await browser.newContext({ viewport: { width: DESKTOP_WIDTH, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // Same isolation rule as the Foundry check: nothing off-origin is allowed to load.
    await context.route('**/*', (route) => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      countRequest();
      return route.continue();
    });
    const before = assertions;
    let failure = null;
    try {
      await definition.run(page);
      if (pageErrors.length) throw new CheckFailure(`uncaught page errors: ${JSON.stringify(pageErrors)}`);
      const made = assertions - before;
      if (made < definition.minAssertions) {
        throw new CheckFailure(`made ${made} assertions, expected at least ${definition.minAssertions} -- the check did not run to completion`);
      }
    } catch (error) {
      failure = error instanceof CheckFailure
        ? error.message
        : [`${error.name}: ${error.message.split('\n')[0]}`,
           ...String(error.stack || '').split('\n').slice(1, 3).map((line) => 'at ' + line.trim())].join('\n');
      // Where it failed matters as much as what failed: record the URL, the viewport and a picture.
      const where = await page.evaluate(() => ({ url: location.pathname, width: window.innerWidth, text: document.body.innerText.slice(0, 200) })).catch(() => null);
      if (where) failure += `\n on ${where.url} at ${where.width}px; page text: ${JSON.stringify(where.text)}`;
      await page.screenshot({ path: path.join(out, `failure-${definition.name}.png`), fullPage: true }).catch(() => {});
    }
    results.push({ name: definition.name, assertions: assertions - before, passed: !failure, failure });
    console.log(`${failure ? 'FAIL' : 'ok  '} ${definition.name} (${assertions - before} assertions)${failure ? '\n     ' + failure.replace(/\n/g, '\n     ') : ''}`);
    await context.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.passed);
await fs.writeFile(path.join(out, 'coverage-results.json'), JSON.stringify({ passed: failed.length === 0, results }, null, 2));
if (failed.length) {
  console.error(`\nFAIL: ${failed.length}/${results.length} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS: ${results.length} checks, ${results.reduce((total, r) => total + r.assertions, 0)} assertions -- anonymous access, failed sign-in, direct URL entry, ${MOBILE_WIDTH}px viewport, mobile navigation, axe sweep`);
  console.log(`      ${totalRequests} requests, ${pauses} pacing pauses, ${rateLimitedNavigations} rate-limited navigations retried`);
}
