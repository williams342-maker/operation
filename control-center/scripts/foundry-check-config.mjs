// Resolve where the Foundry browser check points and who it signs in as.
//
// Separated from the check itself so the rules below can be tested without launching a browser,
// and so they are evaluated BEFORE one is launched: a misconfiguration should fail in
// milliseconds, not after Chromium starts.
//
// The check used to hardcode `http://127.0.0.1:4179` and the credentials seeded by
// scripts/foundry-local-preview.ts. That made it unusable against a deployed environment, and the
// obvious workaround -- seeding those same credentials there -- is the dangerous one: the password
// is published in this repository, so a staging host reachable from the internet would gain an
// Owner account whose credentials anyone can read. The rules here exist to make that specific
// mistake impossible rather than merely discouraged.

export const LOCAL_ORIGIN = 'http://127.0.0.1:4179';
export const LOCAL_EMAIL = 'foundry@example.invalid';
export const LOCAL_PASSWORD = 'disposable-local-review-only';

const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

export function isLoopbackOrigin(origin) {
  return LOOPBACK.test(String(origin).replace(/\/+$/, ''));
}

export function resolveFoundryCheckConfig(env = {}) {
  const origin = String(env.FOUNDRY_ORIGIN || LOCAL_ORIGIN).replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error(`FOUNDRY_ORIGIN is not a valid URL: ${origin}`); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`FOUNDRY_ORIGIN must be http or https: ${origin}`);

  const loopback = isLoopbackOrigin(origin);
  const email = env.FOUNDRY_EMAIL || (loopback ? LOCAL_EMAIL : '');
  const password = env.FOUNDRY_PASSWORD || (loopback ? LOCAL_PASSWORD : '');
  const organizationSlug = env.FOUNDRY_ORG_SLUG || undefined;

  if (!loopback) {
    // The journey CREATES a project, requests a preview and approves it. Against a shared
    // environment that is a data mutation, so it is opt-in per run rather than a side effect of
    // setting an origin -- the same discipline the images workflow applies to publishing.
    if (env.FOUNDRY_ALLOW_REMOTE !== 'true') {
      throw new Error(
        `Refusing to run against ${origin}: this journey creates and approves a project. ` +
        'Set FOUNDRY_ALLOW_REMOTE=true to acknowledge that it writes data there.');
    }
    if (!email || !password) {
      throw new Error(
        `FOUNDRY_EMAIL and FOUNDRY_PASSWORD are required for a non-loopback origin (${origin}). ` +
        'The built-in credentials are local-preview fixtures and are never sent off-box.');
    }
    // The rule that matters. These are published in this repository; sending them anywhere
    // reachable is how a public Owner account gets created.
    if (email === LOCAL_EMAIL || password === LOCAL_PASSWORD) {
      throw new Error(
        'Refusing to send the disposable local-preview credentials to a non-loopback origin. ' +
        'They are published in this repository; use credentials that are not.');
    }
  }

  if (!email || !password) throw new Error('FOUNDRY_EMAIL and FOUNDRY_PASSWORD must both be set');

  return { origin, email, password, organizationSlug, loopback };
}
