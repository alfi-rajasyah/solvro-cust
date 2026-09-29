import { useCallback, useEffect, useRef } from "react";

// Tiny module-level "is a drag gesture live?" registry. The project-scoped
// queries in queries.ts poll every 30 s so other people's edits show up
// (docs/archive/plans/collaboration-and-sharing.md, C3a); a refetch landing
// mid-gesture would move a card or bar under the cursor, so those queries
// pause while anything here is active.
//
// Token-based rather than a boolean/counter: each `beginDrag()` returns its
// own idempotent release, so a double end (drop AND unmount cleanup), or two
// overlapping gestures, can never leave the flag stuck on or clear it early.

const active = new Set<symbol>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of [...listeners]) l();
};

// The gate must be OBSERVABLE, not just readable: TanStack Query re-evaluates a
// `refetchInterval` function only on a query update or when the observer's
// options are re-set (a re-render) — the already-armed timer fires without
// asking again, and a `false` result is never re-armed on its own. So drag
// start/end notifies subscribers (see `useLiveRefresh`) to force that re-set.
export function subscribeDragActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function beginDrag(): () => void {
  const token = Symbol("drag");
  active.add(token);
  notify();
  return () => {
    if (active.delete(token)) notify();
  };
}

export function isDragActive(): boolean {
  return active.size > 0;
}

// True while a background refetch must hold off: a board/Gantt/list drag is
// live, or any mutation is in flight (an optimistic write is on screen and a
// refetch would overwrite it with pre-write server data).
export function shouldPauseRefresh(pendingMutations: number): boolean {
  return isDragActive() || pendingMutations > 0;
}

// For dnd-kit style handlers: `begin` on drag start, `end` on drop AND cancel.
// The unmount cleanup releases a drag that never got its end event (route
// change or the view unmounting mid-gesture).
export function useDragActivityGuard() {
  const releaseRef = useRef<(() => void) | null>(null);
  const end = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);
  const begin = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = beginDrag();
  }, []);
  useEffect(() => end, [end]);
  return { begin, end };
}

// For engines that own their gestures internally (the vendored Gantt's bar
// move/resize, row reorder and Solvro's connect-dot drag expose no start/end
// callbacks): treat a primary press that starts inside `selector` as a drag
// until the pointer is released or cancelled, the window loses focus, or the
// owner unmounts. Over-pauses for a plain click (a few hundred ms) — cheaper
// and safer than patching the vendored engine.
export function usePointerPressActivity(selector: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let release: (() => void) | null = null;
    const end = () => {
      release?.();
      release = null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!(e.target instanceof Element) || !e.target.closest(selector)) return;
      end();
      release = beginDrag();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("blur", end);
      end();
    };
  }, [selector, enabled]);
}
