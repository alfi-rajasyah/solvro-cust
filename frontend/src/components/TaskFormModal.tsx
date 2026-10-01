import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AssigneeMembershipNotice } from "./AssigneeMembershipNotice";
import { ConfirmModal } from "./ConfirmModal";
import { DateRangeField } from "./DateRangeField";
import { Drawer } from "./Drawer";
import { EpicChip } from "./EpicChip";
import { LabelPicker } from "./LabelPicker";
import { TaskConflictDialog } from "./TaskConflictDialog";
import {
  CRITICAL_PATH_GLYPH,
  CRITICAL_PATH_HELPER_TEXT,
  CRITICAL_PATH_LABEL,
} from "./CriticalPathMark";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { commitDraft, dayFromIso, isoFromDay } from "@/lib/dateField";
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import {
  diffTaskForm,
  fieldsToAdopt,
  formatConflictRows,
  parseStaleWrite,
  withServerTask,
  type StaleWrite,
} from "@/lib/taskConflict";
import {
  type Priority,
  type Task,
  type TaskStatus,
  type UpdateTaskInput,
  useCreateTask,
  useDeleteTask,
  useProjectEpics,
  useProjectLabels,
  useProjectSections,
  useProjectTasks,
  useUpdateTask,
  useUsers,
} from "@/lib/queries";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

const PRIORITY_COLOR: Record<Priority, string> = {
  LOW: "text-on-surface",
  MEDIUM: "text-on-surface",
  HIGH: "text-chip-amber-text",
  URGENT: "text-error",
};

interface CreateProps {
  open: boolean;
  onClose: () => void;
  mode: "create";
  projectId: number;
  initialStatus?: TaskStatus;
  initialParentTaskId?: number | null;
  initialSectionId?: number | null;
}

interface EditProps {
  open: boolean;
  onClose: () => void;
  mode: "edit";
  projectId: number;
  task: Task;
}

export type TaskFormModalProps = CreateProps | EditProps;

