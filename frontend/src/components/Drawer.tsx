import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isDragActive } from "./Modal";

interface DrawerProps {
  open: boolean;
  /**
   * When true the panel slides out; `onClosed` fires once that
   * transition finishes. Lets the owner keep the drawer mounted long
   * enough to animate before it tears down (the call sites unmount the
   * form on close, so the exit can't be driven off `open` alone).
   */
  closing?: boolean;
  /** Esc / click-outside. The owner should react by setting `closing`. */
  onClose: () => void;
  /** Fired after the slide-out transition completes (or a fallback timeout). */
  onClosed?: () => void;
  title: string;
  customHeader?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
}

/**
 * Right-anchored slide-in panel. Unlike `Modal` it has no dim/blur
 * backdrop — the board behind stays visible (and a click outside the
 * panel closes the drawer). Offset to `top-14` so the TopBar stays
 * visible and interactive above it (mirrors `RightSidebar`). Mobile
 * collapses to a full-height sheet from that offset, matching the
 * app's `md:` breakpoint convention. Shares Modal's prop shape
 * (header/footer/widthClass) so it's a drop-in for form panels.
 */
export function Drawer({
  open,
  closing = false,
  onClose,
  onClosed,
  title,
  customHeader,
  children,
  footer,
  widthClass = "max-w-lg",
}: DrawerProps) {
  const [shown, setShown] = useState(false);
  const closedFiredRef = useRef(false);

  // Enter: off-screen on mount, slid in on the next frame so the
  // transform transition actually animates.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Exit: drive the slide-out, then notify the owner. A timeout backs up
  // `transitionend` in case it doesn't fire (reduced-motion, tab hidden).
  useEffect(() => {
    if (!closing) return;
    closedFiredRef.current = false;
    setShown(false);
    const fallback = setTimeout(() => {
      if (closedFiredRef.current) return;
      closedFiredRef.current = true;
      onClosed?.();
    }, 280);
    return () => clearTimeout(fallback);
  }, [closing, onClosed]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isDragActive()) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Focus: the drawer is non-modal, so nothing moves on open and there is
  // no trap. We only remember the opener and hand focus back when the
  // drawer closes or unmounts (if the opener is still in the document).
  // The opener is read during render, before the children mount: a child
  // with `autoFocus` (the task form's title) takes focus at mount, ahead of
  // any effect, and would otherwise be remembered as the opener.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current) {
    openerRef.current = document.activeElement as HTMLElement | null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    const opener = openerRef.current;
    return () => {
      if (opener && opener !== document.body && opener.isConnected) {
        opener.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 top-14 z-100 flex justify-end"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        className={[
          "flex h-full w-full flex-col border-l border-outline-variant bg-surface-container-lowest shadow-overlay transition-transform duration-200 ease-out",
          widthClass,
          shown && !closing ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
        onMouseDown={(e) => e.stopPropagation()}
        onTransitionEnd={(e) => {
          if (
            e.propertyName === "transform" &&
            closing &&
            !closedFiredRef.current
          ) {
            closedFiredRef.current = true;
            onClosed?.();
          }
        }}
      >
        {customHeader !== undefined ? (
          customHeader
        ) : (
          <div className="flex items-center justify-between border-b border-outline-variant px-5 py-3.5">
            <span className="font-display text-[14px] font-semibold text-on-surface">
              {title}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="tap-target flex h-7 w-7 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              aria-label="Close"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-outline-variant px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
