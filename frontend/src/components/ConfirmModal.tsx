import type { ReactNode } from "react";
import { Modal } from "./Modal";

type Tone = "primary" | "warning" | "danger";

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  confirmTone?: Tone;
  busy?: boolean;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  confirmTone = "primary",
  busy = false,
}: ConfirmModalProps) {
  const confirmClass =
    confirmTone === "warning"
      ? "[@media(pointer:coarse)]:min-h-11 rounded-sm border border-chip-amber-text/40 bg-chip-amber-bg px-4 py-1.5 text-xs font-bold text-chip-amber-text hover:bg-[color-mix(in_srgb,var(--color-chip-amber-bg),var(--color-chip-amber-text)_12%)] hover:text-[color-mix(in_srgb,var(--color-chip-amber-text),black_25%)] dark:hover:bg-[color-mix(in_srgb,var(--color-chip-amber-bg),black_15%)] dark:hover:text-chip-amber-text disabled:opacity-60 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
      : confirmTone === "danger"
        ? "[@media(pointer:coarse)]:min-h-11 rounded-sm bg-error px-4 py-1.5 text-xs font-bold text-on-error hover:bg-error/90 disabled:opacity-60 outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        : "[@media(pointer:coarse)]:min-h-11 rounded-sm bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60 outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            disabled={busy}
            className="[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={confirmClass}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-on-surface">{body}</div>
    </Modal>
  );
}
