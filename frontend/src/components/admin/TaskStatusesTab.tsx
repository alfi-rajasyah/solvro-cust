// Admin "Task statuses" tab: the workspace-wide status list, grouped by the
// three fixed categories (docs/archive/plans/custom-task-statuses.md §3 B1).
// The admin edits a local draft (rename, recolour, reorder within a category,
// add, delete, set default) and saves the whole list in one request. Deleting a
// status that still has tasks asks where to move them; the answer becomes
// `moveTo`. All draft rules live in lib/taskStatusEditor.ts.
import { useEffect, useId, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { SkeletonRegion } from "@/components/skeletons/SkeletonRegion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { ApiError } from "@/lib/api";
import { statusToneClass, STATUS_TONE_DOT_CLASS } from "@/components/StatusChip";
import { TASK_CATEGORY_GROUP_LABEL } from "@/lib/labels";
import { STATUS_CATEGORY_ICON, STATUS_CATEGORY_ORDER } from "@/lib/taskStatuses";
import {
  useAdminTaskStatuses,
  useSaveTaskStatuses,
  type StatusTone,
  type TaskStatus,
} from "@/lib/queries";
import {
  STATUS_NAME_MAX,
  STATUS_TONES,
  addStatus,
  buildSaveBody,
  deleteBlocker,
  isDirty,
  moveTargets,
  needsMoveTarget,
  pendingMoveCount,
  mergeTaskCounts,
  removeStatus,
  reorderCategory,
  resetToDefaults,
  restoreRemoved,
  rowsIn,
  seedState,
  setDefault,
  updateRow,
  validateState,
  type DraftStatus,
  type EditorState,
} from "@/lib/taskStatusEditor";

const toneClass = (color: StatusTone, category: TaskStatus) => statusToneClass({ color }, category);
const TONE_LABEL: Record<StatusTone, string> = {
  gray: "Gray",
  primary: "Green",
  emerald: "Emerald",
  amber: "Amber",
  violet: "Violet",
};

const CATEGORY_MEANING: Record<TaskStatus, string> = {
  TODO: "Work that has not begun. New tasks start in the default status here.",
  IN_PROGRESS: "Work under way. Counts as open in progress and overdue checks.",
  DONE: "Finished work. Counts as complete everywhere.",
};

const BORDERED_FOCUS =
  "focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";
const BTN_SECONDARY = `[@media(pointer:coarse)]:min-h-11 inline-flex items-center gap-1.5 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-50 ${BORDERED_FOCUS}`;
const BTN_PRIMARY = `[@media(pointer:coarse)]:min-h-11 inline-flex items-center gap-1.5 rounded-sm border border-transparent bg-primary px-4 py-1.5 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50 outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background`;

const HOW_IT_WORKS = [
  "Every status belongs to one of three categories. Overdue, progress and Done counts read the category, so renaming a status never changes them.",
  "Drag a status by its handle to reorder it within its category. The Kanban board shows the columns in this order.",
  "The default status of a category is what a task gets when only the category is known. New tasks start in the Not started default.",
  "Deleting a status that still has tasks asks where to move them. Nothing changes until you save.",
];

export function TaskStatusesTab({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { data, isLoading, isError } = useAdminTaskStatuses();
  const save = useSaveTaskStatuses();
  const [state, setState] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deleting, setDeleting] = useState<DraftStatus | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const seq = useRef(0);
  // After a save the next server list replaces the draft even though the draft
  // still differs from the (now stale) previous list.
  const justSaved = useRef(false);

  const dirty = !!(data && state && isDirty(state, data));
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!data) return;
    if (justSaved.current || !dirtyRef.current) {
      setState(seedState(data));
      justSaved.current = false;
    } else {
      // Keep the admin's edits, but show the latest task counts.
      setState((s) => (s ? mergeTaskCounts(s, data) : s));
    }
  }, [data]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (isLoading || (!state && !isError)) {
    return (
      <SkeletonRegion className="space-y-4" data-testid="task-statuses-loading">
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-64 w-full" />
      </SkeletonRegion>
    );
  }
  if (isError || !data || !state) {
    return <p className="text-error">Failed to load task statuses.</p>;
  }

  const errors = validateState(state);
  const canSave = dirty && Object.keys(errors).length === 0 && !save.isPending;

  function edit(next: EditorState) {
    setError(null);
    setState(next);
  }

  function handleAdd(category: TaskStatus) {
    const key = `n${++seq.current}`;
    setFocusKey(key);
    edit(addStatus(state!, category, key));
  }

  function handleDelete(row: DraftStatus) {
    if (needsMoveTarget(state!, row)) setDeleting(row);
    else edit(removeStatus(state!, row.key));
  }

  async function handleSave() {
    if (!state || !canSave) return;
    setError(null);
    justSaved.current = true;
    try {
      await save.mutateAsync(buildSaveBody(state));
    } catch (err) {
      justSaved.current = false;
      const moved = staleMoveRequired(err);
      if (moved) {
        // A status that showed no tasks has some now: bring it back and ask where they go.
        const restored = restoreRemoved(state, moved.statusId, moved.taskCount);
        setState(restored);
        const row = restored.rows.find((r) => r.id === moved.statusId);
        if (row) setDeleting(row);
        setError(null);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not save the task statuses.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <h2 className="font-display text-lg font-semibold text-on-surface">Task statuses</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            One list for the whole workspace. Group statuses under Not started, Active and Done;
            tasks, the Kanban board and every status picker follow it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <span className="text-meta font-semibold text-on-surface-variant" role="status">
              Unsaved changes
            </span>
          )}
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => setConfirmReset(true)}
            disabled={save.isPending}
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              restart_alt
            </span>
            Reset to defaults
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={handleSave} disabled={!canSave}>
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-sm bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {STATUS_CATEGORY_ORDER.map((category) => {
            const title = TASK_CATEGORY_GROUP_LABEL[category];
            const rows = rowsIn(state, category);
            return (
              <section
                key={category}
                aria-label={title}
                data-testid={`status-group-${category}`}
                className="rounded-sm border border-outline-variant bg-surface-container-lowest"
              >
                <header className="flex items-start gap-2 border-b border-outline-variant px-3 py-2.5">
                  <span
                    className="material-symbols-outlined mt-px text-lg text-on-surface-variant"
                    aria-hidden="true"
                  >
                    {STATUS_CATEGORY_ICON[category]}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-label-caps uppercase text-on-surface-variant">
                      {title}
                    </h3>
                    <p className="mt-1 text-meta text-on-surface-variant">{CATEGORY_MEANING[category]}</p>
                  </div>
                </header>

                <Sortable
                  value={rows}
                  onValueChange={(next) => edit(reorderCategory(state, category, next))}
                  getItemValue={(r) => r.key}
                  render={<div className="divide-y divide-outline-variant" />}
                >
                  {rows.map((row) => (
                    <StatusRow
                      key={row.key}
                      row={row}
                      error={errors[row.key]}
                      autoFocus={row.key === focusKey}
                      blocker={deleteBlocker(state, row)}
                      onName={(name) => edit(updateRow(state, row.key, { name }))}
                      onTone={(color) => edit(updateRow(state, row.key, { color }))}
                      onDefault={() => edit(setDefault(state, row.key))}
                      onDelete={() => handleDelete(row)}
                    />
                  ))}
                </Sortable>

                <div className="border-t border-outline-variant px-3 py-2">
                  <button
                    type="button"
                    className={`[@media(pointer:coarse)]:min-h-11 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs font-semibold text-primary-tint-text outline-hidden hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary`}
                    onClick={() => handleAdd(category)}
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      add
                    </span>
                    Add status
                    <span className="sr-only"> to {title}</span>
                  </button>
                </div>
              </section>
            );
          })}
        </div>

        <aside
          aria-label="How it works"
          className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4 lg:sticky lg:top-4 lg:w-72 lg:shrink-0"
        >
          <h3 className="text-label-caps uppercase text-on-surface-variant">How it works</h3>
          <ul className="mt-3 space-y-2.5">
            {HOW_IT_WORKS.map((line) => (
              <li key={line} className="flex gap-2 text-sm text-on-surface-variant">
                <span
                  className="material-symbols-outlined mt-px text-base text-primary"
                  aria-hidden="true"
                >
                  check
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          edit(resetToDefaults(state));
          setConfirmReset(false);
        }}
        title="Reset to defaults?"
        body="This replaces the list with To do, In progress and Done in your draft. Any other status is removed and its tasks move to the matching default. Nothing changes until you save."
        confirmLabel="Reset draft"
        confirmTone="warning"
      />

      <MoveTasksModal
        row={deleting}
        state={state}
        onClose={() => setDeleting(null)}
        onConfirm={(row, target) => {
          edit(removeStatus(state, row.key, target));
          setDeleting(null);
        }}
      />
    </div>
  );
}

