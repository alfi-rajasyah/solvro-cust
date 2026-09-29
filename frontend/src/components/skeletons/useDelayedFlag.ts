import { useEffect, useState } from "react";

/**
 * True only once `active` has stayed true for `delayMs`. Loads that finish
 * faster never flip it, so a skeleton gated on this does not flash.
 */
export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const id = window.setTimeout(() => setElapsed(true), delayMs);
    return () => window.clearTimeout(id);
  }, [active, delayMs]);

  return active && elapsed;
}
