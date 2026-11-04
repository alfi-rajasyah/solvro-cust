// Copied from the legacy frontend/src/pages/views/ProjectKanban.tsx
// (MobileMoveSheet lines 1123-1173, pre-T11 cutover) per Architecture
// Decision 2 (docs/plans/kanban-reui-swap/plan.md): copy, don't extract. The
// legacy file is gone as of T11 cutover (git history preserves it). Kept as
// its own file rather than folded into cards.tsx (T8 brief's "or its own
// small file if cleaner") since it's a sheet/overlay concern, not a card
// visual.
import { STATUS_TONE_DOT_CLASS } from "@/components/StatusChip";
import { TASK_CATEGORY_GROUP_LABEL } from "@/lib/labels";
import type { Task, TaskStatusDef } from "@/lib/queries";
import { groupStatusDefs } from "@/lib/taskStatuses";

// Statuses are listed under their category (docs/archive/plans/custom-task-statuses.md
// §3 B3), the same grouping the board's category band shows.
export function MobileMoveSheet({
  task,
  defs,
  onClose,
  onMove,
}: {
  task: Task;
  defs: readonly TaskStatusDef[];
  onClose: () => void;
  onMove: (def: TaskStatusDef) => void;
}) {
  const groups = groupStatusDefs(defs);
  return (
    <div className="fixed inset-0 z-100 flex items-end md:hidden" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" />
      <div
        className="relative max-h-[80vh] w-full overflow-y-auto rounded-t-xl border-t border-outline-variant bg-surface-container p-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="mb-1 truncate text-sm font-bold text-on-surface">{task.title}</p>
        <p className="mb-3 text-label-caps uppercase text-on-surface-variant">
          Move to
        </p>
        {groups.map((group) => (
          <div key={group.category} className="mb-2 last:mb-0">
            {groups.length > 1 && (
              <p className="px-3 pb-1 text-label-caps uppercase text-on-surface-variant">
                {TASK_CATEGORY_GROUP_LABEL[group.category]}
              </p>
            )}
            <ul className="space-y-1">
              {group.defs.map((def) => {
                const checked = task.statusId === def.id;
                return (
                  <li key={def.id}>
                    <button
                      type="button"
                      onClick={() => onMove(def)}
                      aria-current={checked ? "true" : undefined}
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
                        {checked && <span aria-hidden="true" className="material-symbols-outlined text-meta leading-none">check</span>}
                      </span>
                      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATUS_TONE_DOT_CLASS[def.color]}`} />
                      {def.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
