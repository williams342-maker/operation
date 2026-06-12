import React from "react";

/**
 * Section-level error boundary (iter221).
 *
 * Catches any render error from a single subtree (e.g. one tab content
 * or one upload form) and surfaces an actionable error card instead of
 * blanking the whole page. Use ANYWHERE a complex form / modal could
 * crash from a prod-build-only edge case (uninitialized var, missing
 * dependency, race condition with a 3rd-party callback).
 *
 * Example:
 *   <SectionErrorBoundary fallback="Upload form crashed — try again">
 *     <FileUploadForm onSaved={...} />
 *   </SectionErrorBoundary>
 *
 * Props:
 *   children      — content to render normally
 *   fallback      — message to show on crash (default: generic)
 *   testId        — root data-testid (default: "section-error-boundary")
 *   onError       — optional callback(error, info) for reporting
 */
export default class SectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[SectionErrorBoundary] caught:", error, info?.componentStack);
    if (typeof this.props.onError === "function") {
      try { this.props.onError(error, info); } catch (_) { /* ignore reporter errors */ }
    }
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    const msg = this.state.error?.message || "Unknown error";
    return (
      <div
        className="border border-red-700/60 bg-red-950/30 p-5 my-4"
        data-testid={this.props.testId || "section-error-boundary"}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-red-400 mb-2">
          ◆ Something broke loading this section
        </div>
        <p className="font-mono text-[12px] text-red-600 mb-2 leading-relaxed">
          {this.props.fallback || "We hit an unexpected error rendering this part of the page."}
        </p>
        <p className="font-mono text-[10px] text-red-600 mb-3 break-words">
          <strong>Detail:</strong> {msg}
        </p>
        <div className="flex gap-2">
          <button
            onClick={this.reset}
            className="px-3 py-1.5 border border-red-500 bg-red-900/40 hover:bg-red-800/60 font-mono text-[10px] uppercase tracking-[0.22em] text-red-600"
            data-testid="section-error-retry"
          >
            ↻ Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 border border-zinc-700 hover:border-zinc-500 font-mono text-[10px] uppercase tracking-[0.22em] text-ink"
            data-testid="section-error-reload"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
