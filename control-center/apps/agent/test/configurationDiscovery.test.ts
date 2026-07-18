import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverConfiguration } from "../src/configurationDiscovery.js";

test("configuration discovery returns names and metadata but never environment values", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ops-config-discovery-"));
  try {
    fs.writeFileSync(path.join(root, ".env.example"), "STRIPE_API_KEY=example-placeholder\nPUBLIC_ORIGIN=https://example.invalid\n", "utf8");
    fs.writeFileSync(path.join(root, ".env"), "STRIPE_API_KEY=do-not-return-this-value\n", "utf8");
    fs.writeFileSync(path.join(root, "index.ts"), "const value = process.env.CUSTOM_TOKEN;", "utf8");
    const result = discoverConfiguration([{ path: root }]);
    assert.ok(result.settings.some((setting) => setting.name === "STRIPE_API_KEY" && setting.configured));
    assert.ok(result.settings.some((setting) => setting.name === "CUSTOM_TOKEN" && setting.secret));
    assert.equal(JSON.stringify(result).includes("do-not-return-this-value"), false);
    assert.equal(JSON.stringify(result).includes("example-placeholder"), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
