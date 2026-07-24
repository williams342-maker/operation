import { useQuery } from "@tanstack/react-query";
import { api, apiError } from "./api";
import { Badge, Card, Skeleton } from "./ui";

export function SystemHealthCard() {
  const system = useQuery({
    queryKey: ["system-health"],
    queryFn: () => api.get("/system/health").then((response) => response.data),
    refetchInterval: 30_000,
  });
  const state = system.data;
  const healthItems = state
    ? [
        ["API", state.api?.status],
        ["MongoDB", state.mongo?.status],
        ["Agent", state.agent?.status],
        ["Workers", state.backgroundWorkers?.status],
        ["AI", state.ai?.status],
        ["Organization AI", state.ai?.organizationState],
        ["Audit", state.audit?.status],
        ["Rate limiting", state.rateLimiting?.status],
        ["Cache", state.cache?.status],
      ]
    : [];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">System Health</h2>
          <p className="text-sm text-muted">Secret-free staging readiness and build identity.</p>
        </div>
        {state && <Badge tone={state.status === "ready" ? "success" : "warning"}>{state.status}</Badge>}
      </div>
      {system.isLoading ? (
        <Skeleton />
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {healthItems.map(([label, value]) => (
              <div className="min-w-0 rounded-md border border-border p-3" key={label}>
                <div className="text-xs text-muted">{label}</div>
                <div className="break-words font-medium">{value || "unknown"}</div>
              </div>
            ))}
          </div>
          <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
            <div><dt>Version / commit</dt><dd className="break-words">{state?.build?.version} / {state?.build?.commit}</dd></div>
            <div><dt>Branch</dt><dd className="break-words">{state?.build?.branch}</dd></div>
            <div><dt>Feature flags</dt><dd>AI {state?.featureFlags?.aiAssistant ? "enabled" : "disabled"}; Operational Intelligence {state?.featureFlags?.operationalIntelligence ? "enabled" : "disabled"}</dd></div>
            <div><dt>Provider configuration</dt><dd>{state?.ai?.provider || "none"}; credential {state?.ai?.credentialPresent ? "present" : "absent"}</dd></div>
          </dl>
        </>
      )}
      {system.error && <p className="text-sm text-danger">{apiError(system.error)}</p>}
    </Card>
  );
}
