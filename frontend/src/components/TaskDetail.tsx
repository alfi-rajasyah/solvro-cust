import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { resolveSectionColors } from "@/lib/gantt/palette";
import { AssigneeAvatar } from "./AssigneeAvatar";
import {
  CRITICAL_PATH_GLYPH,
  CRITICAL_PATH_HELPER_TEXT,
  CRITICAL_PATH_LABEL,
} from "./CriticalPathMark";
import { EpicChip } from "./EpicChip";
import { InlineDateRangeEditor } from "./InlineDateRangeEditor";
import { LabelPicker } from "./LabelPicker";
import { OutlineMentions } from "./OutlineMentions";
import { TaskConflictDialog } from "./TaskConflictDialog";
import { RowTicketCell, type RowTicketContext } from "@/components/itop/RowTicketCell";
import { TaskTicketField } from "@/components/itop/TaskTicketField";
import { useCanCreateItopTicket } from "@/components/itop/useCanCreateItopTicket";
import { useItopOrgChoice } from "@/components/itop/useItopOrgChoice";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { CommentBody, CommentComposer } from "@/components/CommentMentions";
import { fmtAgo, fmtRange } from "@/lib/formatDate";
import { parseStoryPoints } from "@/lib/storyPoints";
import { useAssigneeMembership } from "@/lib/useAssigneeMembership";
import { assignableUsers, assigneeOptionLabel } from "@/lib/assignableUsers";
import { isApplePlatform } from "@/lib/platform";
import { PRIORITY_LABEL } from "@/lib/labels";
import {
  buildExpected,
  datePatchFromEdit,
  formatConflictRows,
  isSupersededWrite,
  parseStaleWrite,
  withServerTask,
  type StaleWrite,
} from "@/lib/taskConflict";
import {
  type Priority,
  type Task,
  type UpdateTaskInput,
  useAddComment,
  useComments,
  useCreateTask,
  useDuplicateTask,
  useItopStatus,
  useItopTicketsByRefs,
  useProject,
  useProjectEpics,
  useProjectLabels,
  useProjectMembers,
  useProjectSections,
  useProjectTasks,
  useUpdateTask,
  useTaskStatuses,
  useUsers,
} from "@/lib/queries";

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

/** What a shell's header needs from the body: the task, the save path and the error slot. */
export interface TaskDetailApi {
  task: Task;
  canEdit: boolean;
  /** Same save path as the inline fields: optimistic, stale-write conflict dialog included. */
  patch: (body: Parameters<ReturnType<typeof useUpdateTask>["mutate"]>[0]["patch"]) => void;
  /** Show (or with null clear) the error alert at the top of the body. */
  reportError: (message: string | null) => void;
}

export interface TaskDetailProps {
  projectId: number;
  taskId: number;
  /** "panel": one column in the side panel. "page": two columns from md:, one below. */
  layout: "panel" | "page";
  /** Re-target at another task: subtask rows and the parent breadcrumb. */
  onOpenTask: (id: number) => void;
  /** The shell's header, rendered above the body so it shares the body's save path and error slot. */
  renderHeader?: (api: TaskDetailApi) => ReactNode;
  /** True while a modal opened from inside the body (conflict dialog, iTop sheets) owns Escape. */
  onOverlayChange?: (open: boolean) => void;
}

/**
 * The task body shared by the side panel and the task page: every field, its
 * save rules, subtasks, Outline pages and comments live here once. The shell
 * (position, focus, Escape, close) belongs to the caller. Renders nothing
 * until the task is in the project's task list.
 */
