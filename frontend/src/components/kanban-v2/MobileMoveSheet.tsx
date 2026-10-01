// Copied from the legacy frontend/src/pages/views/ProjectKanban.tsx
// (MobileMoveSheet lines 1123-1173, pre-T11 cutover) per Architecture
// Decision 2 (docs/plans/kanban-reui-swap/plan.md): copy, don't extract. The
// legacy file is gone as of T11 cutover (git history preserves it). Kept as
// its own file rather than folded into cards.tsx (T8 brief's "or its own
// small file if cleaner") since it's a sheet/overlay concern, not a card
// visual, and needs its own column-label list rather than sharing
// SolvroKanban.tsx's (adapter.ts/commitMapper.ts stay untouched by this
// task — see plan T8 scope note).
import { taskStatusOptions } from "@/lib/labels";
import type { Task, TaskStatus } from "@/lib/queries";

const COLUMNS = taskStatusOptions;

export function MobileMoveSheet({
  task,
  onClose,
  onMove,
}: {
  task: Task;
  onClose: () => void;
  onMove: (status: TaskStatus) => void;
}) {
  return (
    <div className="fixed inset-0 z-100 flex items-end md:hidden" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" />
      <div
        className="relative w-full rounded-t-xl border-t border-outline-variant bg-surface-container p-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="mb-1 truncate text-sm font-bold text-on-surface">{task.title}</p>
        <p className="mb-3 text-label-caps uppercase text-on-surface-variant">
          Move to
        </p>
        <ul className="space-y-1">
          {COLUMNS.map((col) => {
            const checked = task.status === col.value;
            return (
              <li key={col.value}>
                <button
                  type="button"
                  onClick={() => onMove(col.value)}
                  className={[
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                    checked ? "text-primary" : "text-on-surface",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      checked ? "border-primary bg-primary text-white" : "border-outline-variant",
                    ].join(" ")}
                  >
                    {checked && <span className="material-symbols-outlined text-meta leading-none">check</span>}
                  </span>
                  {col.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
