import { useEffect, useRef, useState, type FormEvent } from "react";
import { AssigneeAvatar } from "./AssigneeAvatar";
import { ConfirmModal } from "./ConfirmModal";
import { CopyLinkButton } from "./CopyLinkButton";
import {
  CRITICAL_PATH_GLYPH,
  CRITICAL_PATH_HELPER_TEXT,
  CRITICAL_PATH_LABEL,
} from "./CriticalPathMark";
import { EpicChip } from "./EpicChip";
import { InlineDateRangeEditor } from "./InlineDateRangeEditor";
import { LabelPicker } from "./LabelPicker";
import { TASK_STATUS_TONE_CLASS } from "./StatusChip";
import { TaskTicketField } from "@/components/itop/TaskTicketField";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { fmtAgo, fmtRange } from "@/lib/formatDate";
import { useAssigneeMembership } from "@/lib/useAssigneeMembership";
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import {
  type Priority,
  type Task,
  type TaskStatus,
  useAddComment,
  useComments,
  useCreateTask,
  useDeleteTask,
  useDuplicateTask,
  useItopStatus,
  useProject,
  useProjectEpics,
  useProjectSections,
  useProjectTasks,
  useUpdateTask,
  useUsers,
} from "@/lib/queries";

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

const PRIORITY_ORDER: Priority[] = ["LOW", "MEDIUM", "HIGH"];
const PRIORITY_ICON_CLASS: Record<Priority, string> = {
  LOW: "text-on-surface-variant",
  MEDIUM: "text-chip-amber-text",
  HIGH: "text-error",
  URGENT: "text-error",
};

function nextPriority(p: Priority): Priority {
  const idx = PRIORITY_ORDER.indexOf(p);
  if (idx === -1) return "LOW";
  return PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length];
}

interface TaskPanelProps {
  projectId: number;
  taskId: number;
  /** Re-target the panel at another task — subtask rows and the parent breadcrumb. */
  onOpenTask: (id: number) => void;
  onClose: () => void;
}

/**
 * Right-anchored task detail panel, deep-linked via `?task=<id>`. Replaces
 * TaskFormModal's edit mode everywhere it's opened from a card/row click —
 * TaskFormModal itself is kept around for CREATE only.
 *
 * A subtask row opens the same panel targeted at the subtask (mirroring
 * ProjectList's SubtaskRow), which is what makes every subtask field editable
 * from here. The breadcrumb is the way back: ProjectDetail keys the panel on
 * the task id, so a re-target is a remount with no in-panel history.
 */
