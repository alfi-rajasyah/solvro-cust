import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/reui/alert";

interface QueryErrorAlertProps {
  /** What failed, e.g. "Could not load projects". The error message is appended. */
  title: string;
  error?: unknown;
  /** The failed query's `refetch`. Omit when retrying cannot help (e.g. a 404): no Retry button renders. */
  onRetry?: () => unknown;
  /** Extra actions rendered after Retry, e.g. a "Back to Projects" link. */
  children?: ReactNode;
  className?: string;
}

/**
 * Destructive alert for a failed page-level query: the message plus a Retry
 * button, so a transient failure does not force a full page reload.
 */
export function QueryErrorAlert({ title, error, onRetry, children, className }: QueryErrorAlertProps) {
  const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {title}
            {detail}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={() => void onRetry()}
              className="rounded-sm font-bold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Retry
            </button>
          )}
          {children}
        </span>
      </AlertDescription>
    </Alert>
  );
}