export function TaskDetail({ projectId, taskId, layout, onOpenTask, renderHeader, onOverlayChange }: TaskDetailProps) {
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
  const itopOrg = useItopOrgChoice(project?.customers ?? []);
  const { data: itopStatusData } = useItopStatus();
  const subtaskCreateGate = useCanCreateItopTicket(itopOrg.customerId, itopOrg.customerName);

  const { data: tasks } = useProjectTasks(projectId);
  const { data: sections } = useProjectSections(projectId);
  const sectionColors = useMemo(() => resolveSectionColors(sections ?? []), [sections]);
  const { data: epics, isLoading: epicsLoading } = useProjectEpics(projectId);
  const { data: users } = useUsers();
  const { data: statusDefs } = useTaskStatuses();
  const { data: labels } = useProjectLabels(projectId);
  const assigneeAddsMember = useAssigneeMembership(projectId);
  const updateTask = useUpdateTask(projectId);
  const createTask = useCreateTask(projectId);
  const addingSubtaskRef = useRef(false);
  const duplicateTask = useDuplicateTask(projectId);

  const task = (tasks ?? []).find((t) => t.id === taskId) ?? null;
  const subtasks = (tasks ?? [])
    .filter((t) => t.parentTaskId === taskId)
    // Explicit per-parent comparator — mirrors backend/src/lib/taskOrdering.ts's
    // dense per-parent ordering rather than relying on GET /tasks's incidental
    // global (position asc, id asc) sort surviving the filter() above.
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const subtasksDone = subtasks.filter((s) => s.status === "DONE").length;
  const { data: subtaskTickets } = useItopTicketsByRefs(
    subtasks.flatMap((s) => (s.itopTicketRef ? [s.itopTicketRef] : [])),
    { enabled: itopConfigured && hasPermission(user, "customer:read") },
  );
  const subtaskTicketCtx: RowTicketContext | null =
    itopConfigured && project
      ? {
          projectId,
          projectName: project.name,
          customerId: itopOrg.customerId,
          organisations: itopOrg.organisations,
          organisationLabel: itopOrg.organisationLabel,
          baseUrl: itopStatusData?.baseUrl ?? null,
          gate: subtaskCreateGate,
          byRef: subtaskTickets,
        }
      : null;

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


  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editingDates, setEditingDates] = useState(false);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [editingSection, setEditingSection] = useState(false);
  const [editingEpic, setEditingEpic] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");
  // Remembered across quick-adds while the panel stays open.
  const [newSubtaskAssigneeId, setNewSubtaskAssigneeId] = useState<number | null>(null);
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [subtaskTitleDraft, setSubtaskTitleDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A save that lost a per-field race (409 `stale_write`): the change that was
  // refused, and what the server says clashed. Drives TaskConflictDialog.
  const [conflict, setConflict] = useState<{
    taskId: number;
    patch: UpdateTaskInput;
    stale: StaleWrite;
  } | null>(null);


  // The error alert sits at the top of the scroll area; bring it into view when
  // one appears so a failed Delete/Duplicate is seen even if the user has
  // scrolled down to the subtasks (ISS-059).
  const errorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  // One rename edit settles exactly once. Enter, blur, and Escape can each end
  // the same edit — and whether closing the input ALSO re-fires onBlur (the
  // focused element is being unmounted) differs by engine; Chromium/React 18.3
  // does not, others do. Rather than depend on that, every path marks the edit
  // settled and a second path arriving late is a no-op. Reset per edit, not per
  // panel: a panel-wide flag left set by one row silently ate the next row's
  // rename.
  const renameSettledRef = useRef(false);
  // Same guard for the panel's own title editor; reset when it opens.
  const titleSettledRef = useRef(false);
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusTitleRef = useRef(false);
  // And for the description editor: blur and Escape can both end one edit.
  const descriptionSettledRef = useRef(false);
  const descriptionId = useId();
  const descriptionButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusDescriptionRef = useRef(false);
  // The task as it was when a title or date edit began. Those editors stay open
  // for a while and the 30 s live refresh can land meanwhile; `expected` and the
  // "did anything change" check must measure against what the user started
  // from, not the refreshed row (which would let their draft silently overwrite
  // someone else's new value). Single-click edits use the live row.
  const [editBase, setEditBase] = useState<Task | null>(null);

  // True while a sheet opened from inside the panel (the iTop New-ticket
  // sheet) is showing: Escape belongs to that sheet, and closing the panel
  // under a pending create would unmount the field that pins the new ref.
  const [nestedSheetOpen, setNestedSheetOpen] = useState(false);
  // Row ticket cells report balanced open/close; a count keeps one cell's close from clearing another's.
  const [rowOverlayCount, setRowOverlayCount] = useState(0);
  const onRowOverlayChange = useCallback(
    (open: boolean) => setRowOverlayCount((c) => Math.max(0, c + (open ? 1 : -1))),
    [],
  );


  // The conflict dialog and the iTop sheets are modals with their own Escape
  // handling; the shell (the panel) must not close under them.
  const overlayOpen = conflict !== null || nestedSheetOpen || rowOverlayCount > 0;
  useEffect(() => {
    onOverlayChange?.(overlayOpen);
  }, [onOverlayChange, overlayOpen]);

  useEffect(() => {
    setEditingTitle(false);
    setEditingDescription(false);
    descriptionSettledRef.current = true;
    setEditingDates(false);
    setEditingAssignee(false);
    setEditingSection(false);
    setEditingEpic(false);
    setEditingSubtaskId(null);
    setError(null);
    setConflict(null);
  }, [taskId]);

  // After Enter or Escape in the title editor, focus returns to its button.
  useEffect(() => {
    if (!editingTitle && focusTitleRef.current) {
      focusTitleRef.current = false;
      titleButtonRef.current?.focus();
    }
  }, [editingTitle]);

  // After Escape, hand focus back to the button that opened the editor.
  useEffect(() => {
    if (!editingDescription && focusDescriptionRef.current) {
      focusDescriptionRef.current = false;
      descriptionButtonRef.current?.focus();
    }
  }, [editingDescription]);

  if (!task) return null;

  function patch(body: Parameters<typeof updateTask.mutate>[0]["patch"], base: Task | null = task) {
    if (!task) return;
    setError(null);
    const taskId = task.id;
    // Inline edits are checked against what this panel last showed: `expected`
    // is the task's current value for exactly the fields in the patch. The
    // server refuses with 409 `stale_write` when someone changed one of them.
    // mutateAsync, not mutate(…, { onError }): mutate-level callbacks only fire
    // for the LATEST call on this hook, so a second quick save would swallow
    // the first one's conflict.
    updateTask
      .mutateAsync({ id: taskId, patch: body, expected: buildExpected(base ?? task, body) })
      .catch((err: unknown) => {
        // Dropped behind an earlier refused save: that conflict is the one shown.
        if (isSupersededWrite(err)) return;
        const stale = parseStaleWrite(err);
        if (stale) {
          // Keep the FIRST conflict if one is already open.
          setConflict((open) => open ?? { taskId, patch: body, stale });
          return;
        }
        setError(err instanceof ApiError ? err.message : "Update failed.");
      });
  }

  // "Keep mine": the same change again, without `expected` — last write wins.
  function keepMine() {
    if (!conflict) return;
    const { taskId, patch: body } = conflict;
    setConflict(null);
    setError(null);
    updateTask.mutateAsync({ id: taskId, patch: body }).catch((err: unknown) => {
      if (isSupersededWrite(err)) return;
      setError(err instanceof ApiError ? err.message : "Update failed.");
    });
  }

  // "Use theirs": drop my change. The failed save already rolled back the
  // optimistic edit and refetched the task list, so closing is all that's left.
  function discardMine() {
    setConflict(null);
  }

  function handleTitleSubmit(e: FormEvent) {
    e.preventDefault();
    // Enter and blur can both end the same edit (Safari/Firefox blur the input
    // as it unmounts after Enter) — a second pass would queue a duplicate save
    // built on the old title and conflict with the first. Settle once per edit.
    if (titleSettledRef.current) return;
    titleSettledRef.current = true;
    // Enter returns focus to the title button; a blur-save must not steal it.
    if (e.type === "submit") focusTitleRef.current = true;
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    const base = editBase ?? task!;
    if (trimmed && trimmed !== base.title) patch({ title: trimmed }, base);
  }

  function cancelTitle() {
    titleSettledRef.current = true;
    focusTitleRef.current = true;
    setEditingTitle(false);
  }

  // Blur saves, Escape cancels (handled in the textarea's onKeyDown). Clearing
  // the text saves null. Line breaks are kept; only the outer whitespace goes.
  function commitDescription() {
    if (descriptionSettledRef.current) return;
    // The panel moved to another task mid-edit: the draft belongs to the old one.
    if (editBase && task && editBase.id !== task.id) {
      descriptionSettledRef.current = true;
      setEditingDescription(false);
      return;
    }
    descriptionSettledRef.current = true;
    setEditingDescription(false);
    const base = editBase ?? task!;
    const next = descriptionDraft.trim() || null;
    if (next !== (base.description?.trim() || null)) patch({ description: next }, base);
  }

  function cancelDescription() {
    descriptionSettledRef.current = true;
    focusDescriptionRef.current = true;
    setEditingDescription(false);
  }

  async function handleAddSubtask(e: FormEvent) {
    e.preventDefault();
    const title = newSubtask.trim();
    if (!title || !task || addingSubtaskRef.current) return;
    // The ref closes the window before React re-renders with `isPending`:
    // a second Enter in the same tick must not queue a second create.
    addingSubtaskRef.current = true;
    setError(null);
    try {
      await createTask.mutateAsync({
        title,
        parentTaskId: task.id,
        sectionId: task.sectionId,
        status: "TODO",
        ...(newSubtaskAssigneeId !== null ? { assignedToId: newSubtaskAssigneeId } : {}),
      });
      setNewSubtask("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add subtask.");
    } finally {
      addingSubtaskRef.current = false;
    }
  }

  function toggleSubtask(s: Task) {
    updateTask.mutate({ id: s.id, patch: { status: s.status === "DONE" ? "TODO" : "DONE" } });
  }

  function setSubtaskAssignee(s: Task, assignedToId: number | null) {
    updateTask.mutate({ id: s.id, patch: { assignedToId } });
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
    // mutateAsync: a per-call onError is lost if another save on this hook
    // starts first.
    updateTask.mutateAsync({ id, patch: { title: trimmed } }).catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Rename failed.");
    });
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

  const sectionName = task.section?.name ?? "No section";

  const errorAlert = (
    <>
      {/* Top of the scroll area so a failed save, duplicate or delete is seen
          even on a task with many subtasks (ISS-059). */}
      {error && (
        <div ref={errorRef} className="mb-4">
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );

  const breadcrumb = (
    <>
      {/* Parent breadcrumb — the only way back out of a subtask. */}
      {parentTask && (
        <div className="mb-1 flex max-w-full items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpenTask(parentTask.id)}
            className="[@media(pointer:coarse)]:min-h-11 flex min-w-0 items-center gap-0.5 rounded-sm text-meta text-on-surface-variant hover:text-primary outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="material-symbols-outlined text-xs" aria-hidden="true">
              arrow_back
            </span>
            <span className="truncate">{parentTask.title}</span>
          </button>
          {parentEpic && <EpicChip epic={parentEpic} compact />}
        </div>
      )}
    </>
  );

  const titleBlock = (
    <>
      {/* Title + subtitle */}
      {editingTitle ? (
        <form onSubmit={handleTitleSubmit}>
          <input
            autoFocus
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={(e) => {
              if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
              // Cancel this edit only; the panel-level Escape listener must not close the panel.
              e.stopPropagation();
              cancelTitle();
            }}
            maxLength={200}
            className="[@media(pointer:coarse)]:min-h-11 w-full border-none bg-transparent text-lg font-bold text-on-surface rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          />
        </form>
      ) : (
        <button
          ref={titleButtonRef}
          type="button"
          disabled={!canEdit}
          onClick={() => {
            titleSettledRef.current = false;
            setEditBase(task);
            setTitleDraft(task.title);
            setEditingTitle(true);
          }}
          className="[@media(pointer:coarse)]:min-h-11 block w-full rounded-sm text-left text-lg font-bold text-on-surface outline-hidden hover:bg-surface-container-high focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
        >
          {task.title}
        </button>
      )}
      {task.section && (
        <p className="mt-0.5 text-meta text-on-surface-variant">in {sectionName}</p>
      )}
    </>
  );

  const descriptionBlock = (
    <>
      {/* Description: under the title so List and Gantt users can read it.
          Read-only users get the text or nothing (label included); editors
          get a placeholder. */}
      {(task.description || canEdit) && (
        <div className="mt-3">
          {editingDescription ? (
            <label
              htmlFor={descriptionId}
              className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant"
            >
              Description
            </label>
          ) : (
            <p className="mb-1 font-display text-label-caps uppercase text-on-surface-variant">
              Description
            </p>
          )}
          {editingDescription ? (
            <>
              <textarea
                id={descriptionId}
                autoFocus
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                onBlur={commitDescription}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (e.nativeEvent.isComposing) return;
                    // Cancel this edit only; the panel-level Escape listener must not close the panel.
                    e.stopPropagation();
                    cancelDescription();
                  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    // Keyboard save: focus goes back to the button (not on blur-save).
                    focusDescriptionRef.current = true;
                    commitDescription();
                  }
                }}
                maxLength={2000}
                placeholder="Add a description"
                className="field-sizing-content min-h-24 max-h-64 w-full resize-y rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 text-base leading-snug text-on-surface placeholder:text-on-surface-variant focus-visible:border-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 md:text-sm"
              />
              <p className="mt-1 text-meta text-on-surface-variant">
                Saves when you click away.
                <span className="hidden md:[@media(pointer:fine)]:inline">
                  {" "}
                  {isApplePlatform() ? "⌘Enter" : "Ctrl+Enter"} saves, Esc cancels.
                </span>
              </p>
            </>
          ) : canEdit ? (
            <button
              ref={descriptionButtonRef}
              type="button"
              aria-label={task.description ? "Edit description" : undefined}
              aria-describedby={task.description ? `${descriptionId}-text` : undefined}
              onClick={() => {
                descriptionSettledRef.current = false;
                setEditBase(task);
                setDescriptionDraft(task.description ?? "");
                setEditingDescription(true);
              }}
              className="[@media(pointer:coarse)]:min-h-11 -mx-2 block w-[calc(100%+1rem)] rounded-sm border border-transparent px-2 py-1 text-left text-base leading-snug outline-hidden hover:bg-surface-container-high focus-visible:ring-2 focus-visible:ring-primary md:text-sm"
            >
              <span
                id={`${descriptionId}-text`}
                className={`block ${
                  task.description
                    ? "whitespace-pre-wrap wrap-break-word text-on-surface"
                    : "text-on-surface-variant"
                }`}
              >
                {task.description || "Add a description"}
              </span>
            </button>
          ) : (
            <p className="whitespace-pre-wrap wrap-break-word text-base leading-snug text-on-surface md:text-sm">
              {task.description}
            </p>
          )}
        </div>
      )}
    </>
  );

  const metaGrid = (cls: string) => (
    <>
      {/* Meta grid */}
      <div className={`${cls} grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 text-sm`}>
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
              className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-1 text-xs text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <option value="">Unassigned</option>
              {assignableUsers(users ?? [], task.assignedToId).map((u) => (
                <option key={u.id} value={u.id}>
                  {`${assigneeOptionLabel(u)}${assigneeAddsMember(u.id) ? " (not on project)" : ""}`}
                </option>
              ))}
            </select>
            {/* This picker saves the moment an option is chosen, so the
                warning goes on the options themselves plus this line —
                a plain paragraph, not a live region (specs query the
                panel by role). */}
            {assignableUsers(users ?? [], task.assignedToId).some((u) => assigneeAddsMember(u.id)) && (
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
              className="[@media(pointer:coarse)]:min-h-11 flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
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
              startISO={(editBase ?? task).startDate}
              endISO={(editBase ?? task).dueDate}
              onSave={(s, e) => {
                // Only the date(s) that actually changed — the untouched
                // one must not conflict on, or revert, someone else's edit.
                const base = editBase ?? task;
                const body = datePatchFromEdit(base, s, e);
                if (Object.keys(body).length > 0) patch(body, base);
                setEditingDates(false);
              }}
              onCancel={() => setEditingDates(false)}
            />
          ) : (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                setEditBase(task);
                setEditingDates(true);
              }}
              className="[@media(pointer:coarse)]:min-h-11 rounded-sm px-1 py-0.5 text-left text-on-surface hover:bg-surface-container-high disabled:cursor-default"
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
          className="[@media(pointer:coarse)]:min-h-11 flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
          title={canEdit ? "Click to cycle priority" : undefined}
        >
          <span aria-hidden="true"
            className={`material-symbols-outlined text-[15px] ${PRIORITY_ICON_CLASS[task.priority]}`}
          >
            flag
          </span>
          <span className="text-on-surface">{PRIORITY_LABEL[task.priority]}</span>
        </button>

        <span
          id={STORY_POINTS_LABEL_ID}
          className="self-center font-display text-label-caps uppercase text-on-surface-variant"
        >
          Story points
        </span>
        <StoryPointsEditor
          key={task.id}
          value={task.storyPoints ?? null}
          canEdit={canEdit}
          onCommit={(storyPoints) => patch({ storyPoints })}
        />

        <span className="self-center font-display text-label-caps uppercase text-on-surface-variant">
          Type
        </span>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => patch({ isMilestone: !task.isMilestone })}
          className="[@media(pointer:coarse)]:min-h-11 flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
          title={canEdit ? "Toggle between task bar and milestone diamond" : undefined}
        >
          <span aria-hidden="true"
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
          className="[@media(pointer:coarse)]:min-h-11 flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
          title={canEdit ? CRITICAL_PATH_HELPER_TEXT : undefined}
          aria-label={`${CRITICAL_PATH_LABEL}: ${task.isCriticalPath ? "Yes" : "No"}`}
        >
          <span aria-hidden="true"
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
              className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-1 text-xs text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
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
              className="[@media(pointer:coarse)]:min-h-11 flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
            >
              {task.section && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: sectionColors.get(task.section.id) ?? task.section.color }}
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
                    className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-1 text-xs text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
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
                  className="[@media(pointer:coarse)]:min-h-11 flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
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
              customerId={itopOrg.customerId}
              customerName={itopOrg.customerName}
              organisations={itopOrg.organisations}
              organisationLabel={itopOrg.organisationLabel}
              taskTitle={task.title}
              taskDescription={task.description}
              projectName={project?.name ?? null}
              parentTitle={(tasks ?? []).find((t) => t.id === task.parentTaskId)?.title ?? null}
              onSave={(ref) => patch({ itopTicketRef: ref })}
              onCreateSheetOpenChange={setNestedSheetOpen}
              showTimer
            />
          </>
        )}
      </div>
    </>
  );

  const labelsBlock = (cls: string) => (
    <>
      {/* Labels */}
      <div className={cls}>
        <p className="mb-1.5 font-display text-label-caps uppercase text-on-surface-variant">
          Labels
        </p>
        <LabelPicker
          projectId={projectId}
          selectedIds={task.labels.map((l) => l.id)}
          onChange={canEdit ? (ids) => patch({ labelIds: ids }) : () => {}}
        />
      </div>
    </>
  );

  const subtasksBlock = (cls: string) => (
    <>
      {/* Subtasks — hidden entirely on a subtask (max depth is 1). */}
      {!isSubtask && (
        <div className={cls}>
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
                  <div className="group/subtask flex [@media(pointer:coarse)]:min-h-11 items-center gap-2 rounded-sm px-1 py-1 text-xs" />
                }
              >
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => toggleSubtask(s)}
                  aria-label={s.status === "DONE" ? "Mark not done" : "Mark done"}
                  className={[
                    "group/tog flex h-4 w-4 shrink-0 items-center justify-center",
                    canEdit ? "cursor-pointer [@media(pointer:coarse)]:size-11" : "cursor-default",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
                      s.status === "DONE"
                        ? "border-primary bg-primary text-on-primary"
                        : "border-outline-variant group-hover/tog:border-primary",
                    ].join(" ")}
                  >
                    {s.status === "DONE" && (
                      <span aria-hidden="true" className="material-symbols-outlined text-meta leading-none">
                        check
                      </span>
                    )}
                  </span>
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
                      className="[@media(pointer:coarse)]:min-h-11 w-full border-none bg-transparent text-xs text-on-surface rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenTask(s.id)}
                    title={s.title}
                    className={[
                      "[@media(pointer:coarse)]:min-h-11 min-w-0 flex-1 truncate rounded-sm text-left hover:text-primary outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring",
                      s.status === "DONE"
                        ? "text-on-surface-variant line-through"
                        : "text-on-surface",
                    ].join(" ")}
                  >
                    {s.title}
                  </button>
                )}
                {subtaskTicketCtx && (canEdit || s.itopTicketRef) && (
                  <RowTicketCell
                    task={s}
                    parentTitle={task.title}
                    canEdit={canEdit}
                    ctx={subtaskTicketCtx}
                    onOverlayOpenChange={onRowOverlayChange}
                  />
                )}
                <SubtaskAssigneePicker
                  canEdit={canEdit}
                  users={users ?? []}
                  assignee={s.assignedTo}
                  value={s.assignedToId}
                  addsMember={assigneeAddsMember}
                  label={`Assignee for ${s.title}`}
                  onChange={(id) => setSubtaskAssignee(s, id)}
                />
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
                    className="material-symbols-outlined -m-2 [@media(pointer:coarse)]:m-0 shrink-0 rounded-sm p-2 [@media(pointer:coarse)]:p-3.5 text-sm text-on-surface-variant/80 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary md:opacity-0 md:group-hover/subtask:opacity-100 md:focus-visible:opacity-100"
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
                    className="material-symbols-outlined -m-2 [@media(pointer:coarse)]:m-0 shrink-0 rounded-sm p-2 [@media(pointer:coarse)]:p-3.5 text-sm text-on-surface-variant/80 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary md:opacity-0 md:group-hover/subtask:opacity-100 md:focus-visible:opacity-100 disabled:cursor-default disabled:opacity-50"
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
                        className="material-symbols-outlined shrink-0 touch-none rounded-sm [@media(pointer:coarse)]:p-3.5 text-sm text-on-surface-variant/80 cursor-grab active:cursor-grabbing outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring"
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
              <span aria-hidden="true" className="material-symbols-outlined text-xs text-primary">add</span>
              <input
                type="text"
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="Add subtask"
                maxLength={200}
                readOnly={createTask.isPending}
                className="[@media(pointer:coarse)]:min-h-11 min-w-0 flex-1 border-none bg-transparent text-xs text-on-surface rounded-sm outline-hidden placeholder:text-on-surface-variant/80 focus-visible:ring-2 focus-visible:ring-primary"
              />
              <SubtaskAssigneePicker
                canEdit={canEdit}
                users={users ?? []}
                assignee={(users ?? []).find((u) => u.id === newSubtaskAssigneeId) ?? null}
                value={newSubtaskAssigneeId}
                addsMember={assigneeAddsMember}
                label="Assignee for new subtask"
                onChange={setNewSubtaskAssigneeId}
              />
            </form>
          )}
        </div>
      )}
    </>
  );

  const outlineBlock = (
    <>
      {/* Outline pages that link to this task (hidden when there is nothing to show). */}
      <OutlineMentions scope={{ kind: "task", id: task.id }} variant="block" />
    </>
  );

  const commentsBlock = (cls: string) => (
    <>
      {/* Comments */}
      <div className={cls}>
        <PanelComments taskId={task.id} projectId={projectId} />
      </div>
    </>
  );

  const header = renderHeader?.({ task, canEdit, patch: (body) => patch(body), reportError: setError });

  const dialogs = (
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
                  tasks,
                  statuses: statusDefs,
                },
                conflict.stale.task,
              ),
            )
          : []
      }
      onUseTheirs={discardMine}
      onKeepMine={keepMine}
    />
  );

  if (layout === "page") {
    // Title and description lead, the fields sit in a side column from md:, and
    // subtasks, Outline pages and comments follow. DOM order is the desktop
    // reading order (head, body, fields); below md the fields are moved up
    // between the description and the subtasks with `order`, so a phone user
    // sees them before a long comment thread.
    return (
      <>
        {header}
        <div className="px-4 py-4 md:px-8 md:py-6">
          {errorAlert}
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
            <div className="max-md:order-1 md:col-start-1 md:row-start-1">
              {breadcrumb}
              {titleBlock}
              {descriptionBlock}
            </div>
            <div className="max-md:order-3 md:col-start-1 md:row-start-2">
              {subtasksBlock("")}
              {outlineBlock}
              {commentsBlock("mt-6 border-t border-outline-variant pt-4")}
            </div>
            <aside
              aria-label="Task fields"
              className="max-md:order-2 border-t border-outline-variant pt-4 md:col-start-2 md:row-span-2 md:row-start-1 md:border-t-0 md:border-l md:pl-6 md:pt-0"
            >
              {metaGrid("")}
              {labelsBlock("mt-4")}
            </aside>
          </div>
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {errorAlert}
        {breadcrumb}
        {titleBlock}
        {descriptionBlock}
        {metaGrid("mt-4")}
        {labelsBlock("mt-4")}
        {subtasksBlock("mt-4")}
        {outlineBlock}
        {commentsBlock("mt-5 border-t border-outline-variant pt-4")}
      </div>
      {dialogs}
    </>
  );
}

