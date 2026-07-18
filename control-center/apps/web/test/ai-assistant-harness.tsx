import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiAssistantPanel } from "../src/AiAssistantPanel";
import { api } from "../src/api";
import "../src/styles.css";

api.defaults.adapter = async (config) => {
  if (config.url === "/ai-assistant/status") return { data: { enabled: true, configured: true, provider: "mock", model: "deterministic-v1", readOnly: true }, status: 200, statusText: "OK", headers: {}, config };
  return { data: { result: { summary: "The server is reachable and the latest evidence is informational.", status: "healthy", confidence: "high", risk: "low", likelyCauses: [], recommendedSteps: [{ order: 1, title: "Review current health", description: "Confirm the latest health timestamp before making a manual decision.", actionType: "manual_diagnostic" }], evidence: [{ sourceType: "server", label: "Server status", value: "online" }], limitations: ["Secrets are excluded."], executedActions: [], generatedAt: new Date().toISOString() }, metadata: { redactions: { token: 1 }, noActionsExecuted: true } }, status: 200, statusText: "OK", headers: {}, config };
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={client}><main className="mx-auto max-w-3xl p-4"><AiAssistantPanel scope={{ type: "server", id: "browser-test-server" }} /></main></QueryClientProvider></React.StrictMode>);
