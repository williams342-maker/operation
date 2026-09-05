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

// LOCATION BLOCKS, from real directives only.
//
// The first version of this split on /location\s/ across the whole file, which also matched the word
// inside the comments explaining the rule — and those comments sit directly above the server-level
// add_header directives, so the text after such a match contained the full header set and every check
// below passed on it. An independent reviewer caught it by deleting all five add_header lines from the
// admin asset location and watching the suite stay green. A guard whose parser can be satisfied by the
// prose describing it is worse than no guard, because it reports success.
//
// Comments go first, then the split anchors to a line start. `directives` already ignores commented
// lines; this makes the block boundaries ignore them too.
const locationBlocks = (text) => text
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n")
  .split(/^\s*location\s/m)
  .slice(1);
const locationName = (block) => block.split("{")[0].trim();

const SECURITY_HEADERS = ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Content-Security-Policy"];

// EVERY config in the directory, discovered rather than listed. `admin-web.conf` reached production
// without ever entering this repository, so the inheritance rule below -- written for exactly the
// mistake it makes -- never looked at it. A hard-coded file list is a guard that only protects the
// files someone remembered to add to it.
const configs = () => fs.readdirSync(nginx).filter((name) => name.endsWith(".conf")).sort();

// The public site's layers, in the order a response passes through them. This list stays explicit
// because it means something specific -- these three are stacked, so a header set twice DUPLICATES.
//
// `admin-web.conf` is deliberately not here, and it is not an oversight. The admin console is a
// SIBLING ORIGIN, not another layer: `opsworkbench-admin-web-1` publishes on `127.0.0.1:18081` while
// the edge publishes on `127.0.0.1:18080`, so an admin response never traverses the edge and never
// meets `web.conf`. Both files set the same three headers and both are right to.
const PUBLIC_SITE_LAYERS = ["staging.conf", "edge-container.conf", "web.conf"];

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

test("no location that proxies also sets a security header", () => {
  // The same rule one level down, and the level the file-by-file tests above cannot see. A whole config
  // can be the sole owner of its origin's responses and still contain ONE location that hands the
  // response to something else — and nginx appends add_header to a proxied response, so that location
  // emits a second copy of whatever the upstream already set.
  //
  // `admin-web.conf` did exactly this. Its /api/ proxies to the API, which sets these three via helmet,
  // and the server block added them again. Measured through the running container on 2026-09-05,
  // GET /api/healthz returned X-Content-Type-Options, Referrer-Policy and X-Frame-Options TWICE. The
  // per-file checks were all satisfied: this origin genuinely is the only nginx layer in front of that
  // response. The layer it forgot to count was the application.
  //
  // The fix was structural — the server block owns nothing and each nginx-served location restates the
  // set — so this test is what stops a future edit from putting a header back on the server block and
  // silently reintroducing the duplicate on every proxied path underneath it.
  // Scoped to SECURITY_HEADERS, and the scope is the point. These describe the RESPONSE CONTENT, which
  // is what an upstream application also has an opinion about, so these are the ones that stack. HSTS is
  // not one of them: it describes the TRANSPORT, only the TLS terminator can assert it, and `staging.conf`
  // both proxies and sets it entirely correctly. Writing this rule over every header instead of these
  // four failed on exactly that, which is the difference between the two kinds of header rather than an
  // exception to a rule.
  const contentHeaders = (text) => headerNames(text).filter((name) => SECURITY_HEADERS.includes(name));
  for (const file of configs()) {
    const text = read(file);
    const proxying = locationBlocks(text).filter((block) => /proxy_pass\s/.test(block));
    for (const block of proxying) {
      assert.deepEqual(contentHeaders(block), [],
        `${file}: location '${locationName(block)}' proxies AND sets ${contentHeaders(block).join(", ")}; nginx appends these to the upstream's own copy`);
    }
    // A server-level add_header reaches every location that declares none, including the proxying ones,
    // so for a config that proxies at all the server block must own no content header either.
    if (proxying.length > 0) {
      const serverLevel = contentHeaders(text.split(/^\s*location\s/m)[0]);
      assert.deepEqual(serverLevel, [],
        `${file} proxies, so its server block must set no content header of its own; found ${serverLevel.join(", ")}`);
    }
  }
});

test("only one layer sets HSTS", () => {
  const setters = PUBLIC_SITE_LAYERS.filter((file) => headerNames(read(file)).includes("Strict-Transport-Security"));
  assert.deepEqual(setters, ["staging.conf"]);
});

// The guard that would have caught `admin-web.conf` on the day it was written. A new config here is
// either a layer of the public site or a separate origin, and BOTH answers are fine -- what is not
// fine is a third file quietly inheriting neither set of rules because no test names it.
test("every nginx config is classified as a public-site layer or a separate origin", () => {
  const SEPARATE_ORIGINS = ["admin-web.conf"];
  const classified = [...PUBLIC_SITE_LAYERS, ...SEPARATE_ORIGINS].sort();
  assert.deepEqual(configs(), classified,
    "an nginx config is present that no test has decided about; add it to PUBLIC_SITE_LAYERS if a response passes through it on its way out of another one, or to SEPARATE_ORIGINS if it is served on its own port");
});

test("no security header is set by more than one nginx layer", () => {
  for (const header of SECURITY_HEADERS) {
    const setters = PUBLIC_SITE_LAYERS.filter((file) => headerNames(read(file)).includes(header));
    assert.ok(setters.length <= 1, `${header} is set by ${setters.length} layers: ${setters.join(", ")} — nginx appends these on proxied responses, so they will duplicate`);
  }
});

test("REGRESSION: every location in every config that sets any header restates the full security set", () => {
  // nginx applies add_header from an outer block ONLY IF the inner block declares none. A location that
  // adds Cache-Control therefore silently DISCARDS every security header above it. Both locations here
  // hit exactly that, and the duplicate headers at the edge were masking it: the JS/CSS bundles and
  // install.sh were relying on a downstream layer to re-add what this one had dropped. Removing the
  // duplication without this restatement would have turned a hidden hole into a real one.
  //
  // `admin-web.conf` failed this the moment it was added, and not theoretically: measured against the
  // running container on 2026-09-05, `GET /` returned all five headers and `GET /assets/index-*.js`
  // returned Cache-Control and X-Robots-Tag alone — three security headers discarded. The admin
  // console's JavaScript and stylesheets were served without X-Content-Type-Options while its own HTML
  // had it.
  const found = {};
  for (const file of configs()) {
    found[file] = [];
    for (const block of locationBlocks(read(file))) {
      const names = headerNames(block);
      if (names.length === 0) continue; // owns no header of its own
      found[file].push(locationName(block));
      for (const header of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options"]) {
        assert.ok(names.includes(header), `${file}: location '${locationName(block)}' sets add_header but omits ${header}; nginx will drop the inherited one`);
      }
    }
  }
  // NAMED, not counted. A total only proves the parser found something; these say WHICH locations own
  // headers, so deleting the directives from one of them fails here even when another still has some —
  // which is precisely the mutation a bare count let through. Adding or removing a header-setting
  // location is a decision, and it should have to be made twice.
  assert.deepEqual(found, {
    "admin-web.conf": ["= /admin-healthz", "/", "~* \\.(?:js|css|woff2?)$", "= /admin-healthz"],
    "edge-container.conf": [],
    "staging.conf": [],
    "web.conf": ["= /install.sh", "~* \\.(?:js|css|woff2?)$"]
  });
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
