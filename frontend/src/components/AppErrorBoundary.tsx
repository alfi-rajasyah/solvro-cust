import { Component, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";

// Catches an error thrown while rendering (a malformed server value, an edge
// case in a vendored engine) so it does not blank the whole page.
//
// Two placements:
// - `variant="page"` wraps the shell's <Outlet/> (`layout/Shell.tsx`): the
//   sidebar and top bar stay usable. Try again and a navigation (a new
//   `resetKey`, the pathname) both run `onReset` first — the shell resets the
//   query cache there, so the page is rendered from freshly fetched data, not
//   from the cached value that broke it.
// - `variant="app"` wraps the provider tree in `main.tsx` for anything outside
//   the shell (sign-in, guest and embed pages, the providers themselves). Its
//   fallback uses no router, query or auth context, since one of those may be
//   what failed, and offers Reload only: re-mounting the providers against the
//   same module-level query cache would just hit the same error.
//
// Event handlers and async code are not covered (React only routes render and
// lifecycle errors to a boundary); those keep their own error states. React
// already logs the caught error to the console, so nothing is logged here.

type Props = {
  variant: "page" | "app";
  children: ReactNode;
  /** A change clears a caught error (the page boundary passes the pathname). */
  resetKey?: string;
  /** Runs before the boundary re-renders its children (Try again, or a new resetKey). */
  onReset?: () => void;
  /** Injected in tests; defaults to reloading the document. */
  reload?: () => void;
};

type State = { error: Error | null };

const SECONDARY_BUTTON =
  "rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30";
const PRIMARY_BUTTON =
  "rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-on-primary hover:bg-primary/90 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30";

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.props.onReset?.();
      this.setState({ error: null });
    }
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  private reload = () => (this.props.reload ?? (() => window.location.reload()))();

  render() {
    if (this.state.error === null) return this.props.children;

    const reloadButton = (
      <button type="button" onClick={this.reload} className={PRIMARY_BUTTON}>
        Reload
      </button>
    );

    if (this.props.variant === "page") {
      return (
        <div data-testid="page-error" className="mx-auto max-w-xl">
          <Alert variant="destructive">
            <AlertTitle>This page could not be shown</AlertTitle>
            <AlertDescription>
              <p>
                Something went wrong while showing this page. Try again, open another page from the
                menu, or reload the app.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={this.retry} className={SECONDARY_BUTTON}>
                  Try again
                </button>
                {reloadButton}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return (
      <div
        data-testid="app-error"
        className="flex min-h-screen w-full items-center justify-center bg-background p-4 text-on-surface"
      >
        <div role="alert" className="w-full max-w-md rounded-sm border border-outline-variant bg-surface-container p-6">
          <h1 className="font-display text-h2 text-on-surface">Solvro could not show this screen</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            Something went wrong while showing this screen. Reload the app to continue.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">{reloadButton}</div>
        </div>
      </div>
    );
  }
}
