import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useDialogFocus } from "@/hooks/useDialogFocus";

/**
 * True while a dnd-kit drag is lifted. dnd-kit marks the activator
 * `aria-pressed="true"` and an `aria-roledescription` (`draggable` from
 * useDraggable, `sortable` from useSortable) for the whole drag, pointer or
 * keyboard. Escape cancels the drag in dnd-kit's own `document` listener, so an
 * overlay's Escape listener must skip its close while this holds, or one
 * keypress cancels the drag and closes the overlay (ISS-188). The listeners stay
 * in the bubble phase so an inner widget that consumes Escape (mention picker,
 * inline rename) can stop it first.
 */
export function isDragActive(): boolean {
  return (
    document.querySelector(
      '[aria-pressed="true"][aria-roledescription="draggable"], [aria-pressed="true"][aria-roledescription="sortable"]',
    ) !== null
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Close handler for the header X only; defaults to `onClose`. */
  onHeaderClose?: () => void;
  title: string;
  customHeader?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
}

export function Modal({
  open,
  onClose,
  onHeaderClose,
  title,
  customHeader,
  children,
  footer,
  widthClass = "max-w-lg",
}: ModalProps) {
  useBodyScrollLock(open);
  const { ref: dialogRef, onKeyDown: onDialogKeyDown } = useDialogFocus(open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isDragActive()) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-stretch justify-center bg-inverse-surface/40 p-0 md:items-center md:p-4"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`focus:outline-hidden flex max-h-screen w-full ${widthClass} flex-col rounded-none border-outline-variant bg-surface-container-lowest shadow-overlay md:h-auto md:max-h-[calc(100vh-2rem)] md:rounded-sm md:border`}
        onMouseDown={(e) => e.stopPropagation()}
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
              onClick={onHeaderClose ?? onClose}
              className="tap-target flex h-9 w-9 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
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