function staleMoveRequired(err: unknown): { statusId: number; taskCount: number } | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { code?: string; details?: { statusId?: unknown; taskCount?: unknown } } | null;
  if (body?.code !== "status_move_required") return null;
  const { statusId, taskCount } = body.details ?? {};
  return typeof statusId === "number" && typeof taskCount === "number" ? { statusId, taskCount } : null;
}

function StatusRow({
  row,
  error,
  autoFocus,
  blocker,
  onName,
  onTone,
  onDefault,
  onDelete,
}: {
  row: DraftStatus;
  error: string | undefined;
  autoFocus: boolean;
  blocker: string | null;
  onName: (name: string) => void;
  onTone: (tone: StatusTone) => void;
  onDefault: () => void;
  onDelete: () => void;
}) {
  const errId = useId();
  return (
    <SortableItem
      value={row.key}
      render={<div />}
      data-testid="task-status-row"
      data-category={row.category}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-surface-container-lowest px-3 py-2 [@media(pointer:coarse)]:gap-x-6"
    >
      <SortableItemHandle
        render={
          <button
            type="button"
            aria-label={`Reorder ${row.name || "new status"}`}
            className="tap-target material-symbols-outlined touch-none rounded-sm p-1 text-lg text-on-surface-variant/80 outline-hidden transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary"
          />
        }
      >
        drag_indicator
      </SortableItemHandle>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Colour: ${TONE_LABEL[row.color]}`}
              title={`Colour: ${TONE_LABEL[row.color]}`}
              className={`tap-target inline-flex h-6 w-6 items-center justify-center rounded-full border border-outline-variant ${toneClass(row.color, row.category)} ${BORDERED_FOCUS}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_TONE_DOT_CLASS[row.color]}`} aria-hidden="true" />
            </button>
          }
        />
        <DropdownMenuContent
          align="start"
          className="w-40 bg-surface-container-lowest shadow-overlay!"
          positionerClassName="z-50"
        >
          {STATUS_TONES.map((tone) => (
            <DropdownMenuItem key={tone} onClick={() => onTone(tone)} className="text-xs">
              <span
                className={`h-3 w-3 rounded-full ${STATUS_TONE_DOT_CLASS[tone]}`}
                aria-hidden="true"
              />
              {TONE_LABEL[tone]}
              {tone === row.color && (
                <span className="material-symbols-outlined ml-auto text-base" aria-hidden="true">
                  check
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        type="text"
        value={row.name}
        maxLength={STATUS_NAME_MAX + 10}
        autoFocus={autoFocus}
        placeholder="Status name"
        aria-label="Status name"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onName(e.target.value)}
        style={{ width: `${Math.max(row.name.length, 8) + 3}ch` }}
        className={`min-w-0 max-w-full rounded-full border border-transparent px-2.5 py-0.5 font-display text-meta font-semibold leading-[18px] hover:border-outline-variant ${toneClass(row.color, row.category)} ${BORDERED_FOCUS} ${error ? "border-error!" : ""}`}
      />

      {row.isDefault && (
        <span className="inline-flex items-center gap-1 text-meta text-on-surface-variant">
          <span className="material-symbols-outlined text-sm text-primary" aria-hidden="true">
            star
          </span>
          {row.category === "TODO" ? "Default for new tasks" : "Default"}
        </span>
      )}

      <span className="ml-auto font-mono text-meta tabular-nums text-on-surface-variant">
        {row.taskCount} {row.taskCount === 1 ? "task" : "tasks"}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Actions for ${row.name || "new status"}`}
              className="tap-target inline-flex h-7 w-7 items-center justify-center rounded-sm text-on-surface-variant outline-hidden transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                more_horiz
              </span>
            </button>
          }
        />
        <DropdownMenuContent
          align="end"
          className="w-56 bg-surface-container-lowest shadow-overlay!"
          positionerClassName="z-50"
        >
          <DropdownMenuItem disabled={row.isDefault} onClick={onDefault} className="text-xs">
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              star
            </span>
            Set as default
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={blocker !== null}
            onClick={onDelete}
            className="text-xs"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              delete
            </span>
            Delete status
          </DropdownMenuItem>
          {blocker && (
            <p className="px-2 py-1.5 text-meta text-on-surface-variant">{blocker}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <p id={errId} role="alert" className="basis-full pl-9 text-meta text-error">
          {error}
        </p>
      )}
    </SortableItem>
  );
}

