import { useEffect } from "react";

// Module-level ref count shared by every consumer. `Modal.tsx` and
// `CommandPalette.tsx` each independently lock `document.body` while open —
// without a shared counter, opening the ⌘K palette on top of an already-open
// Modal (e.g. focus lands outside a form field) and then closing only the
// palette unlocks the page behind the Modal that's still open. The body only
// unlocks once every consumer currently holding a lock has released it.
let lockCount = 0;

function acquire(): void {
  lockCount += 1;
  if (lockCount === 1) {
    document.body.style.overflow = "hidden";
  }
}

function release(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = "";
  }
}

/**
 * Ref-counted `document.body` scroll lock. Call with `active` tracking the
 * consumer's own open/closed state; safe for multiple simultaneous
 * consumers (Modal + CommandPalette open at once) since the lock is only
 * released once the last active consumer unmounts or goes inactive.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    acquire();
    return release;
  }, [active]);
}
