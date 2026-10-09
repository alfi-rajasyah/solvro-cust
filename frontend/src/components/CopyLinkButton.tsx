import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

type Feedback = "copied" | "failed" | null;

/**
 * Icon button that copies a link and confirms with a short "Link copied"
 * message next to it. The app has no global toast system, so the message is a
 * self-clearing live region anchored to the button (screen readers hear it
 * too); a clipboard failure says so instead of failing silently.
 *
 * `getUrl` runs at click time, so the header variant copies whatever the
 * address bar shows right then (current tab and query included).
 */
export function CopyLinkButton({
  label = "Copy link",
  getUrl = () => window.location.href,
  className = "",
}: {
  label?: string;
  getUrl?: () => string;
  className?: string;
}) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleClick() {
    let next: Feedback = "copied";
    try {
      await copyText(getUrl());
    } catch {
      next = "failed";
    }
    if (timer.current) clearTimeout(timer.current);
    // Clear first, then set on the next tick: a repeat click within the window
    // changes the live region's text again, so it is re-announced.
    setFeedback(null);
    timer.current = setTimeout(() => {
      setFeedback(next);
      timer.current = setTimeout(() => setFeedback(null), 1800);
    }, 50);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex items-center justify-center text-on-surface-variant outline-hidden transition-colors hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/30",
          className,
        )}
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          {feedback === "copied" ? "check" : "link"}
        </span>
      </button>
      <span
        role="status"
        className={
          feedback
            ? [
                "absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-lg border px-2.5 py-1 text-meta",
                feedback === "failed"
                  ? "border-error bg-error-container text-on-error-container"
                  : "border-outline-variant bg-surface-container-lowest text-on-surface",
              ].join(" ")
            : "sr-only"
        }
      >
        {feedback === "copied" ? "Link copied" : feedback === "failed" ? "Could not copy link" : ""}
      </span>
    </div>
  );
}
