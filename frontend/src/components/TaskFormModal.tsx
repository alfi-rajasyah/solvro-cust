import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DateRangeField } from "./DateRangeField";
import { Drawer } from "./Drawer";
import { LabelPicker } from "./LabelPicker";
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
import {
  type Priority,
  type Task,
  type TaskStatus,
  useCreateTask,
  useDeleteTask,
  useProjectSections,
  useProjectTasks,
  useUpdateTask,
  useUsers,
} from "@/lib/queries";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

const PRIORITY_COLOR: Record<Priority, string> = {
  LOW: "text-on-surface-variant",
  MEDIUM: "text-amber-600",
  HIGH: "text-orange-600",
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

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [startDate, setStartDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [assignedToId, setAssignedToId] = useState<number | "">("");
  const [parentTaskId, setParentTaskId] = useState<number | "">("");
  const [sectionId, setSectionId] = useState<number | "">("");
  const [labelIds, setLabelIds] = useState<number[]>([]);
  const [isCriticalPath, setIsCriticalPath] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drive the drawer's slide-out: every close path sets `closing`, and
  // the parent's real `onClose` (which unmounts us) only runs once the
  // exit transition has finished.
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);

  const editingTask = isEdit ? (props as EditProps).task : null;
  const createProps = isEdit ? null : (props as CreateProps);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description ?? "");
      setStatus(editingTask.status);
      setPriority(editingTask.priority);
      setStartDate(dayFromIso(editingTask.startDate) ?? "");
      setDueDate(dayFromIso(editingTask.dueDate) ?? "");
      setAssignedToId(editingTask.assignedToId ?? "");
      setParentTaskId(editingTask.parentTaskId ?? "");
      setSectionId(editingTask.sectionId ?? "");
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
    const startIso = isEdit && editingTask
      ? commitDraft(startDate, editingTask.startDate)
      : isoFromDay(startDate);
    const dueIso = isEdit && editingTask
      ? commitDraft(dueDate, editingTask.dueDate)
      : isoFromDay(dueDate);
    const parent = parentTaskId === "" ? null : Number(parentTaskId);
    const sec = sectionId === "" ? null : Number(sectionId);
    const assignee = assignedToId === "" ? null : Number(assignedToId);

    try {
      if (isEdit && editingTask) {
        await update.mutateAsync({
          id: editingTask.id,
          patch: {
            title: title.trim(),
            description: description.trim() || null,
            status,
            priority,
            startDate: startIso,
            dueDate: dueIso,
            assignedToId: assignee,
            parentTaskId: parent,
            sectionId: sec,
            labelIds,
            isCriticalPath,
          },
        });
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
          labelIds: labelIds.length > 0 ? labelIds : undefined,
          isCriticalPath,
        });
      }
      requestClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    }
  }

  const submitting = create.isPending || update.isPending || remove.isPending;

  async function handleDelete() {
    if (!isEdit || !editingTask) return;
    const subtaskWarning =
      subtasks.length > 0
        ? `\n\nThis task has ${subtasks.length} subtask(s) which will also be deleted.`
        : "";
    const ok = window.confirm(
      `Delete task "${editingTask.title}"? This cannot be undone.${subtaskWarning}`,
    );
    if (!ok) return;
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

  return (
    <Drawer
      open={open}
      closing={closing}
      onClose={requestClose}
      onClosed={onClose}
      title={isEdit ? "Edit task" : "New task"}
      customHeader={customHeader}
      widthClass="max-w-lg"
      footer={
        <div className="flex w-full items-center gap-2">
          {isEdit && canEdit && (
            <button
              type="button"
              onClick={handleDelete}
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
                  {p}
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
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </FieldRow>

          {/* Critical Path */}
          <FieldRow icon={CRITICAL_PATH_GLYPH} label="Critical Path">
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
              <option value="">— Top level —</option>
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
              <option value="">— No section —</option>
              {(sections ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
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
          <p className="mb-1.5 text-label-caps uppercase tracking-wider text-on-surface-variant">
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
            <p className="mb-1.5 text-label-caps uppercase tracking-wider text-on-surface-variant">
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
