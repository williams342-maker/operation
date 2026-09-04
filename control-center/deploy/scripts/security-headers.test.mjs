import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Security-header ownership — work-order item W7.
//
// The rule: EXACTLY ONE layer sets each header, and it is the layer that owns the response. nginx
// APPENDS add_header to proxied responses, so any layer that re-states a header its upstream already
// set produces a duplicate. The live site was emitting three copies of X-Content-Type-Options,
// Referrer-Policy and X-Frame-Options, and two conflicting Content-Security-Policy headers.
//
// These are static assertions over configuration, which is the honest limit: they prove the configs say
// what we intend, not that a running edge emits one of each. Only a live probe proves that, and the
// serving host is currently unknown (work-order item W1).

const nginx = path.join(import.meta.dirname, "..", "nginx");
const read = (name) => fs.readFileSync(path.join(nginx, name), "utf8");
// Comments explain the rule at length; only real directives count.
const directives = (text) => text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("add_header"));
const headerNames = (text) => directives(text).map((line) => line.split(/\s+/)[1]);

const SECURITY_HEADERS = ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Content-Security-Policy"];

test("the TLS terminator owns HSTS and nothing else", () => {
  // It is the only layer that can meaningfully assert HSTS, and the only one that should. Everything
  // else belongs to whichever layer knows what it is serving.
  const names = headerNames(read("staging.conf"));
  assert.deepEqual(names, ["Strict-Transport-Security"]);
});

test("the internal edge proxy owns nothing", () => {
  // A pure proxy owns no response content, so it is authority for no header describing that content.
  assert.deepEqual(headerNames(read("edge-container.conf")), []);
});

test("only one layer sets HSTS", () => {
  const setters = ["staging.conf", "edge-container.conf", "web.conf"].filter((file) => headerNames(read(file)).includes("Strict-Transport-Security"));
  assert.deepEqual(setters, ["staging.conf"]);
});

test("no security header is set by more than one nginx layer", () => {
  for (const header of SECURITY_HEADERS) {
    const setters = ["staging.conf", "edge-container.conf", "web.conf"].filter((file) => headerNames(read(file)).includes(header));
    assert.ok(setters.length <= 1, `${header} is set by ${setters.length} layers: ${setters.join(", ")} — nginx appends these on proxied responses, so they will duplicate`);
  }
});

test("REGRESSION: every web.conf location that sets any header restates the full security set", () => {
  // nginx applies add_header from an outer block ONLY IF the inner block declares none. A location that
  // adds Cache-Control therefore silently DISCARDS every security header above it. Both locations here
  // hit exactly that, and the duplicate headers at the edge were masking it: the JS/CSS bundles and
  // install.sh were relying on a downstream layer to re-add what this one had dropped. Removing the
  // duplication without this restatement would have turned a hidden hole into a real one.
  const text = read("web.conf");
  const blocks = text.split(/location\s/).slice(1);
  assert.ok(blocks.length >= 3, "expected the location blocks to still be present");
  for (const block of blocks) {
    const names = headerNames(block);
    if (names.length === 0) continue; // inherits the server block correctly
    for (const header of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options"]) {
      assert.ok(names.includes(header), `location "${block.split("{")[0].trim()}" sets add_header but omits ${header}; nginx will drop the inherited one`);
    }
  }
});

test("the static CSP is not weaker than the edge CSP it replaced", () => {
  // The edge CSP was removed; web.conf now carries it. If a directive were dropped in the move, the
  // policy would quietly loosen — which is exactly how this kind of consolidation goes wrong.
  const csp = directives(read("web.conf")).find((line) => line.includes("Content-Security-Policy"));
  assert.ok(csp, "web.conf must carry the document CSP");
  for (const directive of ["default-src 'self'", "script-src", "style-src", "img-src", "connect-src", "frame-src", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) {
    assert.ok(csp.includes(directive), `static CSP lost ${directive}`);
  }
});

test("helmet states font-src explicitly so removing the second CSP cannot loosen it", () => {
  // The removed edge CSP omitted font-src, so it fell back to default-src 'self'. Browsers enforce every
  // CSP header they receive, so the EFFECTIVE font-src was the intersection: 'self'. helmet's default is
  // "'self' https: data:", so deleting the edge header alone would have widened font-src to any https
  // origin. This is the trap in "just remove the duplicate".
  const server = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "apps", "api", "src", "server.ts"), "utf8");
  const fontSrc = server.match(/"font-src":\s*\[([^\]]*)\]/);
  assert.ok(fontSrc, "helmet must state font-src explicitly rather than inheriting a wider default");
  assert.match(fontSrc[1], /'self'/);
  assert.doesNotMatch(fontSrc[1], /https:/, "font-src must not allow arbitrary https origins");
});
