import React from "react";

export type TaskState = "queued" | "claimed" | "running" | "succeeded" | "failed" | "expired" | "cancelled";

const terminalFallbacks: Record<Extract<TaskState, "succeeded" | "failed" | "expired" | "cancelled">, string> = {
  succeeded: "Task completed successfully",
  failed: "Task failed",
  expired: "Task expired",
  cancelled: "Task cancelled"
};

export function taskDisplaySummary(state: TaskState | undefined, storedSummary: unknown) {
  if (!state || !["succeeded", "failed", "expired", "cancelled"].includes(state)) return undefined;
  const fallback = terminalFallbacks[state as keyof typeof terminalFallbacks];
  if (state === "expired" || state === "cancelled") return fallback;
  if (typeof storedSummary !== "string" || !storedSummary.trim()) return fallback;
  const opposite = state === "succeeded" ? terminalFallbacks.failed : terminalFallbacks.succeeded;
  return storedSummary.trim().toLowerCase() === opposite.toLowerCase() ? fallback : storedSummary.trim();
}

export function TaskResultSummary({ state, summary }: { state?: TaskState; summary?: unknown }) {
  const display = taskDisplaySummary(state, summary);
  if (!display) return null;
  return <div data-testid="task-result-summary">{display}</div>;
}