export function TaskPanel({ projectId, taskId, onOpenTask, onClose }: TaskPanelProps) {
  const { user } = useAuth();
  const canEdit = hasPermission(user, "task:write");
  // Gates the "iTop ticket" row below — an install with no iTop connection
  // never sees the row at all (TaskTicketField.tsx repeats the same check
  // for its own inner rendering, but the label span here needs it too, or
  // an unconfigured install would show a label with no paired grid cell).
  const itopConfigured = useItopStatus().data?.configured ?? false;
  // Task 7.2, docs/archive/plans/itop-integration.md: TaskTicketField's
  // "Create in iTop" affordance needs the task's project's customer id — a
  // task itself has no customer of its own, so this is the one extra fetch
  // this panel needs for that field.
  const { data: project } = useProject(projectId);

  const { data: tasks } = useProjectTasks(projectId);
  const { data: sections } = useProjectSections(projectId);
  const { data: epics, isLoading: epicsLoading } = useProjectEpics(projectId);
  const { data: users } = useUsers();
  const assigneeAddsMember = useAssigneeMembership(projectId);
  const updateTask = useUpdateTask(projectId);
  const createTask = useCreateTask(projectId);
  const deleteTask = useDeleteTask(projectId);
  const duplicateTask = useDuplicateTask(projectId);

  const task = (tasks ?? []).find((t) => t.id === taskId) ?? null;
  const subtasks = (tasks ?? [])
    .filter((t) => t.parentTaskId === taskId)
    // Explicit per-parent comparator — mirrors backend/src/lib/taskOrdering.ts's
    // dense per-parent ordering rather than relying on GET /tasks's incidental
    // global (position asc, id asc) sort surviving the filter() above.
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const subtasksDone = subtasks.filter((s) => s.status === "DONE").length;

  // Max depth is 1 (backend/src/lib/taskOrdering.ts's assertValidParent), so a
  // task with a parent can never have subtasks of its own — `isSubtask` is what
  // hides the whole Subtasks block below rather than offering an "Add subtask"
  // form whose create call the backend would reject with max_depth_exceeded.
  const parentId = task?.parentTaskId ?? null;
  const isSubtask = parentId !== null;
  const parentTask = parentId === null ? null : ((tasks ?? []).find((t) => t.id === parentId) ?? null);

  // Epics (docs/archive/plans/epics-spec.md §6 "Task surfaces"). A subtask never
  // carries its own epicId (backend invariant, §4) — its breadcrumb shows the
  // PARENT's epic instead, read from the same tasks cache the breadcrumb
  // already uses for the parent's title.
  const taskEpic = task && task.epicId !== null ? (epics ?? []).find((e) => e.id === task.epicId) ?? null : null;
  const parentEpic =
    parentTask && parentTask.epicId !== null
      ? (epics ?? []).find((e) => e.id === parentTask.epicId) ?? null
      : null;
  // The task carries an epicId but the epics query hasn't resolved yet — show
  // a placeholder rather than "No epic", which would be actively wrong for
  // the instant between the task query and the epics query settling.
  const taskEpicPending = task !== null && task.epicId !== null && epicsLoading;

  const [menuOpen, setMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDates, setEditingDates] = useState(false);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [editingSection, setEditingSection] = useState(false);
  const [editingEpic, setEditingEpic] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [subtaskTitleDraft, setSubtaskTitleDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  // One rename edit settles exactly once. Enter, blur, and Escape can each end
  // the same edit — and whether closing the input ALSO re-fires onBlur (the
  // focused element is being unmounted) differs by engine; Chromium/React 18.3
  // does not, others do. Rather than depend on that, every path marks the edit
  // settled and a second path arriving late is a no-op. Reset per edit, not per
  // panel: a panel-wide flag left set by one row silently ate the next row's
  // rename.
  const renameSettledRef = useRef(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setEditingTitle(false);
    setEditingDates(false);
    setEditingAssignee(false);
    setEditingSection(false);
    setEditingEpic(false);
    setEditingSubtaskId(null);
    setMenuOpen(false);
    setStatusMenuOpen(false);
    setError(null);
  }, [taskId]);

  if (!task) {
    // `tasks` undefined = still loading; once it has loaded, a missing task was
    // deleted (or is not visible to this user) — say so instead of spinning.
    const notFound = tasks !== undefined;
    return (
      <aside
        ref={panelRef}
        className="fixed right-0 top-14 bottom-0 z-40 flex w-full flex-col border-l border-outline-variant bg-surface-container px-5 py-4 md:w-[380px]"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm text-on-surface-variant">
            {notFound ? "Task not found" : "Loading task…"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </aside>
    );
  }

  function patch(body: Parameters<typeof updateTask.mutate>[0]["patch"]) {
    if (!task) return;
    setError(null);
    updateTask.mutate(
      { id: task.id, patch: body },
      {
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : "Update failed.");
        },
      },
    );
  }

  function handleTitleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    if (trimmed && trimmed !== task!.title) patch({ title: trimmed });
  }

  async function handleAddSubtask(e: FormEvent) {
    e.preventDefault();
    const title = newSubtask.trim();
    if (!title || !task) return;
    setError(null);
    try {
      await createTask.mutateAsync({
        title,
        parentTaskId: task.id,
        sectionId: task.sectionId,
        status: "TODO",
      });
      setNewSubtask("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add subtask.");
    }
  }

  function toggleSubtask(s: Task) {
    updateTask.mutate({ id: s.id, patch: { status: s.status === "DONE" ? "TODO" : "DONE" } });
  }

  function startSubtaskRename(s: Task) {
    renameSettledRef.current = false;
    setSubtaskTitleDraft(s.title);
    setEditingSubtaskId(s.id);
  }

  function cancelSubtaskRename() {
    renameSettledRef.current = true;
    setEditingSubtaskId(null);
  }

  function commitSubtaskRename(e?: FormEvent) {
    e?.preventDefault();
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    const id = editingSubtaskId;
    setEditingSubtaskId(null);
    const trimmed = subtaskTitleDraft.trim();
    if (id === null || !trimmed) return;
    const current = subtasks.find((s) => s.id === id);
    if (!current || current.title === trimmed) return;
    setError(null);
    updateTask.mutate(
      { id, patch: { title: trimmed } },
      {
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : "Rename failed.");
        },
      },
    );
  }

  async function handleSubtaskDuplicate(s: Task) {
    setError(null);
    try {
      // No navigation — the copy shows up in the subtask list via the
      // mutation's own cache invalidation.
      await duplicateTask.mutateAsync(s.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not duplicate the task.");
    }
  }

  async function handleDuplicate() {
    if (!task) return;
    setError(null);
    try {
      const copy = await duplicateTask.mutateAsync(task.id);
      onOpenTask(copy.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not duplicate the task.");
    }
  }

  async function handleDelete() {
    if (!task) return;
    setError(null);
    try {
      await deleteTask.mutateAsync(task.id);
      setConfirmDelete(false);
      // Deleting a subtask returns to its parent rather than closing outright —
      // the user reached this panel from the parent's subtask list.
      if (parentId !== null) onOpenTask(parentId);
      else onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
      setConfirmDelete(false);
    }
  }

  const sectionName = task.section?.name ?? "No section";

  return (
    <>
      <aside
        ref={panelRef}
        role="dialog"
        aria-label="Task details"
        className="fixed right-0 top-14 bottom-0 z-40 flex w-full flex-col border-l border-outline-variant bg-surface-container shadow-overlay md:w-[380px]"
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
          <div className="relative">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setStatusMenuOpen((v) => !v)}
              className={[
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-display text-meta font-semibold",
                TASK_STATUS_TONE_CLASS[task.status],
                canEdit ? "cursor-pointer" : "cursor-default",
              ].join(" ")}
            >
              {TASK_STATUS_LABEL[task.status]}
              {canEdit && (
                <span className="material-symbols-outlined text-[13px]">expand_more</span>
              )}
            </button>
            {statusMenuOpen && canEdit && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setStatusMenuOpen(false)} />
                <div className="absolute left-0 z-20 mt-1 w-36 rounded-lg border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        patch({ status: s });
                        setStatusMenuOpen(false);
                      }}
                      className={[
                        "flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-surface-container",
                        s === task.status ? "font-bold text-primary" : "text-on-surface",
                      ].join(" ")}
                    >
                      {TASK_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="flex-1" />
          <CopyLinkButton
            label="Copy task link"
            getUrl={() => `${window.location.origin}/projects/${projectId}?task=${taskId}`}
            className="rounded-sm p-1 hover:bg-surface-container-high"
          />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="material-symbols-outlined rounded-sm p-1 text-base text-on-surface-variant hover:bg-surface-container-high"
              aria-label="Task options"
            >
              more_horiz
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay">
                  <button
                    type="button"
                    disabled={!canEdit || duplicateTask.isPending}
                    onClick={() => {
                      setMenuOpen(false);
                      void handleDuplicate();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-on-surface hover:bg-surface-container-high disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm" aria-hidden="true">
                      content_copy
                    </span>
                    Duplicate task
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-error hover:bg-error-container disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                    Delete task
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Parent breadcrumb — the only way back out of a subtask. */}
          {parentTask && (
            <div className="mb-1 flex max-w-full items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenTask(parentTask.id)}
                className="flex min-w-0 items-center gap-0.5 rounded-sm text-meta text-on-surface-variant hover:text-primary outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
                  arrow_back
                </span>
                <span className="truncate">{parentTask.title}</span>
              </button>
              {parentEpic && <EpicChip epic={parentEpic} compact />}
            </div>
          )}

          {/* Title + subtitle */}
          {editingTitle ? (
            <form onSubmit={handleTitleSubmit}>
              <input
                autoFocus
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={handleTitleSubmit}
                maxLength={200}
                className="w-full border-none bg-transparent text-lg font-bold text-on-surface outline-hidden focus:outline-hidden"
              />
            </form>
          ) : (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                setTitleDraft(task.title);
                setEditingTitle(true);
              }}
              className="block w-full rounded-sm text-left text-lg font-bold text-on-surface hover:bg-surface-container-high disabled:cursor-default"
            >
              {task.title}
            </button>
          )}
          {task.section && (
            <p className="mt-0.5 text-meta text-on-surface-variant">in {sectionName}</p>
          )}

          {/* Meta grid */}
          <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 text-sm">
            <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
              Assignee
            </span>
            <div className="relative">
              {editingAssignee && canEdit ? (
                <>
                <select
                  autoFocus
                  value={task.assignedToId ?? ""}
                  onChange={(e) => {
                    patch({ assignedToId: e.target.value === "" ? null : Number(e.target.value) });
                    setEditingAssignee(false);
                  }}
                  onBlur={() => setEditingAssignee(false)}
                  className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-1 text-xs text-on-surface focus:border-primary focus:outline-hidden"
                >
                  <option value="">Unassigned</option>
                  {(users ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {`${u.username}${assigneeAddsMember(u.id) ? " (not on project)" : ""}`}
                    </option>
                  ))}
                </select>
                {/* This picker saves the moment an option is chosen, so the
                    warning goes on the options themselves plus this line —
                    a plain paragraph, not a live region (specs query the
                    panel by role). */}
                {(users ?? []).some((u) => assigneeAddsMember(u.id)) && (
                  <p className="mt-1 text-meta text-on-surface-variant">
                    People marked “not on project” are added to it when assigned.
                  </p>
                )}
                </>
              ) : (
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setEditingAssignee(true)}
                  className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
                >
                  <AssigneeAvatar user={task.assignedTo} size="xs" />
                  <span className="text-on-surface">
                    {task.assignedTo ? task.assignedTo.username : "Unassigned"}
                  </span>
                </button>
              )}
            </div>

            <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
              Dates
            </span>
            <div className="relative">
              {editingDates && canEdit ? (
                <InlineDateRangeEditor
                  startISO={task.startDate}
                  endISO={task.dueDate}
                  onSave={(s, e) => {
                    patch({ startDate: s, dueDate: e });
                    setEditingDates(false);
                  }}
                  onCancel={() => setEditingDates(false)}
                />
              ) : (
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setEditingDates(true)}
                  className="rounded-sm px-1 py-0.5 text-left text-on-surface hover:bg-surface-container-high disabled:cursor-default"
                >
                  {fmtRange(task.startDate, task.dueDate)}
                </button>
              )}
            </div>

            <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
              Priority
            </span>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => patch({ priority: nextPriority(task.priority) })}
              className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
              title={canEdit ? "Click to cycle priority" : undefined}
            >
              <span
                className={`material-symbols-outlined text-[15px] ${PRIORITY_ICON_CLASS[task.priority]}`}
              >
                flag
              </span>
              <span className="text-on-surface">{PRIORITY_LABEL[task.priority]}</span>
            </button>

            <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
              Type
            </span>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => patch({ isMilestone: !task.isMilestone })}
              className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
              title={canEdit ? "Toggle between task bar and milestone diamond" : undefined}
            >
              <span
                className={`material-symbols-outlined text-[15px] ${task.isMilestone ? "text-primary" : "text-on-surface-variant"}`}
              >
                {task.isMilestone ? "diamond" : "check_box_outline_blank"}
              </span>
              <span className="text-on-surface">
                {task.isMilestone ? "Milestone" : "Task"}
              </span>
            </button>

            <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
              {CRITICAL_PATH_LABEL}
            </span>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => patch({ isCriticalPath: !task.isCriticalPath })}
              className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
              title={canEdit ? CRITICAL_PATH_HELPER_TEXT : undefined}
              aria-label={`${CRITICAL_PATH_LABEL}: ${task.isCriticalPath ? "Yes" : "No"}`}
            >
              <span
                className={`material-symbols-outlined text-[15px] ${task.isCriticalPath ? "text-chip-violet-text" : "text-on-surface-variant"}`}
              >
                {task.isCriticalPath ? CRITICAL_PATH_GLYPH : "check_box_outline_blank"}
              </span>
              <span className="text-on-surface">{task.isCriticalPath ? "Yes" : "No"}</span>
            </button>

            <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
              Section
            </span>
            <div className="relative">
              {editingSection && canEdit ? (
                <select
                  autoFocus
                  value={task.sectionId ?? ""}
                  onChange={(e) => {
                    patch({ sectionId: e.target.value === "" ? null : Number(e.target.value) });
                    setEditingSection(false);
                  }}
                  onBlur={() => setEditingSection(false)}
                  className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-1 text-xs text-on-surface focus:border-primary focus:outline-hidden"
                >
                  <option value="">No section</option>
                  {(sections ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setEditingSection(true)}
                  className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
                >
                  {task.section && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: task.section.color }}
                    />
                  )}
                  <span className="text-on-surface">{sectionName}</span>
                </button>
              )}
            </div>

            {/* Epic — hidden entirely on a subtask (§4: epicId is only ever
                set on a top-level task; the parent's epic shows in the
                breadcrumb above instead). */}
            {!isSubtask && (
              <>
                <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
                  Epic
                </span>
                <div className="relative">
                  {editingEpic && canEdit ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        autoFocus
                        value={task.epicId ?? ""}
                        onChange={(e) => {
                          patch({ epicId: e.target.value === "" ? null : Number(e.target.value) });
                          setEditingEpic(false);
                        }}
                        onBlur={() => setEditingEpic(false)}
                        className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-1 text-xs text-on-surface focus:border-primary focus:outline-hidden"
                      >
                        <option value="">No epic</option>
                        {(epics ?? []).map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.title}
                          </option>
                        ))}
                      </select>
                      {taskEpic && <EpicChip epic={taskEpic} compact />}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!canEdit || taskEpicPending}
                      onClick={() => setEditingEpic(true)}
                      className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
                    >
                      {taskEpicPending ? (
                        <span
                          aria-hidden="true"
                          className="h-4 w-16 animate-pulse rounded-full bg-surface-container-high"
                        />
                      ) : taskEpic ? (
                        <EpicChip epic={taskEpic} compact />
                      ) : (
                        <span className="text-on-surface">No epic</span>
                      )}
                    </button>
                  )}
                </div>
              </>
            )}

            {itopConfigured && (
              <>
                <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
                  iTop ticket
                </span>
                <TaskTicketField
                  itopTicketRef={task.itopTicketRef}
                  canEdit={canEdit}
                  customerId={project?.customerId ?? null}
                  taskTitle={task.title}
                  taskDescription={task.description}
                  onSave={(ref) => patch({ itopTicketRef: ref })}
                />
              </>
            )}
          </div>

          {/* Labels */}
          <div className="mt-4">
            <p className="mb-1.5 font-display text-label-caps uppercase text-on-surface-variant">
              Labels
            </p>
            <LabelPicker
              projectId={projectId}
              selectedIds={task.labels.map((l) => l.id)}
              onChange={canEdit ? (ids) => patch({ labelIds: ids }) : () => {}}
            />
          </div>

          {/* Subtasks — hidden entirely on a subtask (max depth is 1). */}
          {!isSubtask && (
            <div className="mt-4">
              <p className="mb-1.5 font-display text-label-caps uppercase text-on-surface-variant">
                Subtasks {subtasks.length > 0 && `${subtasksDone}/${subtasks.length}`}
              </p>
              <Sortable
                value={subtasks}
                // No-op: `subtasks` is derived from the tasks query, not local
                // state. `onValueCommit` below fires the single PATCH, and
                // `useUpdateTask`'s onMutate optimistically re-packs the query
                // cache (reorderTasksLocally) — the derived array picks up the
                // new order on the resulting re-render, no local mirror needed.
                onValueChange={() => {}}
                getItemValue={(s) => String(s.id)}
                onValueCommit={(_value, meta) => {
                  const moved = meta.previousValue[meta.activeIndex];
                  if (!moved) return;
                  updateTask.mutate({ id: moved.id, patch: { position: meta.overIndex } });
                }}
                render={<div className="space-y-0.5" />}
              >
                {subtasks.map((s) => (
                  <SortableItem
                    key={s.id}
                    value={String(s.id)}
                    // No `disabled` here: the handle is the only thing that
                    // carries dnd-kit's `listeners` (handle-only activation —
                    // see the comment on the handle below), and it's only
                    // rendered at all when `canEdit`, so activation is already
                    // blocked for read-only users. Passing `disabled={!canEdit}`
                    // instead dimmed the whole row via the vendor's own
                    // `disabled && "opacity-50"` (sortable.tsx) — a regression
                    // vs. the old markup, which only dimmed the arrows.
                    render={
                      <div className="group/subtask flex items-center gap-2 rounded-sm px-1 py-1 text-[13px]" />
                    }
                  >
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => toggleSubtask(s)}
                      aria-label={s.status === "DONE" ? "Mark not done" : "Mark done"}
                      className={[
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                        s.status === "DONE"
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-outline-variant hover:border-primary",
                        canEdit ? "cursor-pointer" : "cursor-default",
                      ].join(" ")}
                    >
                      {s.status === "DONE" && (
                        <span className="material-symbols-outlined text-meta leading-none">
                          check
                        </span>
                      )}
                    </button>
                    {editingSubtaskId === s.id ? (
                      <form onSubmit={commitSubtaskRename} className="min-w-0 flex-1">
                        <input
                          autoFocus
                          type="text"
                          value={subtaskTitleDraft}
                          onChange={(e) => setSubtaskTitleDraft(e.target.value)}
                          onBlur={() => commitSubtaskRename()}
                          onKeyDown={(e) => {
                            if (e.key !== "Escape") return;
                            // Stop the panel-level Escape listener (document
                            // keydown, above) from closing the whole panel —
                            // here Escape means "cancel this rename" only.
                            e.stopPropagation();
                            cancelSubtaskRename();
                          }}
                          maxLength={200}
                          aria-label="Subtask title"
                          className="w-full border-none bg-transparent text-[13px] text-on-surface outline-hidden focus:outline-hidden"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenTask(s.id)}
                        title={s.title}
                        className={[
                          "min-w-0 flex-1 truncate rounded-sm text-left hover:text-primary outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring",
                          s.status === "DONE"
                            ? "text-on-surface-variant line-through"
                            : "text-on-surface",
                        ].join(" ")}
                      >
                        {s.title}
                      </button>
                    )}
                    {canEdit && editingSubtaskId !== s.id && (
                      // A single direct button, not the Gantt tree's "…" row menu
                      // (ui/context-menu.tsx): rename is the only action this row
                      // needs — delete and every other field live in the subtask's
                      // own panel, one click away via the title button above.
                      // Always visible below `md:` — a touch device has no hover
                      // to reveal it with.
                      <button
                        type="button"
                        onClick={() => startSubtaskRename(s)}
                        aria-label={`Rename ${s.title}`}
                        className="material-symbols-outlined -m-1 shrink-0 rounded-sm p-1 text-sm text-on-surface-variant/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:opacity-0 md:group-hover/subtask:opacity-100 md:focus-visible:opacity-100"
                      >
                        edit
                      </button>
                    )}
                    {canEdit && editingSubtaskId !== s.id && (
                      <button
                        type="button"
                        disabled={duplicateTask.isPending && duplicateTask.variables === s.id}
                        onClick={() => void handleSubtaskDuplicate(s)}
                        aria-label={`Duplicate ${s.title}`}
                        className="material-symbols-outlined -m-1 shrink-0 rounded-sm p-1 text-sm text-on-surface-variant/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:opacity-0 md:group-hover/subtask:opacity-100 md:focus-visible:opacity-100 disabled:cursor-default disabled:opacity-50"
                      >
                        content_copy
                      </button>
                    )}
                    {canEdit && (
                      <SortableItemHandle
                        // `cursor={false}` opts out of the vendored component's
                        // own (unconditional, `!important`) grab-cursor class —
                        // we own the cursor entirely below via a plain class,
                        // unconditional here since this whole handle only
                        // renders when `canEdit` is true.
                        cursor={false}
                        render={
                          <button
                            type="button"
                            aria-label="Reorder subtask"
                            className="material-symbols-outlined shrink-0 touch-none rounded-sm text-sm text-on-surface-variant/60 cursor-grab active:cursor-grabbing outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring"
                          />
                        }
                      >
                        drag_indicator
                      </SortableItemHandle>
                    )}
                  </SortableItem>
                ))}
              </Sortable>
              {canEdit && (
                <form onSubmit={handleAddSubtask} className="mt-1.5 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[13px] text-primary">add</span>
                  <input
                    type="text"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    placeholder="Add subtask"
                    maxLength={200}
                    className="flex-1 border-none bg-transparent text-[13px] text-on-surface outline-hidden placeholder:text-on-surface-variant/60 focus:outline-hidden"
                  />
                </form>
              )}
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {/* Comments */}
          <div className="mt-5 border-t border-outline-variant pt-4">
            <PanelComments taskId={task.id} />
          </div>
        </div>
      </aside>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete task"
        body={
          <>
            Delete task &quot;{task.title}&quot;? This cannot be undone.
            {subtasks.length > 0 && (
              <>
                <br />
                <br />
                This task has {subtasks.length} subtask(s) which will also be deleted.
              </>
            )}
          </>
        }
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteTask.isPending}
      />
    </>
  );
}

