import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiAssistantPanel } from "../src/AiAssistantPanel.js";

function render() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return renderToStaticMarkup(<QueryClientProvider client={client}><AiAssistantPanel scope={{ type: "server", id: "server-1" }} /></QueryClientProvider>); }
test("assistant panel is accessible and always shows no-action notice", () => { const html = render(); assert.match(html, /AI Assistant/); assert.match(html, /Ask about this server/); assert.match(html, /No actions were executed/); assert.match(html, /aria-live="polite"/); });
test("assistant panel uses mobile-safe wrapping and bounded content", () => { const html = render(); assert.match(html, /min-w-0/); assert.match(html, /flex-wrap/); assert.doesNotMatch(html, /w-\[[4-9][0-9]rem\]/); });
