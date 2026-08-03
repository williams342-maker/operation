import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseEndpointJson } from "./staging-smoke-response.mjs";

test("accepts an authenticated JSON endpoint contract", () => {
  const body = parseEndpointJson("/api/overview", {
    status: 200,
    contentType: "application/json; charset=utf-8",
    text: JSON.stringify({ recentAudit: [] }),
  }, { authenticated: true });
  assert.deepEqual(body, { recentAudit: [] });
});

test("reports an HTML fallback before attempting JSON parsing", () => {
  assert.throws(() => parseEndpointJson("/api/overview", {
    status: 404,
    contentType: "text/html; charset=utf-8",
    text: "<!DOCTYPE html><title>Not found</title>",
  }, { authenticated: true }), /HTTP 404 text\/html.*HTML fallback detected/);
});

test("does not treat an unauthenticated JSON 401 as endpoint validation", () => {
  assert.throws(() => parseEndpointJson("/api/missing", {
    status: 401,
    contentType: "application/json; charset=utf-8",
    text: JSON.stringify({ error: "Authentication required" }),
  }, { authenticated: true }), /unauthenticated response does not validate endpoint existence/i);
});

test("reports invalid JSON with an endpoint-contract error", () => {
  assert.throws(() => parseEndpointJson("/api/overview", {
    status: 200,
    contentType: "application/json",
    text: "not-json",
  }, { authenticated: true }), /declared JSON but contained invalid JSON/);
});

test("staging smoke uses the supported overview contract", () => {
  const source = fs.readFileSync(new URL("./staging-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /api\("\/api\/overview"\)/);
  assert.doesNotMatch(source, /\/api\/dashboard/);
  assert.match(source, /parseEndpointJson\(path, response, \{ authenticated: true \}\)/);
});

test("staging smoke targets the page-level Projects heading semantically", () => {
  const source = fs.readFileSync(new URL("./staging-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /getByRole\("heading", \{ name: "Projects", level: 1 \}\)/);
  assert.doesNotMatch(source, /getByRole\("heading", \{ name: "Projects" \}\)/);
  assert.doesNotMatch(source, /getByRole\("heading", \{ name: "Projects"[^}]*\}\)\.(?:first|last|nth)\(/);
});
