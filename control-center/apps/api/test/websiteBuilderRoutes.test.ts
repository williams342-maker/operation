import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/websiteBuilderRoutes.ts", import.meta.url), "utf8");

test("website builder routes preserve authentication and role boundaries", () => {
  assert.match(source, /get\("\/projects\/:id\/website-builder"[\s\S]*requirePermission\("status:view"\)/);
  assert.match(source, /post\("\/projects\/:id\/website-builder\/drafts"[\s\S]*requirePermission\("projects:manage"\)/);
  assert.match(source, /post\("\/projects\/:id\/website-builder\/generate"[\s\S]*requirePermission\("projects:manage"\)[\s\S]*requirePermission\("ai:use"\)/);
});

test("website builder records saves, generation, failures, and usage", () => {
  for (const action of ["website.builder.save", "website.builder.generate", "website.builder.failure"]) assert.match(source, new RegExp(action.replaceAll(".", "\\.")));
  assert.match(source, /reserveAiUsage/);
  assert.match(source, /completeAiUsage/);
  assert.match(source, /questionDigest/);
});

test("website builder remains draft-only", () => {
  assert.match(source, /publication: \{ enabled: false/);
  assert.doesNotMatch(source, /createTask|projectDeployments\.insert|release\.publish|configuration\.deployment/);
});