/**
 * Comment thread + single-line composer per the mockup ("Write a comment…"
 * placeholder + green send icon), backed by useComments / useAddComment.
 * This is the app's only comment UI (the former standalone CommentThread
 * component was never mounted and has been removed).
 */
function PanelComments({ taskId, projectId }: { taskId: number; projectId: number }) {
  // Posting needs task:comment (the server gate on POST /tasks/:id/comments);
  // reading the thread needs only project:read.
  const { user } = useAuth();
  const canComment = hasPermission(user, "task:comment");
  const { data: comments, isLoading, isError, error } = useComments(taskId);
  const addComment = useAddComment(taskId, projectId);
  const { data: project } = useProject(projectId);
  const { data: members } = useProjectMembers(projectId);

  // Everyone a comment can mention: the project's TAM and members (the server
  // stores a self-mention too, it just never notifies the commenter). Chips
  // render from the comment's returned ids, never from what was picked.
  const people = useMemo(() => {
    const byId = new Map<number, { id: number; username: string }>();
    if (project) byId.set(project.tam.id, { id: project.tam.id, username: project.tam.username });
    for (const m of members ?? []) byId.set(m.userId, { id: m.userId, username: m.username });
    return [...byId.values()];
  }, [project, members]);

  return (
    <div className="space-y-3">
      <h2 className="font-display text-label-caps uppercase text-on-surface-variant">
        Comments {comments && comments.length > 0 && `· ${comments.length}`}
      </h2>

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
                <div className="mb-0.5 flex items-center justify-between gap-2 text-meta">
                  <span className="min-w-0 truncate font-medium text-on-surface">{c.author.username}</span>
                  <span className="shrink-0 text-on-surface-variant">{fmtAgo(c.createdAt)}</span>
                </div>
                <CommentBody body={c.body} mentionedUserIds={c.mentionedUserIds} users={people} />
              </div>
            </li>
          ))}
        </ol>
      )}

      {canComment && (
        <CommentComposer
          candidates={people}
          isPending={addComment.isPending}
          error={addComment.error ? (addComment.error as Error).message : null}
          onSend={async (body, mentionedUserIds) => {
            await addComment.mutateAsync({ body, mentionedUserIds });
          }}
        />
      )}
    </div>
  );
}

