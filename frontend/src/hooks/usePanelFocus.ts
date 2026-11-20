import { useEffect, useRef, type RefObject } from "react";

const NONE = Symbol("none");

/**
 * Focus for a non-modal side panel (task, epic, iTop ticket): the page behind
 * it stays usable, so Tab is not trapped — but opening the panel moves focus
 * into it (screen readers announce its `role="dialog"` and `aria-label`), and
 * closing it returns focus to the control that opened it.
 *
 * `item` identifies what the panel shows (a task id); a new item moves focus
 * in. `shell` names the element currently rendered (loading, error, ready):
 * when it swaps, focus that fell to `<body>` with the old element comes back
 * to the panel, but focus the user moved elsewhere meanwhile (a search box) is
 * left alone. Focus already inside the panel is never moved, so typing in the
 * panel is never interrupted.
 *
 * Give the panel element `tabIndex={-1}` so it can take focus.
 */
export function usePanelFocus(ref: RefObject<HTMLElement | null>, item: unknown, shell?: unknown): void {
  const opener = useRef<HTMLElement | null>(null);
  const focusedItem = useRef<unknown>(NONE);
  // Last element focused outside the panel. A click on a button does not focus
  // it in Safari and Firefox on macOS, so `activeElement` alone can still be
  // the previous task's opener when the panel switches to a new task.
  const lastOutside = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const target = e.target;
      if (!(target instanceof HTMLElement) || target === document.body) return;
      if (ref.current?.contains(target)) return;
      lastOutside.current = target;
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [ref]);

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const active = document.activeElement as HTMLElement | null;
    if (panel.contains(active)) {
      focusedItem.current = item;
      return;
    }
    const lost = active === null || active === document.body;
    const itemChanged = !Object.is(focusedItem.current, item);
    if (!lost && !itemChanged) return;
    if (itemChanged) {
      // Remember who opened (or re-targeted) the panel. With focus lost, fall
      // back to the last outside focus seen since the previous target; if
      // there is none the opener is unknown, so closing returns focus nowhere
      // rather than to the previous item's opener. A shell swap for the same
      // item keeps the opener it already has.
      opener.current = lost ? lastOutside.current : active;
      lastOutside.current = null;
      focusedItem.current = item;
    }
    panel.focus({ preventScroll: true });
  }, [ref, item, shell]);

  useEffect(
    () => () => {
      // The panel is gone, so focus that was inside it fell back to <body>.
      // Return it to the opener; if the user already moved focus somewhere
      // else, leave it there.
      const target = opener.current;
      const active = document.activeElement;
      if (target?.isConnected && (active === null || active === document.body)) {
        target.focus({ preventScroll: true });
      }
    },
    [],
  );
}
