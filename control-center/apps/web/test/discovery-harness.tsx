import React from "react";
import { createRoot } from "react-dom/client";
import { DiscoveryStatusPanel } from "../src/DiscoveryStatusPanel";
const states = ["success", "stale", "truncated", "partial", "agent_incompatible", "agent_offline", "loading", "discovery_failed", "permission_denied", "empty"] as const;
function Harness() { return <main className="min-h-screen bg-background p-4 text-text"><h1 className="mb-4 text-xl font-semibold">Server Application Discovery States</h1><div className="grid gap-4 md:grid-cols-2">{states.map((state) => <section key={state} data-state={state} className="rounded-lg border border-border bg-panel p-4"><DiscoveryStatusPanel state={state} collectedAt={state === "agent_incompatible" ? undefined : "2026-01-01T00:00:00.000Z"} onRetry={() => undefined} onHelp={() => undefined} />{["success", "stale", "truncated", "partial"].includes(state) && <div className="mt-3 text-sm"><strong>Last known applications</strong><div>Docker: frontend, backend, mongo</div><div>Git: sanitized/repository — main</div></div>}</section>)}</div></main>; }
createRoot(document.getElementById("root")!).render(<Harness />);
