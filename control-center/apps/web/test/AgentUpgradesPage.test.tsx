import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentUpgradesPage } from "../src/AgentUpgradesPage.js";

test("fleet upgrade page exposes lifecycle summaries, all filters, and safe controls", () => {
  const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><AgentUpgradesPage toast={() => undefined} /></QueryClientProvider>);
  for (const label of ["Fleet agent upgrades", "Total", "Online", "Offline", "Up to date", "Available", "Required", "Bootstrap", "Project filter", "Agent version filter", "Upgrade status filter", "Operating system filter", "Architecture filter", "Release channel filter", "Environment filter", "Protected filter"]) assert.match(html, new RegExp(label, "i"));
  assert.match(html, /Production and protected servers remain unavailable/);
  assert.doesNotMatch(html, /\b(?:ssh|sudo|curl|bash|systemctl)\b/i);
  assert.doesNotMatch(html, /token|password|private key|client secret/i);
});
