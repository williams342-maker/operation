import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscoveryStatusPanel } from "../src/DiscoveryStatusPanel.js";
for (const [state, label] of [["success", "Current"], ["stale", "Stale"], ["truncated", "Truncated"], ["partial", "Partial"], ["agent_incompatible", "Agent upgrade required"], ["agent_offline", "Agent offline"], ["loading", "Loading"], ["discovery_failed", "Discovery failed"], ["permission_denied", "Permission denied"], ["empty", "No applications detected"]] as const) {
  test(`renders ${state} discovery state`, () => { const html = renderToStaticMarkup(<DiscoveryStatusPanel state={state} collectedAt="2026-01-01T00:00:00.000Z" onRetry={() => undefined} onHelp={() => undefined} />); assert.match(html, new RegExp(label)); if (state === "discovery_failed" || state === "permission_denied") assert.match(html, /Applications could not be refreshed/); });
}
