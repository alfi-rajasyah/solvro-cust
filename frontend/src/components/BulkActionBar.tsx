import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { LabelChip } from "@/components/LabelChip";
import { StatusSelect } from "@/components/StatusSelect";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { PRIORITY_LABEL } from "@/lib/labels";
import { ASSIGN_ADDS_MEMBER_NOTICE } from "@/lib/projectMembers";
import type { BulkUpdateTasksInput, Epic, Label, Priority, UserSummary } from "@/lib/queries";
import { useAssigneeMembership } from "@/lib/useAssigneeMembership";
import { TOOLBAR_BUTTON_OUTLINE, cn } from "@/lib/utils";

export type BulkChange = Omit<BulkUpdateTasksInput, "taskIds">;

type ActionKey = "addLabel" | "removeLabel" | "status" | "assignee" | "priority" | "epic";

const ACTIONS: { key: ActionKey; label: string }[] = [
  { key: "addLabel", label: "Add label" },
  { key: "removeLabel", label: "Remove label" },
  { key: "status", label: "Set status" },
  { key: "assignee", label: "Set assignee" },
  { key: "priority", label: "Set priority" },
  { key: "epic", label: "Set epic" },
];

/** Mirrors the server cap on `taskIds` for POST /tasks/bulk. */
export const BULK_TASK_LIMIT = 200;

export const BULK_EPIC_SUBTASK_REASON = "Epics apply to top-level tasks only. Deselect the subtasks to set an epic.";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const OPTION_CLASS =
  "[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant px-2 py-1 text-left text-xs text-on-surface hover:border-primary hover:text-primary disabled:opacity-60";

/**
 * Bulk action bar for the List: appears with one or more rows selected, shows
 * the count and the six actions. Picking an option sends the change at once
 * (labels are the exception: choose several, then apply). The parent owns the
 * request, so on failure it passes `error` back and the selection stays.
 */
