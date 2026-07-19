import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/SystemHealthCard.tsx", import.meta.url), "utf8");
test("health dashboard requests the authenticated system report and renders required subsystems", () => { assert.match(source, /api\.get\("\/system\/health"\)/); for (const label of ["API", "MongoDB", "Agent", "Workers", "AI", "Organizations", "Audit", "Rate limiting", "Cache"]) assert.match(source, new RegExp(`\\["${label}"`)); assert.match(source, /Provider configuration/); assert.match(source, /Version \/ commit/); });
test("health dashboard remains responsive and does not render credential values", () => { assert.match(source, /sm:grid-cols-2 lg:grid-cols-3/); assert.match(source, /credential \{state\?\.ai\?\.credentialPresent \? "present" : "absent"\}/); assert.doesNotMatch(source, /state\?\.ai\?\.apiKey/); });
test("health dashboard renders permission errors without fallback infrastructure data", () => { assert.match(source, /system\.error &&/); assert.match(source, /apiError\(system\.error\)/); });
