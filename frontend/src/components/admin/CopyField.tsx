import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

/**
 * A read-only monospace value with a copy button and a self-clearing "Copied"
 * confirmation (the app has no toast system; this is a live region next to the
 * button). Used for the URLs and the one-time secret on Admin › Outline.
 */
export function CopyField({
  value,
  label,
  testId,
  className = "",
}: {
  value: string;
  /** Accessible name of the copy button and the value, e.g. "redirect URL". */
  label: string;
  testId?: string;
  className?: string;
}) {
  const [state, setState] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    let next: "copied" | "failed" = "copied";
    try {
      await copyText(value);
    } catch {
      next = "failed";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), 1800);
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <code
        data-testid={testId}
        className="min-w-0 flex-1 break-all rounded-sm bg-surface px-2 py-1.5 font-mono text-meta text-on-surface"
      >
        {value}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant outline-hidden hover:bg-surface-container hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          content_copy
        </span>
      </button>
      <span role="status" className="min-w-12 text-meta text-on-surface-variant">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}
      </span>
    </div>
  );
}