export function TaskFormModal(props: TaskFormModalProps) {
  const { open, onClose, projectId } = props;
  const isEdit = props.mode === "edit";

  const { user } = useAuth();
  const canEdit = hasPermission(user, "task:write");
  const create = useCreateTask(projectId);
  const update = useUpdateTask(projectId);
  const remove = useDeleteTask(projectId);
  const { data: users } = useUsers();
  const { data: projectTasks } = useProjectTasks(open ? projectId : null);
  const { data: sections } = useProjectSections(open ? projectId : null);
  const { data: epics } = useProjectEpics(open ? projectId : null);
  const { data: labels } = useProjectLabels(open ? projectId : null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [startDate, setStartDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [assignedToId, setAssignedToId] = useState<number | "">("");
  const [parentTaskId, setParentTaskId] = useState<number | "">("");
  const [sectionId, setSectionId] = useState<number | "">("");
  const [epicId, setEpicId] = useState<number | "">("");
  const [labelIds, setLabelIds] = useState<number[]>([]);
  const [isCriticalPath, setIsCriticalPath] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drive the drawer's slide-out: every close path sets `closing`, and
  // the parent's real `onClose` (which unmounts us) only runs once the
  // exit transition has finished.
  const [closing, setClosing] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // A save refused with 409 `stale_write` — see TaskConflictDialog.
  const [conflict, setConflict] = useState<{
    taskId: number;
    patch: UpdateTaskInput;
    stale: StaleWrite;
  } | null>(null);
  // The task exactly as the form opened with it. The `task` prop is the live
  // cache row and refreshes under the user's hands; the diff and `expected`
  // must be measured against what the user actually started editing from.
  const baseTaskRef = useRef<Task | null>(null);
  const requestClose = useCallback(() => setClosing(true), []);

  const editingTask = isEdit ? (props as EditProps).task : null;
  const createProps = isEdit ? null : (props as CreateProps);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConflict(null);
    if (editingTask) {
      baseTaskRef.current = editingTask;
      setTitle(editingTask.title);
      setDescription(editingTask.description ?? "");
      setStatus(editingTask.status);
      setPriority(editingTask.priority);
      setStartDate(dayFromIso(editingTask.startDate) ?? "");
      setDueDate(dayFromIso(editingTask.dueDate) ?? "");
      setAssignedToId(editingTask.assignedToId ?? "");
      setParentTaskId(editingTask.parentTaskId ?? "");
      setSectionId(editingTask.sectionId ?? "");
      setEpicId(editingTask.epicId ?? "");
      setLabelIds(editingTask.labels.map((l) => l.id));
      setIsCriticalPath(editingTask.isCriticalPath ?? false);
    } else {
      setTitle("");
      setDescription("");
      setStatus(createProps?.initialStatus ?? "TODO");
      setPriority("MEDIUM");
      setStartDate("");
      setDueDate("");
      setAssignedToId("");
      setParentTaskId(createProps?.initialParentTaskId ?? "");
      setSectionId(createProps?.initialSectionId ?? "");
      setEpicId("");
      setLabelIds([]);
      setIsCriticalPath(false);
    }
    // Primitives only — the props OBJECT gets fresh identity on every parent
    // render (query refetches, sibling mutations invalidating), and re-running
    // this reset wipes in-progress user input (GH #56, second root cause).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    isEdit,
    editingTask?.id,
    createProps?.initialStatus,
    createProps?.initialParentTaskId,
    createProps?.initialSectionId,
  ]);

  // Epics (docs/archive/plans/epics-spec.md §4/§6): epicId is only ever set on a
  // top-level task — mirror the backend's epic_on_subtask rejection here so
  // picking a parent never leaves a stale epic selection the submit would
  // otherwise send. The select below is also disabled while a parent is set.
  useEffect(() => {
    if (parentTaskId !== "") setEpicId("");
  }, [parentTaskId]);

  const possibleParents = (projectTasks ?? []).filter(
    (t) => !editingTask || (t.id !== editingTask.id && t.parentTaskId === null),
  );
  const subtasks = editingTask
    ? (projectTasks ?? [])
        .filter((t) => t.parentTaskId === editingTask.id)
        // Explicit per-parent comparator — mirrors backend/src/lib/taskOrdering.ts's
        // dense per-parent ordering rather than relying on GET /tasks's incidental
        // global (position asc, id asc) sort surviving the filter() above.
        .sort((a, b) => a.position - b.position || a.id - b.id)
    : [];

  function moveSubtask(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= subtasks.length) return;
    update.mutate({ id: subtasks[index].id, patch: { position: target } });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (startDate && dueDate && dueDate < startDate) {
      setError("Due date must be on or after start date.");
      return;
    }

    // Edit mode: pass through a date unchanged when its draft still matches
    // the day the original ISO was seeded from, instead of unconditionally
    // re-deriving the ISO — see `commitDraft`'s doc in `@/lib/dateField`.
    // Create mode has no original ISO to compare against, so it always
    // derives fresh via `isoFromDay` (UTC midnight of the picked day).
    const base = editingTask ? (baseTaskRef.current ?? editingTask) : null;
    const startIso = base ? commitDraft(startDate, base.startDate) : isoFromDay(startDate);
    const dueIso = base ? commitDraft(dueDate, base.dueDate) : isoFromDay(dueDate);
    const parent = parentTaskId === "" ? null : Number(parentTaskId);
    const sec = sectionId === "" ? null : Number(sectionId);
    const assignee = assignedToId === "" ? null : Number(assignedToId);

    try {
      if (isEdit && editingTask) {
        // Send only what changed since the form opened, plus `expected` (the
        // opening values) for those fields — the server then refuses with 409
        // `stale_write` if someone else changed the same field meanwhile.
        // A field the user never touched is never sent, so a concurrent edit
        // to it can neither conflict nor be overwritten; and an assignee left
        // alone is not re-sent (a form opened before a member was removed
        // must not re-add them).
        const { patch, expected } = diffTaskForm(base ?? editingTask, {
          title: title.trim(),
          description: description.trim() || null,
          status,
          priority,
          startDate: startIso,
          dueDate: dueIso,
          assignedToId: assignee,
          parentTaskId: parent,
          sectionId: sec,
          epicId: parent === null ? (epicId === "" ? null : Number(epicId)) : null,
          labelIds,
          isCriticalPath,
        });
        if (Object.keys(patch).length === 0) {
          requestClose();
          return;
        }
        try {
          await update.mutateAsync({ id: editingTask.id, patch, expected });
        } catch (err) {
          const stale = parseStaleWrite(err);
          if (!stale) throw err;
          setConflict({ taskId: editingTask.id, patch, stale });
          return;
        }
      } else {
        await create.mutateAsync({
          title: title.trim(),
          description: description.trim() || undefined,
          status,
          priority,
          startDate: startIso,
          dueDate: dueIso,
          assignedToId: assignee,
          parentTaskId: parent,
          sectionId: sec,
          epicId: parent === null ? (epicId === "" ? null : Number(epicId)) : null,
          labelIds: labelIds.length > 0 ? labelIds : undefined,
          isCriticalPath,
        });
      }
      requestClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    }
  }

  // "Keep mine": the same change again, without `expected` — last write wins.
  async function keepMine() {
    if (!conflict) return;
    const { taskId, patch } = conflict;
    setError(null);
    try {
      await update.mutateAsync({ id: taskId, patch });
      setConflict(null);
      requestClose();
    } catch (err) {
      setConflict(null);
      setError(err instanceof ApiError ? err.message : "Save failed.");
    }
  }

  // "Use theirs": the clashing fields take the server's values, as does any
  // field I never touched (my copy of it is just the old base — keeping it
  // would overwrite their change on the next save). My other edits stay, the
  // base moves to the server's task, and the form stays open to save them.
  function discardMine() {
    if (!conflict) return;
    const { stale, patch } = conflict;
    const t = stale.task;
    const adopt = fieldsToAdopt(patch, stale.conflicts);
    if (adopt.has("title")) setTitle(t.title);
    if (adopt.has("description")) setDescription(t.description ?? "");
    if (adopt.has("status")) setStatus(t.status);
    if (adopt.has("priority")) setPriority(t.priority);
    if (adopt.has("startDate")) setStartDate(dayFromIso(t.startDate) ?? "");
    if (adopt.has("dueDate")) setDueDate(dayFromIso(t.dueDate) ?? "");
    if (adopt.has("assignedToId")) setAssignedToId(t.assignedToId ?? "");
    if (adopt.has("parentTaskId")) setParentTaskId(t.parentTaskId ?? "");
    if (adopt.has("sectionId")) setSectionId(t.sectionId ?? "");
    if (adopt.has("epicId")) setEpicId(t.epicId ?? "");
    if (adopt.has("labelIds")) setLabelIds(t.labels.map((l) => l.id));
    if (adopt.has("isCriticalPath")) setIsCriticalPath(t.isCriticalPath ?? false);
    baseTaskRef.current = t;
    setConflict(null);
  }

  const submitting = create.isPending || update.isPending || remove.isPending;

  async function handleDelete() {
    if (!isEdit || !editingTask) return;
    setConfirmDeleteOpen(false);
    setError(null);
    try {
      await remove.mutateAsync(editingTask.id);
      requestClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  const taskIdLabel = editingTask
    ? `T-${String(editingTask.id).padStart(3, "0")}`
    : "New task";

  const customHeader = (
    <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-5 py-3">
      <span className="text-xs text-on-surface-variant">{taskIdLabel}</span>
      <button
        type="button"
        onClick={requestClose}
        className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container"
        aria-label="Close"
      >
        <span className="material-symbols-outlined text-base">close</span>
      </button>
    </div>
  );

  // Drawer and Modal each register a document-level Escape listener, so while
  // the delete confirm is open make the drawer's own Escape/backdrop close a
  // no-op — only the confirm closes.
  const subtaskWarning =
    subtasks.length > 0
      ? `\n\nThis task has ${subtasks.length} subtask(s) which will also be deleted.`
      : "";

  return (
    <>
    <Drawer
      open={open}
      closing={closing}
      onClose={confirmDeleteOpen || conflict ? () => {} : requestClose}
      onClosed={onClose}
      title={isEdit ? "Edit task" : "New task"}
      customHeader={customHeader}
      widthClass="max-w-lg"
      footer={
        <div className="flex w-full items-center gap-2">
          {isEdit && canEdit && (
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={submitting}
              className="mr-auto rounded-lg border border-error/40 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50"
            >
              {remove.isPending ? "Deleting…" : "Delete task"}
            </button>
          )}
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            className="ml-auto rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="task-form"
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? "Saving…" : isEdit ? "Save" : "Create task"}
          </button>
        </div>
      }
    >
      <form id="task-form" onSubmit={handleSubmit} className="space-y-3.5">
        {/* Title */}
        <div className="flex items-start gap-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus
            placeholder="Task title"
            className="flex-1 border-none bg-transparent text-lg font-bold text-on-surface outline-hidden placeholder:text-on-surface-variant/40 focus:outline-hidden"
          />
        </div>

        {/* Icon field rows */}
        <div className="space-y-2 rounded-xl border border-outline-variant bg-surface-container-low p-3">
          {/* Priority */}
          <FieldRow icon="flag" label="Priority">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              disabled={!canEdit}
              className={`cursor-pointer border-none bg-transparent text-xs font-semibold focus:outline-hidden disabled:cursor-default ${PRIORITY_COLOR[priority]}`}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </FieldRow>

          {/* Status */}
          <FieldRow icon="radio_button_checked" label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              disabled={!canEdit}
              className="cursor-pointer border-none bg-transparent text-xs font-semibold text-on-surface focus:outline-hidden disabled:cursor-default"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </FieldRow>

          {/* Critical Path */}
          <FieldRow icon={CRITICAL_PATH_GLYPH} label="Critical path">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={isCriticalPath}
                onCheckedChange={(checked) => setIsCriticalPath(checked)}
                disabled={!canEdit}
                aria-label={CRITICAL_PATH_LABEL}
              />
              <span className="text-xs text-on-surface-variant">
                {CRITICAL_PATH_HELPER_TEXT}
              </span>
            </div>
          </FieldRow>

          {/* Assignee */}
          <FieldRow icon="group" label="Assignee">
            <select
              value={assignedToId === "" ? "" : String(assignedToId)}
              onChange={(e) =>
                setAssignedToId(e.target.value === "" ? "" : Number(e.target.value))
              }
              disabled={!canEdit}
              className="cursor-pointer border-none bg-transparent text-xs font-semibold text-on-surface focus:outline-hidden disabled:cursor-default"
            >
              <option value="">Unassigned</option>
              {(users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} · {u.role}
                </option>
              ))}
            </select>
            <AssigneeMembershipNotice
              projectId={projectId}
              assigneeId={assignedToId === "" ? null : Number(assignedToId)}
              className="mt-1"
            />
          </FieldRow>

          {/* Dates (merged Start/Due, plan Task 3.5 — one between-style range picker) */}
          <FieldRow icon="calendar_month" label="Dates">
            <DateRangeField
              variant="bare"
              start={startDate || null}
              end={dueDate || null}
              onApply={(s, e) => {
                setStartDate(s ?? "");
                setDueDate(e ?? "");
              }}
              disabled={!canEdit}
              clearable
              emptyLabel="Pick start and due"
            />
          </FieldRow>

          {/* Parent task */}
          <FieldRow icon="account_tree" label="Parent">
            <select
              value={parentTaskId === "" ? "" : String(parentTaskId)}
              onChange={(e) =>
                setParentTaskId(e.target.value === "" ? "" : Number(e.target.value))
              }
              disabled={!canEdit}
              className="cursor-pointer border-none bg-transparent text-xs font-semibold text-on-surface focus:outline-hidden disabled:cursor-default"
            >
              <option value="">Top level</option>
              {possibleParents.map((t) => (
                <option key={t.id} value={t.id}>
                  T-{String(t.id).padStart(3, "0")} · {t.title}
                </option>
              ))}
            </select>
          </FieldRow>

          {/* Section */}
          <FieldRow icon="folder" label="Section">
            <select
              value={sectionId === "" ? "" : String(sectionId)}
              onChange={(e) =>
                setSectionId(e.target.value === "" ? "" : Number(e.target.value))
              }
              disabled={!canEdit}
              className="cursor-pointer border-none bg-transparent text-xs font-semibold text-on-surface focus:outline-hidden disabled:cursor-default"
            >
              <option value="">No section</option>
              {(sections ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FieldRow>

          {/* Epic — disabled + cleared when a parent is chosen above (§4:
              epicId is only ever set on a top-level task; the backend
              rejects it on a subtask with epic_on_subtask). */}
          <FieldRow icon="workspaces" label="Epic">
            <div className="flex items-center gap-1.5">
              <select
                value={epicId === "" ? "" : String(epicId)}
                onChange={(e) => setEpicId(e.target.value === "" ? "" : Number(e.target.value))}
                disabled={!canEdit || parentTaskId !== ""}
                className="cursor-pointer border-none bg-transparent text-xs font-semibold text-on-surface focus:outline-hidden disabled:cursor-default"
              >
                <option value="">No epic</option>
                {(epics ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
              {epicId !== "" &&
                (() => {
                  const selected = (epics ?? []).find((e) => e.id === epicId);
                  return selected ? <EpicChip epic={selected} compact /> : null;
                })()}
            </div>
          </FieldRow>

          {/* Labels */}
          <FieldRow icon="label" label="Labels">
            <LabelPicker
              projectId={projectId}
              selectedIds={labelIds}
              onChange={canEdit ? setLabelIds : () => {}}
            />
          </FieldRow>

        </div>

        {/* Description */}
        <div>
          <p className="mb-1.5 text-label-caps uppercase text-on-surface-variant">
            Description
          </p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Add a description…"
            disabled={!canEdit}
            className="w-full resize-y rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30 disabled:cursor-default"
          />
        </div>

        {/* Subtasks */}
        {isEdit && editingTask && (
          <div>
            <p className="mb-1.5 text-label-caps uppercase text-on-surface-variant">
              Subtasks {subtasks.length > 0 && `· ${subtasks.length}`}
            </p>
            {subtasks.length === 0 ? (
              <p className="text-xs text-on-surface-variant">No subtasks yet.</p>
            ) : (
              <ul className="divide-y divide-outline-variant rounded-xl border border-outline-variant">
                {subtasks.map((s, index) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={s.status === "DONE"}
                      onChange={() =>
                        update.mutate({
                          id: s.id,
                          patch: { status: s.status === "DONE" ? "TODO" : "DONE" },
                        })
                      }
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <span
                      className={`flex-1 text-xs ${s.status === "DONE" ? "text-on-surface-variant line-through" : "text-on-surface"}`}
                    >
                      {s.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveSubtask(index, -1)}
                        disabled={!canEdit || index === 0}
                        aria-label="Move subtask up"
                        className="rounded-sm p-0.5 text-on-surface-variant hover:bg-surface-container disabled:pointer-events-none disabled:opacity-30"
                      >
                        <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSubtask(index, 1)}
                        disabled={!canEdit || index === subtasks.length - 1}
                        aria-label="Move subtask down"
                        className="rounded-sm p-0.5 text-on-surface-variant hover:bg-surface-container disabled:pointer-events-none disabled:opacity-30"
                      >
                        <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
    </Drawer>
    <TaskConflictDialog
      open={conflict !== null}
      rows={
        conflict
          ? formatConflictRows(
              conflict.stale.conflicts,
              conflict.patch,
              withServerTask(
                {
                  users,
                  sections,
                  epics,
                  labels,
                  tasks: projectTasks,
                },
                conflict.stale.task,
              ),
            )
          : []
      }
      onUseTheirs={discardMine}
      onKeepMine={() => void keepMine()}
      busy={update.isPending}
    />
    <ConfirmModal
      open={confirmDeleteOpen}
      onClose={() => setConfirmDeleteOpen(false)}
      onConfirm={() => void handleDelete()}
      title="Delete task"
      body={<span className="whitespace-pre-line">{`Delete task "${editingTask?.title ?? ""}"? This cannot be undone.${subtaskWarning}`}</span>}
      confirmLabel="Delete"
      confirmTone="danger"
      busy={remove.isPending}
    />
    </>
  );
}

function FieldRow({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="material-symbols-outlined w-5 shrink-0 text-sm text-on-surface-variant">
        {icon}
      </span>
      <span className="w-20 shrink-0 text-xs text-on-surface-variant">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
