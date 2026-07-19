import assert from "node:assert/strict";
import test from "node:test";
import { decryptConfigurationValue, encryptConfigurationValue, valueFingerprint } from "../src/configurationVault.js";

test("configuration secrets use unique envelope keys and authenticated scope binding", () => {
  const previous = process.env.CONTROL_CENTER_ENCRYPTION_KEY;
  process.env.CONTROL_CENTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const first = encryptConfigurationValue("not-a-real-secret", "org:def:env:1");
    const second = encryptConfigurationValue("not-a-real-secret", "org:def:env:1");
    assert.notEqual(first.wrappedKey, second.wrappedKey);
    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.equal(decryptConfigurationValue(first, "org:def:env:1"), "not-a-real-secret");
    assert.throws(() => decryptConfigurationValue(first, "other-scope"));
    assert.notEqual(valueFingerprint("same-value", "server-a"), valueFingerprint("same-value", "server-b"));
  } finally {
    if (previous === undefined) delete process.env.CONTROL_CENTER_ENCRYPTION_KEY; else process.env.CONTROL_CENTER_ENCRYPTION_KEY = previous;
  }
});
