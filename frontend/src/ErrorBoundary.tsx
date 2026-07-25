/*
 * Error boundary.
 *
 * Without one, a throw anywhere in the tree unmounts React and leaves a black rectangle that
 * is indistinguishable from "the globe is loading" or "the feed is down" - three very
 * different situations that must not look alike on an instrument.
 *
 * So this shows the REAL error text rather than a friendly euphemism. A single-user homelab
 * console is read by the person who can fix it, and "something went wrong" would waste their
 * time. Cesium and WebGL failures in particular carry the diagnosis in the message.
 *
 * Must be a class: React has no hook equivalent of componentDidCatch.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console copy: it is the only place the full stack survives a reload.
    console.error("adsb-viz crashed:", error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="absolute inset-0 flex items-center justify-center p-6"
           style={{ background: "#05070a" }}>
        <div className="panel p-4" style={{ maxWidth: 680, maxHeight: "80%", overflowY: "auto" }}>
          <div className="lbl" style={{ color: "var(--amber)", fontSize: 11 }}>
            ▸ Console halted
          </div>
          <div className="pt-2" style={{ fontSize: 12, color: "var(--fg)" }}>
            {error.name}: {error.message}
          </div>
          <div className="pt-3 lbl" style={{ fontSize: 9 }}>
            The display stopped rather than showing a stale or partial picture. Live data is
            not being updated.
          </div>
          {stack && (
            <pre className="mt-3 p-2"
                 style={{
                   fontSize: 10, lineHeight: 1.5, color: "var(--dim)", whiteSpace: "pre-wrap",
                   border: "1px solid var(--line)", maxHeight: 260, overflowY: "auto",
                 }}>
              {stack.trim()}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            className="mt-3"
            style={{
              font: "inherit", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase",
              background: "transparent", cursor: "pointer", padding: "6px 12px",
              border: "1px solid var(--line-bright)", borderRadius: 0, color: "var(--cyan)",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
