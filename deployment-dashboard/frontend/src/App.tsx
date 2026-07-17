import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ensureCsrf } from "./lib/api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PageKey, Shell } from "./components/Shell";
import { StatusPage } from "./pages/StatusPage";
import { EnvPage } from "./pages/EnvPage";
import { DeployPage } from "./pages/DeployPage";
import { ServicesPage } from "./pages/ServicesPage";
import { DatabasePage } from "./pages/DatabasePage";
import { LogsPage } from "./pages/LogsPage";
import { BackupsPage } from "./pages/BackupsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Card, Input, Button } from "./components/ui";

export default function App() {
  const [page, setPage] = useState<PageKey>("status");
  const [token, setToken] = useState(localStorage.getItem("dashboard.jwt") || "");
  const [draftToken, setDraftToken] = useState(token);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get("/api/status").then((r) => r.data),
    refetchInterval: 30000,
    enabled: Boolean(token)
  });

  useEffect(() => {
    if (token) void ensureCsrf().catch(() => undefined);
  }, [token]);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <h1 className="text-lg font-semibold">Admin Authentication</h1>
          <p className="mt-2 text-sm text-subdued">Paste an existing admin JWT. The token is stored only in this browser.</p>
          <Input className="mt-4" type="password" value={draftToken} onChange={(e) => setDraftToken(e.target.value)} placeholder="Admin JWT" />
          <Button className="mt-4 w-full" onClick={() => { localStorage.setItem("dashboard.jwt", draftToken); setToken(draftToken); }}>Continue</Button>
        </Card>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Shell page={page} setPage={setPage} online={!health.isError}>
        {page === "status" && <StatusPage />}
        {page === "env" && <EnvPage />}
        {page === "deploy" && <DeployPage />}
        {page === "services" && <ServicesPage />}
        {page === "database" && <DatabasePage />}
        {page === "logs" && <LogsPage />}
        {page === "backups" && <BackupsPage />}
        {page === "settings" && <SettingsPage />}
      </Shell>
    </ErrorBoundary>
  );
}
