import { Modal } from "./Modal";
import type { ConflictRow } from "@/lib/taskConflict";

interface TaskConflictDialogProps {
  open: boolean;
  rows: ConflictRow[];
  /** Discard my change; the task is refetched from the server. */
  onUseTheirs: () => void;
  /** Resend my change without `expected`, overwriting theirs. */
  onKeepMine: () => void;
  busy?: boolean;
}

/**
 * Shown when a task save comes back 409 `stale_write`: someone changed a field
 * this save was also changing. One row per clashing field, their value against
 * yours. Closing the dialog any other way (Escape, backdrop) counts as
 * "Use theirs" — the safe default, nothing is overwritten.
 */
export function TaskConflictDialog({
  open,
  rows,
  onUseTheirs,
  onKeepMine,
  busy = false,
}: TaskConflictDialogProps) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onUseTheirs}
      title="Someone changed this task after you opened it"
      footer={
        <>
          <button
            type="button"
            data-autofocus
            onClick={onUseTheirs}
            disabled={busy}
            className="rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            Use theirs
          </button>
          <button
            type="button"
            onClick={onKeepMine}
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Keep mine"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-on-surface-variant">
        Your change would overwrite theirs on the fields below.
      </p>
      <ul className="divide-y divide-outline-variant border border-outline-variant">
        {rows.map((row) => (
          <li key={row.field} data-testid="conflict-row" className="px-3 py-2.5">
            <div className="text-label-caps uppercase text-on-surface-variant">
              {row.label}
            </div>
            <div className="mt-1 break-words text-sm text-on-surface">
              <span className="text-on-surface-variant">Now: </span>
              <span data-testid="conflict-now">{row.now}</span>
            </div>
            <div className="break-words text-sm text-on-surface">
              <span className="text-on-surface-variant">Yours: </span>
              <span data-testid="conflict-yours">{row.yours}</span>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