const STORY_POINTS_LABEL_ID = "task-panel-story-points-label";
const STORY_POINTS_VALUE_ID = "task-panel-story-points-value";

/**
 * Story points row: reads as text, becomes a number field on click. Enter or
 * leaving the field saves, Escape cancels; empty clears the estimate, anything
 * outside whole numbers 0-100 is refused here before it reaches the API.
 */
function StoryPointsEditor({
  value,
  canEdit,
  onCommit,
}: {
  value: number | null;
  canEdit: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const errorId = useId();

  function commit() {
    const parsed = parseStoryPoints(draft);
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    setEditing(false);
    if (parsed.value !== value) onCommit(parsed.value);
  }

  if (editing && canEdit) {
    return (
      <div>
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          maxLength={3}
          aria-labelledby={STORY_POINTS_LABEL_ID}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setProblem(null);
              setEditing(false);
            }
          }}
          onBlur={commit}
          className="[@media(pointer:coarse)]:min-h-11 w-24 rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-0.5 text-xs text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        {problem && (
          <p id={errorId} role="alert" className="mt-1 text-meta text-error">
            {problem}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => {
        setDraft(value === null ? "" : String(value));
        setProblem(null);
        setEditing(true);
      }}
      className="[@media(pointer:coarse)]:min-h-11 flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-surface-container-high disabled:cursor-default"
      title={canEdit ? "Click to set story points" : undefined}
      aria-labelledby={`${STORY_POINTS_LABEL_ID} ${STORY_POINTS_VALUE_ID}`}
    >
      <span
        id={STORY_POINTS_VALUE_ID}
        className={value === null ? "text-on-surface-variant" : "text-on-surface"}
      >
        {value === null ? "Not estimated" : value}
      </span>
    </button>
  );
}

