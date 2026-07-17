import test from "node:test";
import assert from "node:assert/strict";
import { parseComposePsLine, parseDockerPsLine } from "../src/parsers.js";

test("docker status parser maps fixed docker ps JSON output", () => {
  assert.deepEqual(parseDockerPsLine(JSON.stringify({ Names: "api", Image: "node:22", State: "running", Status: "Up 3m" })), {
    name: "api",
    image: "node:22",
    state: "running",
    status: "Up 3m"
  });
});

test("compose parser maps compose ps JSON output", () => {
  assert.deepEqual(parseComposePsLine(JSON.stringify({ Project: "site", Service: "web", State: "running" }), "fallback", "/srv/site/compose.yml"), {
    projectName: "site",
    service: "web",
    state: "running",
    configPath: "/srv/site/compose.yml"
  });
});
