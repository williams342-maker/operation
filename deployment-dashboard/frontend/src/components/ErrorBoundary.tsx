import React from "react";
import { Card } from "./ui";

export class ErrorBoundary extends React.Component<React.PropsWithChildren, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return <Card><div className="font-semibold text-danger">Something failed</div><p className="mt-2 text-sm text-subdued">{this.state.error.message}</p></Card>;
    }
    return this.props.children;
  }
}
