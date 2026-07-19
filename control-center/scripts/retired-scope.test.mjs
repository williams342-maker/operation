import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const controlCenterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(controlCenterRoot, "..");
const retiredDirectories = [".emergent", "android", "backend", "cloudflare", "database", "frontend", "ios", "memory", "scripts", "tests", "test_reports"];
const retiredIdentifiers = [
  "emergent" + "integrations",
  "emergent" + "_llm_key",
  "emergent" + "agent.com",
  "williams" + " cnc",
  "williams" + "cnc",
  "williams" + " innovation",
  "williams" + "innovation",
  "stripe" + "_api_key",
  "stripe" + "_secret_key",
  "paypal" + "_client_secret",
  "crafters" + "market",
];

function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "release-output"].includes(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(fullPath));
    else if (!fullPath.endsWith(path.join("docs", "gitleaks-triage-report.md"))) files.push(fullPath);
  }
  return files;
}

test("legacy commerce and hosted-platform subsystems remain absent", () => {
  for (const directory of retiredDirectories) {
    assert.equal(fs.existsSync(path.join(repositoryRoot, directory)), false, `${directory} must remain retired`);
  }
  for (const file of sourceFiles(repositoryRoot)) {
    const content = fs.readFileSync(file, "utf8").toLowerCase();
    for (const identifier of retiredIdentifiers) {
      assert.equal(content.includes(identifier), false, `${identifier} reappeared in ${path.relative(repositoryRoot, file)}`);
    }
  }
});
