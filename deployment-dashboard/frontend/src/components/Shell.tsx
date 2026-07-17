import { Activity, Boxes, Database, FileKey, GitBranch, HardDriveDownload, ListRestart, Settings, TerminalSquare } from "lucide-react";
import { cn } from "../lib/utils";

export type PageKey = "status" | "env" | "deploy" | "services" | "database" | "logs" | "backups" | "settings";

const nav: Array<{ key: PageKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "status", label: "System", icon: Activity },
  { key: "env", label: "Environment", icon: FileKey },
  { key: "deploy", label: "Deploy", icon: GitBranch },
  { key: "services", label: "Services", icon: ListRestart },
  { key: "database", label: "Database", icon: Database },
  { key: "logs", label: "Logs", icon: TerminalSquare },
  { key: "backups", label: "Backups", icon: HardDriveDownload },
  { key: "settings", label: "Settings", icon: Settings }
];

export function Shell({ page, setPage, children, online }: React.PropsWithChildren<{ page: PageKey; setPage: (page: PageKey) => void; online: boolean }>) {
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-panel md:block">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Boxes className="h-5 w-5 text-primary" />
          <span className="font-semibold">Deploy Control</span>
        </div>
        <nav className="p-3">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} onClick={() => setPage(item.key)} className={cn("mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-subdued hover:bg-muted hover:text-foreground", page === item.key && "bg-muted text-foreground")}>
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="md:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur">
          <div>
            <div className="text-sm text-subdued">Deployment & Server Management</div>
            <div className="text-xs text-subdued">localhost API:3000 · UI:5173</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className={cn("h-2 w-2 rounded-full", online ? "bg-success" : "bg-danger")} />
            {online ? "API online" : "API offline"}
          </div>
        </header>
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
