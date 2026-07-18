import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigurationPage } from "../src/ConfigurationPage.js";

test("configuration page declares read-only deployment state and does not render credentials", () => {
  const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><ConfigurationPage toast={() => undefined} /></QueryClientProvider>);
  assert.match(html, /Read-only agent mode/);
  assert.match(html, /Deployment remains disabled/i);
  assert.match(html, /Secret values never appear/);
  assert.doesNotMatch(html, /api[_ -]?key value|credential value|ciphertext/i);
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /Guided Onboarding/);
  assert.match(html, /Import \.env/);
  assert.match(html, /Promote Settings/);
});