function MoveTasksModal({
  row,
  state,
  onClose,
  onConfirm,
}: {
  row: DraftStatus | null;
  state: EditorState;
  onClose: () => void;
  onConfirm: (row: DraftStatus, target: number) => void;
}) {
  const selectId = useId();
  const [target, setTarget] = useState<string>("");
  useEffect(() => {
    setTarget("");
  }, [row?.key]);

  if (!row) return <Modal open={false} onClose={onClose} title="" children={null} />;
  const count = pendingMoveCount(state, row);
  const targets = moveTargets(state, row);
  const chosen = target === "" ? undefined : Number(target);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete “${row.name}”`}
      widthClass="max-w-md"
      footer={
        <>
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={chosen === undefined}
            onClick={() => chosen !== undefined && onConfirm(row, chosen)}
          >
            Delete and move
          </button>
        </>
      }
    >
      <p className="text-sm text-on-surface-variant">
        {count} {count === 1 ? "task is" : "tasks are"} using this status. Choose where to move{" "}
        {count === 1 ? "it" : "them"}; the move happens when you save.
      </p>
      <label htmlFor={selectId} className="mt-4 block text-label-caps uppercase text-on-surface-variant">
        Move {count} {count === 1 ? "task" : "tasks"} to…
      </label>
      <select
        id={selectId}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className={`[@media(pointer:coarse)]:min-h-11 mt-1.5 w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 text-sm text-on-surface ${BORDERED_FOCUS}`}
      >
        <option value="">Choose a status…</option>
        {STATUS_CATEGORY_ORDER.map((category) => {
          const options = targets.filter((t) => t.category === category);
          if (options.length === 0) return null;
          return (
            <optgroup key={category} label={TASK_CATEGORY_GROUP_LABEL[category]}>
              {options.map((t) => (
                <option key={t.key} value={t.id}>
                  {t.name || "Untitled"}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </Modal>
  );
}
