import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/AiSettingsCard.tsx", import.meta.url), "utf8");
test("AI settings UI never renders credential or arbitrary URL inputs", () => { assert.equal(source.includes("AI_API_KEY"), false); assert.equal(source.includes("baseUrl"), false); assert.match(source, /Credential configured/); });
test("AI settings UI includes accessible mobile-safe disclosure and no-action notice", () => { assert.match(source, /Privacy and cost disclosure/); assert.match(source, /No actions can be executed/); assert.match(source, /Test selected provider/); assert.match(source, /without generating content/); assert.match(source, /min-w-0/); assert.match(source, /flex-wrap/); });
