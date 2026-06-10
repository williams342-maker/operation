import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Per-tab error boundary for the admin dashboard.
 *
 * If a single tab's component throws (e.g. missing import, undefined
 * destructure, unhandled API shape), this catches the error and shows
 * an isolated "This tab crashed" card while the rest of the dashboard
 * stays functional. The user can retry without a full page refresh.
 *
 * Born from iter93 incident: a typo in AdminDashboard's imports broke
 * the whole admin console. With this boundary in place, only the
 * affected tab would have shown an error card.
 */
export default class AdminTabBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface to the browser console so operators can grab the stack
    // for debugging — but do NOT bubble up; we keep the rest of admin alive.
    // eslint-disable-next-line no-console
    console.error(`[admin-tab-boundary:${this.props.tabId}]`, error, info);
    this.setState({ info });
  }

  retry = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        className="border-2 border-red-700/60 bg-red-900/10 p-6 md:p-8 max-w-3xl"
        data-testid={`admin-tab-error-${this.props.tabId || "unknown"}`}
      >
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-red-300 mb-3">
          <AlertTriangle size={12} /> Tab crashed
        </div>
        <h3 className="font-display text-2xl uppercase leading-tight mb-3">
          Something went sideways.
        </h3>
        <p className="font-mono text-[12px] text-ink-muted leading-relaxed mb-5">
          The <b className="text-ink">{this.props.tabId || "current"}</b> tab failed to render. The rest of the dashboard is still working — you can keep using it. Click retry, or share the error details below with engineering.
        </p>
        <details className="mb-5 font-mono text-[11px] text-ink-muted" data-testid="admin-tab-error-details">
          <summary className="cursor-pointer hover:text-ink-muted mb-2">Error details</summary>
          <pre className="whitespace-pre-wrap break-words bg-paper border border-line p-3 mt-2 max-h-64 overflow-auto">
{String(this.state.error?.message || this.state.error)}
{this.state.error?.stack ? "\n\n" + this.state.error.stack : ""}
          </pre>
        </details>
        <button
          onClick={this.retry}
          className="btn-industrial inline-flex items-center gap-2"
          data-testid="admin-tab-error-retry"
        >
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    );
  }
}
