import fs from "node:fs";
import { runBetaDeploymentPreflight, serializePreflightReport, withBetaPreflightTemporaryFiles, type BetaDeploymentPreflightInput } from "./betaDeploymentPreflight.js";

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write("Usage: npm run preflight:beta -- <value-free-input.json>\n");
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as BetaDeploymentPreflightInput;
    const result = await withBetaPreflightTemporaryFiles(input, () => runBetaDeploymentPreflight(input));
    process.stdout.write(serializePreflightReport(result));
    process.exitCode = result.status.startsWith("PASS") ? 0 : 1;
  } catch {
    process.stderr.write("Beta deployment preflight could not read the value-free input file.\n");
    process.exitCode = 2;
  }
}