/**
 * Avatar-only assignee control for the panel's narrow subtask rows: the avatar
 * is the trigger, and picking swaps in a native select (same pattern as the
 * panel's own Assignee row) until a choice is made or focus leaves.
 */
function SubtaskAssigneePicker({
  canEdit,
  users,
  assignee,
  value,
  addsMember,
  label,
  onChange,
}: {
  canEdit: boolean;
  users: { id: number; username: string; active?: boolean }[];
  assignee: { id: number; username: string } | null | undefined;
  value: number | null;
  addsMember: (id: number | null | undefined) => boolean;
  label: string;
  onChange: (id: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing && canEdit) {
    return (
      <select
        autoFocus
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => {
          onChange(e.target.value === "" ? null : Number(e.target.value));
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className="[@media(pointer:coarse)]:min-h-11 w-28 shrink-0 rounded-sm border border-outline-variant bg-surface-container-lowest px-1 py-0.5 text-xs text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <option value="">Unassigned</option>
        {assignableUsers(users, value).map((u) => (
          <option key={u.id} value={u.id}>
            {`${assigneeOptionLabel(u)}${addsMember(u.id) ? " (not on project)" : ""}`}
          </option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => setEditing(true)}
      aria-label={label}
      title={assignee ? assignee.username : "Unassigned"}
      className="tap-target shrink-0 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
    >
      <AssigneeAvatar user={assignee ?? null} size="xs" />
    </button>
  );
}
