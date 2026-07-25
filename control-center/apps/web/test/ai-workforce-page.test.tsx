import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/AiWorkforcePage.tsx", import.meta.url), "utf8");
test("AI Workforce page exposes bounded queue and queued-only cancellation", () => { assert.match(source, /\/ai-workforce\/runs/); assert.match(source, /run\.state === "queued"/); assert.match(source, /Queue run/); assert.match(source, /Cancel/); });
test("AI Workforce page discloses opt-in workers and no mock credit use", () => { assert.match(source, /only when an administrator enables/); assert.match(source, /consumes no provider credits/); assert.doesNotMatch(source, /API_KEY|credential|baseUrl/); });