/**
 * Comment thread + single-line composer per the mockup ("Write a comment…"
 * placeholder + green send icon), backed by useComments / useAddComment.
 * This is the app's only comment UI (the former standalone CommentThread
 * component was never mounted and has been removed).
 */
function PanelComments({ taskId }: { taskId: number }) {
  const { data: comments, isLoading, isError, error } = useComments(taskId);
  const addComment = useAddComment(taskId);
  const [body, setBody] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || addComment.isPending) return;
    try {
      await addComment.mutateAsync(trimmed);
      setBody("");
    } catch {
      // surfaced via mutation error state below
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display text-label-caps uppercase text-on-surface-variant">
        Comments {comments && comments.length > 0 && `· ${comments.length}`}
      </h3>

      {isLoading && (
        <div className="h-12 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">Could not load comments: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {comments && comments.length === 0 && (
        <p className="text-xs text-on-surface-variant">No comments yet.</p>
      )}

      {comments && comments.length > 0 && (
        <ol className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <AssigneeAvatar user={c.author} size="xs" />
              <div className="min-w-0 flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2">
                <div className="mb-0.5 flex items-center justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate font-medium text-on-surface">{c.author.username}</span>
                  <span className="shrink-0 text-on-surface-variant">{fmtAgo(c.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap wrap-break-word text-xs text-on-surface">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2"
      >
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          placeholder="Write a comment…"
          className="min-w-0 flex-1 border-none bg-transparent text-xs text-on-surface outline-hidden placeholder:text-on-surface-variant/60 focus:outline-hidden"
        />
        <button
          type="submit"
          disabled={addComment.isPending || !body.trim()}
          aria-label="Send comment"
          className="flex shrink-0 items-center text-primary disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[17px]">send</span>
        </button>
      </form>
      {addComment.error && (
        <p className="text-[12px] text-error">{(addComment.error as Error).message}</p>
      )}
    </div>
  );
}