export function BulkActionBar({
  projectId,
  count,
  hasSubtask,
  labels,
  epics,
  users,
  pending,
  error,
  onApply,
  onClear,
}: {
  projectId: number;
  count: number;
  hasSubtask: boolean;
  labels: Label[];
  epics: Epic[];
  users: UserSummary[];
  pending: boolean;
  error: string | null;
  onApply: (change: BulkChange) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState<ActionKey | null>(null);
  const [pickedLabels, setPickedLabels] = useState<number[]>([]);
  const reasonId = "bulk-epic-reason";
  const overLimit = count > BULK_TASK_LIMIT;

  function toggleAction(key: ActionKey) {
    setPickedLabels([]);
    setOpen((cur) => (cur === key ? null : key));
  }

  function toggleLabel(id: number) {
    setPickedLabels((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  return (
    <section
      aria-label="Bulk actions"
      className="sticky bottom-0 z-20 mt-2 rounded-sm border border-outline-variant bg-surface-container-low p-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 [@media(pointer:coarse)]:gap-y-4">
        <p className="font-display text-xs font-semibold text-on-surface" role="status">
          {count} selected
        </p>
        <button type="button" onClick={onClear} disabled={pending} className={cn(TOOLBAR_BUTTON_OUTLINE, "h-7")}>
          Clear
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 [@media(pointer:coarse)]:mt-4 [@media(pointer:coarse)]:gap-x-4 [@media(pointer:coarse)]:gap-y-4">
        {ACTIONS.map(({ key, label }) => {
          const epicBlocked = key === "epic" && hasSubtask;
          return (
            <button
              key={key}
              type="button"
              disabled={pending || overLimit || epicBlocked}
              aria-expanded={open === key}
              aria-describedby={epicBlocked ? reasonId : undefined}
              onClick={() => toggleAction(key)}
              className={cn(
                TOOLBAR_BUTTON_OUTLINE,
                "h-7",
                open === key && "border-primary text-primary",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      {overLimit && (
        <p className="mt-1.5 text-meta text-on-surface-variant">
          Select at most {BULK_TASK_LIMIT} tasks for a bulk edit ({count} selected).
        </p>
      )}
      {hasSubtask && (
        <p id={reasonId} className="mt-1.5 text-meta text-on-surface-variant">
          {BULK_EPIC_SUBTASK_REASON}
        </p>
      )}

      {open && !overLimit && (
        <div className="mt-2 border-t border-outline-variant pt-2">
          {(open === "addLabel" || open === "removeLabel") && (
            <div className="space-y-2">
              {labels.length === 0 ? (
                <p className="text-xs text-on-surface-variant">This project has no labels yet.</p>
              ) : (
                <>
                <p className="text-xs text-on-surface-variant">
                  {open === "addLabel" ? "Pick one or more labels to add." : "Pick one or more labels to remove."}
                </p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={open === "addLabel" ? "Labels to add" : "Labels to remove"}>
                  {labels.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={pickedLabels.includes(l.id)}
                      onClick={() => toggleLabel(l.id)}
                      className={cn(
                        "[@media(pointer:coarse)]:min-h-11 flex items-center gap-1.5 rounded-full border py-0.5 pl-1.5 pr-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-primary",
                        pickedLabels.includes(l.id)
                          ? "border-primary bg-primary/10"
                          : "border-outline-variant hover:border-primary",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        data-selected-marker={pickedLabels.includes(l.id) ? "true" : undefined}
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                          pickedLabels.includes(l.id)
                            ? "border-primary bg-primary text-on-primary"
                            : "border-outline bg-transparent",
                        )}
                      >
                        {pickedLabels.includes(l.id) && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      <LabelChip label={l} />
                    </button>
                  ))}
                </div>
                </>
              )}
              <button
                type="button"
                disabled={pending || pickedLabels.length === 0}
                onClick={() =>
                  onApply(open === "addLabel" ? { addLabelIds: pickedLabels } : { removeLabelIds: pickedLabels })
                }
                className="tap-target inline-flex h-8 items-center rounded-sm bg-primary px-3 font-display text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
              >
                {open === "addLabel" ? "Add to" : "Remove from"} {count} {count === 1 ? "task" : "tasks"}
              </button>
            </div>
          )}

          {open === "status" && (
            <StatusSelect
              value={null}
              disabled={pending}
              ariaLabel={`Set status for ${count} selected ${count === 1 ? "task" : "tasks"}`}
              onChange={(def) => onApply({ statusId: def.id })}
              className="w-full max-w-64"
            />
          )}

          {open === "assignee" && (
            <AssigneePanel projectId={projectId} users={users} pending={pending} onPick={(id) => onApply({ assignedToId: id })} />
          )}

          {open === "priority" && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button key={p} type="button" disabled={pending} onClick={() => onApply({ priority: p })} className={OPTION_CLASS}>
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          )}

          {open === "epic" && !hasSubtask && (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label="Epic">
              <button type="button" disabled={pending} onClick={() => onApply({ epicId: null })} className={OPTION_CLASS}>
                No epic
              </button>
              {epics.map((e) => (
                <button key={e.id} type="button" disabled={pending} onClick={() => onApply({ epicId: e.id })} className={OPTION_CLASS}>
                  {e.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}

// Split out so the membership queries are observed only while the picker is open.
function AssigneePanel({
  projectId,
  users,
  pending,
  onPick,
}: {
  projectId: number;
  users: UserSummary[];
  pending: boolean;
  onPick: (id: number | null) => void;
}) {
  const addsMember = useAssigneeMembership(projectId);
  const active = users.filter((u) => u.active);
  return (
    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label="Assignee">
      <button type="button" disabled={pending} onClick={() => onPick(null)} className={OPTION_CLASS}>
        Unassigned
      </button>
      {active.map((u) => (
        <button key={u.id} type="button" disabled={pending} onClick={() => onPick(u.id)} className={OPTION_CLASS}>
          {u.username}
          {addsMember(u.id) && (
            <span className="block text-meta font-normal text-on-surface-variant">{ASSIGN_ADDS_MEMBER_NOTICE}</span>
          )}
        </button>
      ))}
    </div>
  );
}
