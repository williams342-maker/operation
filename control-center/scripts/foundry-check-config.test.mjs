import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFoundryCheckConfig, isLoopbackOrigin, LOCAL_ORIGIN, LOCAL_EMAIL, LOCAL_PASSWORD } from './foundry-check-config.mjs';

const REMOTE = 'https://staging.example.invalid';
const remote = (extra = {}) => ({ FOUNDRY_ORIGIN: REMOTE, FOUNDRY_ALLOW_REMOTE: 'true', FOUNDRY_EMAIL: 'reviewer@example.invalid', FOUNDRY_PASSWORD: 'a-credential-that-is-not-in-this-repo', ...extra });

test('defaults to the local preview with its disposable credentials', () => {
  const c = resolveFoundryCheckConfig({});
  assert.equal(c.origin, LOCAL_ORIGIN);
  assert.equal(c.email, LOCAL_EMAIL);
  assert.equal(c.password, LOCAL_PASSWORD);
  assert.equal(c.loopback, true);
  assert.equal(c.organizationSlug, undefined);
});

test('a loopback origin on another port is still loopback', () => {
  for (const origin of ['http://127.0.0.1:5000', 'http://localhost:4179', 'http://[::1]:4179']) {
    assert.equal(isLoopbackOrigin(origin), true, origin);
    assert.equal(resolveFoundryCheckConfig({ FOUNDRY_ORIGIN: origin }).loopback, true, origin);
  }
});

test('a host merely containing "localhost" is NOT loopback', () => {
  // Substring matching here would be a way to smuggle the built-in credentials to a real host.
  for (const origin of ['https://localhost.example.invalid', 'https://not-127.0.0.1.example.invalid']) {
    assert.equal(isLoopbackOrigin(origin), false, origin);
  }
});

test('THE RULE: the published local credentials are never sent to a non-loopback origin', () => {
  assert.throws(
    () => resolveFoundryCheckConfig(remote({ FOUNDRY_EMAIL: LOCAL_EMAIL })),
    /published in this repository/);
  assert.throws(
    () => resolveFoundryCheckConfig(remote({ FOUNDRY_PASSWORD: LOCAL_PASSWORD })),
    /published in this repository/);
});

test('a remote origin needs explicit acknowledgement that the journey writes data', () => {
  assert.throws(
    () => resolveFoundryCheckConfig({ FOUNDRY_ORIGIN: REMOTE, FOUNDRY_EMAIL: 'a@b.invalid', FOUNDRY_PASSWORD: 'x' }),
    /FOUNDRY_ALLOW_REMOTE=true/);
});

test('a remote origin requires credentials rather than inheriting the local ones', () => {
  assert.throws(
    () => resolveFoundryCheckConfig({ FOUNDRY_ORIGIN: REMOTE, FOUNDRY_ALLOW_REMOTE: 'true' }),
    /required for a non-loopback origin/);
  assert.throws(
    () => resolveFoundryCheckConfig({ FOUNDRY_ORIGIN: REMOTE, FOUNDRY_ALLOW_REMOTE: 'true', FOUNDRY_EMAIL: 'a@b.invalid' }),
    /required for a non-loopback origin/);
});

test('a fully specified remote configuration resolves', () => {
  const c = resolveFoundryCheckConfig(remote({ FOUNDRY_ORG_SLUG: 'acme' }));
  assert.equal(c.origin, REMOTE);
  assert.equal(c.loopback, false);
  assert.equal(c.organizationSlug, 'acme');
  assert.equal(c.email, 'reviewer@example.invalid');
});

test('a trailing slash does not turn loopback into a remote host', () => {
  const c = resolveFoundryCheckConfig({ FOUNDRY_ORIGIN: 'http://127.0.0.1:4179/' });
  assert.equal(c.origin, LOCAL_ORIGIN);
  assert.equal(c.loopback, true);
});

test('a malformed or non-http origin is refused', () => {
  assert.throws(() => resolveFoundryCheckConfig({ FOUNDRY_ORIGIN: 'not a url' }), /not a valid URL/);
  assert.throws(() => resolveFoundryCheckConfig({ FOUNDRY_ORIGIN: 'file:///etc/passwd' }), /must be http or https/);
});

test('on loopback an empty credential falls back to the local fixture', () => {
  // An unset variable expands to empty, and on loopback the only account that exists is the
  // fixture, so substituting it is harmless and keeps the default invocation working. This is
  // asserted rather than left implicit because the same leniency would be dangerous off-box --
  // and there it is not lenient, as the next case shows.
  const c = resolveFoundryCheckConfig({ FOUNDRY_ORIGIN: LOCAL_ORIGIN, FOUNDRY_EMAIL: '', FOUNDRY_PASSWORD: '' });
  assert.equal(c.email, LOCAL_EMAIL);
  assert.equal(c.password, LOCAL_PASSWORD);
});

test('off-box an empty credential is refused, not defaulted', () => {
  assert.throws(
    () => resolveFoundryCheckConfig({ FOUNDRY_ORIGIN: REMOTE, FOUNDRY_ALLOW_REMOTE: 'true', FOUNDRY_EMAIL: '', FOUNDRY_PASSWORD: '' }),
    /required for a non-loopback origin/);
});
