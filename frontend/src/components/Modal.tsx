import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useDialogFocus } from "@/hooks/useDialogFocus";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  customHeader?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
}

export function Modal({
  open,
  onClose,
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
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-stretch justify-center bg-inverse-surface/40 p-0 backdrop-blur-sm md:items-center md:p-4"
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
          <header className="flex items-center justify-between border-b border-outline-variant px-5 py-3.5">
            <span className="font-display text-[14px] font-semibold text-on-surface">
              {title}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              aria-label="Close"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base">close</span>
            </button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-outline-variant px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
