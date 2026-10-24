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

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const active = document.activeElement as HTMLElement | null;
    if (panel.contains(active)) {
      focusedItem.current = item;
      return;
    }
    const lost = active === null || active === document.body;
    if (!lost && Object.is(focusedItem.current, item)) return;
    // Remember who opened (or re-targeted) the panel, unless focus was lost.
    if (!lost) opener.current = active;
    focusedItem.current = item;
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
