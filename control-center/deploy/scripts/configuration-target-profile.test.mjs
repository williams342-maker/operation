import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const deployRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetsRoot = path.join(deployRoot, "targets");
const objectId = /^[a-f0-9]{24}$/;
const digest = /^[a-f0-9]{64}$/;
const safeId = /^[A-Za-z0-9._:-]{1,160}$/;
const expectedKeys = [
  "composeOverridePaths",
  "composePath",
  "composeProject",
  "currentConfigurationDigest",
  "environmentFilePath",
  "environmentId",
  "healthChecks",
  "projectId",
  "protectedServices",
  "repositoryRoot",
  "serverId",
  "statelessServices"
].sort();

function isContained(root, candidate) {
  const resolvedRoot = path.posix.resolve(root);
  const resolvedCandidate = path.posix.resolve(candidate);
  return resolvedCandidate !== resolvedRoot && resolvedCandidate.startsWith(`${resolvedRoot}/`);
}

for (const file of fs.readdirSync(targetsRoot).filter((name) => name.endsWith(".profile.json"))) {
  test(`${file} is a bounded non-production target request`, () => {
    const profile = JSON.parse(fs.readFileSync(path.join(targetsRoot, file), "utf8"));
    assert.deepEqual(Object.keys(profile).sort(), expectedKeys);
    assert.match(profile.projectId, objectId);
    assert.match(profile.environmentId, objectId);
    assert.match(profile.serverId, objectId);
    assert.match(profile.currentConfigurationDigest, digest);
    assert.ok(path.posix.isAbsolute(profile.repositoryRoot));

    const composePaths = [profile.composePath, ...profile.composeOverridePaths];
    assert.ok(profile.composeOverridePaths.length > 0, "release override must be explicit");
    assert.equal(new Set(composePaths).size, composePaths.length, "Compose paths must be unique");
    for (const candidate of [profile.environmentFilePath, ...composePaths]) {
      assert.ok(path.posix.isAbsolute(candidate));
      assert.ok(isContained(profile.repositoryRoot, candidate), `${candidate} must remain inside repositoryRoot`);
    }

    assert.match(profile.composeProject, safeId);
    assert.ok(profile.statelessServices.length > 0);
    assert.equal(new Set(profile.statelessServices).size, profile.statelessServices.length);
    assert.equal(new Set(profile.protectedServices).size, profile.protectedServices.length);
    for (const service of [...profile.statelessServices, ...profile.protectedServices]) assert.match(service, safeId);
    for (const service of profile.statelessServices) assert.ok(!profile.protectedServices.includes(service));

    assert.ok(profile.healthChecks.length > 0);
    for (const check of profile.healthChecks) {
      assert.deepEqual(Object.keys(check).sort(), ["id", "timeoutMs", "url"]);
      assert.match(check.id, safeId);
      assert.ok(Number.isInteger(check.timeoutMs) && check.timeoutMs >= 100 && check.timeoutMs <= 30_000);
      const url = new URL(check.url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.username, "");
      assert.equal(url.password, "");
      assert.equal(url.search, "");
      assert.equal(url.hash, "");
    }
  });
}
